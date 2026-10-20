import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, stat, open, unlink, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  chromium,
  type BrowserContext,
  type BrowserType,
  type Page,
  type FileChooser,
  type Dialog,
  type CDPSession,
} from 'playwright-core';
import {
  browserUrl,
  BrowserRuntimeError,
  type BrowserAction,
  type BrowserControl,
  type BrowserOwner,
  type BrowserResult,
  type BrowserState,
  type BrowserPreferences,
} from './types.js';

const VIEWPORT = { width: 1280, height: 800 };
/**
 * Chromium-only network path that the container's SOCKS5 TUN route cannot be relied on to carry:
 * QUIC is UDP, which needs SOCKS5 UDP ASSOCIATE; many providers do not offer it.
 * Do not add a `--disable-features=` argument here: Playwright already passes its own list, Chromium keeps
 * only the last value of a repeated switch, so ours would replace Playwright's instead of extending it.
 */
export const BROWSER_LAUNCH_ARGS = ['--disable-dev-shm-usage', '--disable-quic'];
type LaunchOptions = NonNullable<Parameters<BrowserType['launchPersistentContext']>[1]>;
type Tab = { id: string; page: Page; requestedUrl?: string; chooser?: FileChooser; dialog?: Dialog };
type Download = { id: string; name: string; state: 'saving' | 'ready' | 'failed'; path?: string };
type Session = {
  owner: BrowserOwner;
  tabs: Tab[];
  active: string | null;
  control: BrowserControl;
  takingOver: boolean;
  needsInspection: boolean;
  revision: number;
  tail: Promise<unknown>;
  downloads: Download[];
  pending: number;
  touched: number;
};
type Options = {
  executablePath?: string;
  launch?: (directory: string, options: LaunchOptions) => Promise<BrowserContext>;
  idleMs?: number;
};

/** A user owns one persistent Chromium profile; each task owns a separate set of pages and a control lock. */
export class SharedBrowserManager {
  private sessions = new Map<string, Session>();
  private contexts = new Map<string, Promise<BrowserContext>>();
  private releasing = new Map<string, Promise<void>>();
  private closing = false;
  private idleTimer: ReturnType<typeof setInterval>;
  private preferences = new Map<string, BrowserPreferences>();
  private resetting = new Set<string>();

  constructor(
    private dataDir: string,
    private options: Options = {}
  ) {
    this.idleTimer = setInterval(() => {
      void this.expire();
    }, 60000);
    this.idleTimer.unref();
  }

  private session(owner: BrowserOwner): Session {
    let session = this.sessions.get(owner.conversationId);
    if (session && (session.owner.userId !== owner.userId || session.owner.workspace !== owner.workspace))
      throw new Error('BROWSER_FORBIDDEN');
    if (!session) {
      session = {
        owner,
        tabs: [],
        active: null,
        control: 'agent',
        takingOver: false,
        needsInspection: false,
        revision: 0,
        tail: Promise.resolve(),
        downloads: [],
        pending: 0,
        touched: Date.now(),
      };
      this.sessions.set(owner.conversationId, session);
    }
    return session;
  }

  state(owner: BrowserOwner): BrowserState {
    const s = this.session(owner);
    return {
      running: s.tabs.length > 0,
      agentEnabled: this.preferences.get(owner.userId)?.agentEnabled ?? true,
      control: s.control,
      takingOver: s.takingOver,
      revision: s.revision,
      activeTabId: s.active,
      tabs: s.tabs.map((t) => ({
        id: t.id,
        title: '',
        url: t.page.url(),
        // A failed load leaves `url` on chrome-error://; keep what the user or agent actually asked for.
        requestedUrl: t.requestedUrl ?? t.page.url(),
        fileChooser: Boolean(t.chooser),
        ...(t.dialog ? { dialog: { type: t.dialog.type(), message: t.dialog.message().slice(0, 2000) } } : {}),
      })),
      downloads: s.downloads.map(({ id, name, state }) => ({ id, name, state })),
      viewport: s.tabs.find((t) => t.id === s.active)?.page.viewportSize() ?? VIEWPORT,
    };
  }

  private profile(userId: string): string {
    return path.join(this.dataDir, 'browser-profiles', createHash('sha256').update(userId).digest('hex'));
  }

  async getPreferences(userId: string): Promise<BrowserPreferences> {
    const cached = this.preferences.get(userId);
    if (cached) return cached;
    let settings: BrowserPreferences = { agentEnabled: true };
    try {
      const value = JSON.parse(await readFile(this.profile(userId) + '.json', 'utf8')) as BrowserPreferences;
      settings = { agentEnabled: value.agentEnabled === true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') settings = { agentEnabled: false };
    }
    this.preferences.set(userId, settings);
    return settings;
  }

  async setPreferences(userId: string, settings: BrowserPreferences): Promise<BrowserPreferences> {
    const file = this.profile(userId) + '.json';
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + '.' + randomUUID();
    await writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
    this.preferences.set(userId, settings);
    if (!settings.agentEnabled)
      await Promise.all(
        [...this.sessions.values()].filter((s) => s.owner.userId === userId).map((s) => this.control(s.owner, 'human'))
      );
    return settings;
  }

  async clearData(userId: string): Promise<void> {
    if (this.resetting.has(userId)) throw new Error('BROWSER_UNAVAILABLE');
    this.resetting.add(userId);
    try {
      const sessions = [...this.sessions.values()].filter((s) => s.owner.userId === userId);
      sessions.forEach((s) => {
        s.takingOver = true;
      });
      await Promise.all(sessions.map((s) => s.tail));
      await this.releasing.get(userId);
      await (await this.contexts.get(userId))?.close();
      await rm(this.profile(userId), { recursive: true, force: true });
      sessions.forEach((s) => {
        s.tabs = [];
        s.active = null;
        s.control = 'human';
        s.takingOver = false;
        s.revision++;
      });
    } finally {
      this.resetting.delete(userId);
    }
  }

  private async context(userId: string): Promise<BrowserContext> {
    await this.releasing.get(userId);
    if (this.closing) throw new Error('BROWSER_UNAVAILABLE');
    let pending = this.contexts.get(userId);
    if (!pending) {
      pending = (async () => {
        const directory = this.profile(userId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const options: LaunchOptions = {
          executablePath: this.options.executablePath ?? process.env.AIONUI_BROWSER_EXECUTABLE,
          headless: true,
          chromiumSandbox: true,
          viewport: VIEWPORT,
          acceptDownloads: true,
          timeout: 10000,
          args: [...BROWSER_LAUNCH_ARGS],
        };
        let context: BrowserContext;
        try {
          context = await (this.options.launch ?? ((dir, opts) => chromium.launchPersistentContext(dir, opts)))(
            directory,
            options
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (/SingletonLock|ProcessSingleton|profile.*(?:in use|locked)/i.test(message))
            throw new BrowserRuntimeError('BROWSER_PROFILE_LOCKED', 'profile');
          if (/EAGAIN|pthread_create|Resource temporarily unavailable/i.test(message))
            throw new BrowserRuntimeError('BROWSER_RESOURCES_UNAVAILABLE', 'launch');
          if (error instanceof Error && error.name === 'TimeoutError')
            throw new BrowserRuntimeError('BROWSER_TIMEOUT', 'launch');
          throw new BrowserRuntimeError('BROWSER_START_FAILED', 'launch');
        }
        context.setDefaultTimeout(10000);
        context.setDefaultNavigationTimeout(10000);
        // Restore cookies and storage, but never expose Chrome's unassigned startup pages.
        await Promise.all(context.pages().map((page) => page.close()));
        context.on('close', () => {
          this.contexts.delete(userId);
          for (const s of this.sessions.values())
            if (s.owner.userId === userId) {
              if (!this.releasing.has(userId)) s.control = 'human';
              s.tabs = [];
              s.active = null;
              s.revision++;
            }
        });
        return context;
      })();
      this.contexts.set(userId, pending);
      void pending.catch(() => {
        this.contexts.delete(userId);
      });
    }
    return pending;
  }

  private attach(s: Session, page: Page): Tab {
    const existing = s.tabs.find((t) => t.page === page);
    if (existing) return existing;
    if (s.tabs.length >= 8) {
      void page.close();
      throw new Error('BROWSER_TAB_LIMIT');
    }
    const tab: Tab = { id: randomUUID(), page };
    s.tabs.push(tab);
    s.active = tab.id;
    s.revision++;
    page.on('popup', (popup) => {
      try {
        this.attach(s, popup);
      } catch {
        void popup.close();
      }
    });
    page.on('request', (request) => {
      // Link clicks and redirects bypass goto(); record top-level navigations so a failed load keeps its address.
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) tab.requestedUrl = request.url();
    });
    page.on('close', () => {
      s.tabs = s.tabs.filter((t) => t !== tab);
      if (s.active === tab.id) s.active = s.tabs[0]?.id ?? null;
      s.revision++;
      void this.releaseContext(s.owner.userId);
    });
    page.on('filechooser', (chooser) => {
      const target = s.tabs.find((candidate) => candidate.page === page);
      if (target) target.chooser = chooser;
    });
    page.on('dialog', (dialog) => {
      const target = s.tabs.find((candidate) => candidate.page === page);
      if (target) target.dialog = dialog;
      else void dialog.dismiss();
    });
    page.on('download', (download) => {
      void this.saveDownload(s, download);
    });
    return tab;
  }

  private enqueue<T>(s: Session, action: () => Promise<T>): Promise<T> {
    s.pending++;
    const next = s.tail.then(action).finally(async () => {
      s.pending--;
      s.touched = Date.now();
      await this.releaseContext(s.owner.userId);
    });
    s.tail = next.catch(() => {});
    return next;
  }

  /** Block new agent work immediately, then drain the bounded action already in flight. */
  async control(owner: BrowserOwner, mode: BrowserControl): Promise<BrowserResult> {
    const s = this.session(owner);
    if (this.resetting.has(owner.userId)) throw new Error('BROWSER_UNAVAILABLE');
    if (mode === 'agent' && !(await this.getPreferences(owner.userId)).agentEnabled)
      throw new Error('BROWSER_AGENT_DISABLED');
    if (mode === 'human') s.takingOver = true;
    return this.enqueue(s, async () => {
      s.control = mode;
      s.takingOver = false;
      s.needsInspection = mode === 'agent';
      s.revision++;
      await Promise.all(s.tabs.map((tab) => tab.page.mouse.up().catch(() => {})));
      return this.capture(s, false);
    });
  }

  async frame(owner: BrowserOwner): Promise<BrowserResult> {
    await this.getPreferences(owner.userId);
    // Passive viewer polls must not extend the browser's idle lifetime.
    const s = this.session(owner);
    return this.capture(s, false);
  }

  /** Capture the live viewport without waiting for website fonts or changing page styles. */
  private async captureImage(page: Page): Promise<string> {
    let connection: CDPSession | undefined;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = (async () => {
      const session = await page.context().newCDPSession(page);
      if (finished) {
        void session.detach().catch(() => {});
        throw new BrowserRuntimeError('BROWSER_TIMEOUT', 'capture');
      }
      connection = session;
      return (
        await session.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 65,
          captureBeyondViewport: false,
          fromSurface: true,
        })
      ).data;
    })();
    try {
      return await Promise.race([
        capture,
        new Promise<string>((_resolve, reject) => {
          timer = setTimeout(() => reject(new BrowserRuntimeError('BROWSER_TIMEOUT', 'capture')), 3000);
        }),
      ]);
    } catch (error) {
      if (error instanceof BrowserRuntimeError) throw error;
      throw new BrowserRuntimeError('BROWSER_UNAVAILABLE', 'capture');
    } finally {
      finished = true;
      clearTimeout(timer);
      // A stalled compositor must not make detachment extend the response deadline.
      void connection?.detach().catch(() => {});
    }
  }

  private async capture(s: Session, text: boolean): Promise<BrowserResult> {
    const state = this.state(s.owner);
    const titles = Promise.all(
      state.tabs.map(async (tab) => {
        const page = s.tabs.find((t) => t.id === tab.id)?.page;
        if (!page || page.isClosed()) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          tab.title = await Promise.race([
            page.title().catch(() => ''),
            new Promise<string>((resolve) => {
              timer = setTimeout(() => resolve(''), 1000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      })
    );
    const page = s.tabs.find((t) => t.id === s.active)?.page;
    if (!page || page.isClosed()) {
      await titles;
      return { state };
    }
    // A page can accept actions and expose text before render-blocking resources allow its first paint.
    // Keep that successful result usable; a missing frame is independent of action failure.
    const frame = this.captureImage(page).then(
      (image): Pick<BrowserResult, 'image' | 'frameError'> => ({ image }),
      (error: unknown): Pick<BrowserResult, 'image' | 'frameError'> => {
        if (!(error instanceof BrowserRuntimeError) || error.stage !== 'capture') throw error;
        const frameError: NonNullable<BrowserResult['frameError']> = {
          code: error.message === 'BROWSER_TIMEOUT' ? 'BROWSER_TIMEOUT' : 'BROWSER_UNAVAILABLE',
          stage: 'capture',
          diagnostic_id: randomUUID(),
        };
        console.warn(JSON.stringify({ event: 'browser.failed', ...frameError }));
        return { frameError };
      }
    );
    const content = text
      ? page
          .locator('body')
          .ariaSnapshot({ timeout: 3000 })
          .catch(() => '')
      : Promise.resolve(undefined);
    const [, preview, accessibleText] = await Promise.all([titles, frame, content]);
    return { state, ...preview, ...(text ? { text: accessibleText?.slice(0, 32000) ?? '' } : {}) };
  }

  async act(owner: BrowserOwner, actor: BrowserControl, action: BrowserAction): Promise<BrowserResult> {
    const s = this.session(owner);
    const preferences = await this.getPreferences(owner.userId);
    // Check again inside the queue: a takeover may arrive while this action is waiting.
    const permitted = (): void => {
      if (this.closing || this.resetting.has(owner.userId)) throw new Error('BROWSER_UNAVAILABLE');
      if (actor === 'agent' && !preferences.agentEnabled) throw new Error('BROWSER_AGENT_DISABLED');
      if (actor === 'agent' && (s.control !== 'agent' || s.takingOver)) throw new Error('BROWSER_HUMAN_CONTROL');
      if (actor === 'human' && (s.control !== 'human' || s.takingOver)) throw new Error('BROWSER_AGENT_CONTROL');
      if (actor === 'agent' && s.needsInspection && !['inspect', 'snapshot'].includes(action.kind))
        throw new Error('BROWSER_PAGE_CHANGED');
    };
    permitted();
    return this.enqueue(s, async () => {
      permitted();
      if (action.kind === 'inspect') {
        s.needsInspection = false;
      } else if (action.kind === 'open') {
        const url = browserUrl(action.url);
        if (s.tabs.length >= 8) throw new Error('BROWSER_TAB_LIMIT');
        const tab = this.attach(s, await (await this.context(owner.userId)).newPage());
        tab.requestedUrl = url;
        if (url !== 'about:blank') await tab.page.goto(url, { waitUntil: 'domcontentloaded' });
      } else {
        const tab = s.tabs.find((t) => t.id === action.tabId);
        if (!tab || tab.page.isClosed()) throw new Error('BROWSER_TAB_NOT_FOUND');
        const page = tab.page;
        s.active = tab.id;
        switch (action.kind) {
          case 'resize':
            await page.setViewportSize({ width: action.width, height: action.height });
            break;
          case 'navigate':
            tab.requestedUrl = browserUrl(action.url);
            await page.goto(tab.requestedUrl, { waitUntil: 'domcontentloaded' });
            break;
          case 'back':
            await page.goBack({ waitUntil: 'domcontentloaded' });
            break;
          case 'forward':
            await page.goForward({ waitUntil: 'domcontentloaded' });
            break;
          case 'reload':
            await page.reload({ waitUntil: 'domcontentloaded' });
            break;
          case 'close':
            await page.close();
            break;
          case 'select':
            break;
          case 'snapshot':
            s.needsInspection = false;
            break;
          case 'click':
            await page.mouse.click(action.x, action.y, { button: action.button });
            break;
          case 'move':
            await page.mouse.move(action.x, action.y);
            break;
          case 'down':
            await page.mouse.move(action.x, action.y);
            await page.mouse.down();
            break;
          case 'up':
            await page.mouse.move(action.x, action.y);
            await page.mouse.up();
            break;
          case 'scroll':
            await page.mouse.wheel(action.x, action.y);
            break;
          case 'text':
            await page.keyboard.insertText(action.text);
            break;
          case 'key':
            await page.keyboard.press(action.key);
            break;
          case 'fill':
            await page.locator(action.selector).fill(action.text);
            break;
          case 'clickElement':
            await page.locator(action.selector).click({ noWaitAfter: true });
            break;
          case 'upload': {
            const buffer = Buffer.from(action.base64, 'base64');
            if (buffer.length > 30 * 1024 * 1024) throw new Error('BROWSER_FILE_TOO_LARGE');
            const payload = {
              name: path.basename(action.name),
              mimeType: action.mimeType ?? 'application/octet-stream',
              buffer,
            };
            if (tab.chooser) {
              await tab.chooser.setFiles(payload);
              tab.chooser = undefined;
            } else if (action.selector) await page.locator(action.selector).setInputFiles(payload);
            else throw new Error('BROWSER_NO_FILE_CHOOSER');
            break;
          }
          case 'uploadPath': {
            const root = await realpath(owner.workspace);
            const file = await realpath(path.resolve(root, action.path));
            if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('BROWSER_FORBIDDEN');
            if ((await stat(file)).size > 30 * 1024 * 1024) throw new Error('BROWSER_FILE_TOO_LARGE');
            await page.locator(action.selector).setInputFiles(file);
            break;
          }
          case 'dialog': {
            if (!tab.dialog) throw new Error('BROWSER_NO_DIALOG');
            if (action.accept) await tab.dialog.accept(action.text);
            else await tab.dialog.dismiss();
            tab.dialog = undefined;
            break;
          }
        }
      }
      s.revision++;
      return actor === 'agent' ? this.capture(s, true) : { state: this.state(owner) };
    });
  }

  private async saveDownload(s: Session, download: import('playwright-core').Download): Promise<void> {
    const item: Download = {
      id: randomUUID(),
      name:
        download
          .suggestedFilename()
          .split('')
          .map((character) => (character.charCodeAt(0) < 32 || ['/', '\\'].includes(character) ? '_' : character))
          .join('')
          .slice(0, 180) || 'download',
      state: 'saving',
    };
    s.downloads.push(item);
    s.downloads = s.downloads.slice(-30);
    s.pending++;
    let destination: string | undefined;
    try {
      const root = await realpath(s.owner.workspace);
      // Exclusive creation rejects existing files and symlinks; preserve a unique task artifact name.
      destination = path.join(root, `browser-${item.id.slice(0, 8)}-${item.name}`);
      const source = await download.createReadStream();
      if (!source) throw new Error('BROWSER_FILE_NOT_FOUND');
      const handle = await open(destination, 'wx', 0o600);
      await pipeline(source, handle.createWriteStream());
      item.path = destination;
      item.name = path.basename(destination);
      item.state = 'ready';
    } catch {
      item.state = 'failed';
      if (destination) await unlink(destination).catch(() => {});
    } finally {
      s.pending--;
      s.touched = Date.now();
      await this.releaseContext(s.owner.userId);
    }
  }

  async download(owner: BrowserOwner, id: string): Promise<string> {
    const item = this.session(owner).downloads.find((d) => d.id === id && d.state === 'ready');
    if (!item?.path) throw new Error('BROWSER_FILE_NOT_FOUND');
    const root = await realpath(owner.workspace);
    const file = await realpath(item.path);
    if (!file.startsWith(root + path.sep)) throw new Error('BROWSER_FORBIDDEN');
    return file;
  }

  private async releaseContext(userId: string, expireIdle = false): Promise<void> {
    if (this.closing || this.resetting.has(userId) || this.releasing.has(userId)) return;
    const pending = this.contexts.get(userId);
    const context = await pending?.catch((): null => null);
    if (!context || this.contexts.get(userId) !== pending || this.releasing.has(userId)) return;
    // Recheck after awaiting the launch: another task may have queued work in the same profile.
    if (this.closing || this.resetting.has(userId)) return;
    const sessions = [...this.sessions.values()].filter((s) => s.owner.userId === userId);
    if (sessions.some((s) => s.pending > 0)) return;
    const withTabs = sessions.filter((s) => s.tabs.length > 0);
    if (
      withTabs.length &&
      (!expireIdle || withTabs.some((s) => Date.now() - s.touched < (this.options.idleMs ?? 30 * 60000)))
    )
      return;
    // Hold the profile until close finishes, including callers arriving while it is shutting down.
    const closing = Promise.resolve().then(() => context.close());
    this.releasing.set(userId, closing);
    try {
      await closing;
    } catch {
      // Leave the context registered so the next sweep retries; the deployer still sees its process.
    } finally {
      this.releasing.delete(userId);
    }
  }

  private async expire(): Promise<void> {
    await Promise.all([...this.contexts.keys()].map((userId) => this.releaseContext(userId, true)));
  }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.idleTimer);
    await Promise.allSettled(this.releasing.values());
    await Promise.allSettled([...this.contexts.values()].map(async (pending) => (await pending).close()));
    this.contexts.clear();
    this.sessions.clear();
  }
}
