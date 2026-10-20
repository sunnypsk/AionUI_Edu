import { EventEmitter } from 'node:events';
import { mkdtemp, rm, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, BrowserType, Page } from 'playwright-core';
import { SharedBrowserManager } from './manager.js';
import { browserActionSchema, browserUrl, type BrowserOwner } from './types.js';

class FakePage extends EventEmitter {
  address = 'about:blank';
  closed = false;
  fill = vi.fn().mockResolvedValue(undefined);
  upload = vi.fn().mockResolvedValue(undefined);
  mouse = { up: vi.fn().mockResolvedValue(undefined), click: vi.fn().mockResolvedValue(undefined) };
  keyboard = { insertText: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) };
  locator = vi.fn(() => ({
    ariaSnapshot: async () => '- textbox: updated page',
    fill: this.fill,
    setInputFiles: this.upload,
  }));
  frame = { url: (): string => this.address };
  mainFrame = (): { url: () => string } => this.frame;
  url = (): string => this.address;
  viewportSize = (): { width: number; height: number } => ({ width: 1280, height: 800 });
  title = async (): Promise<string> => 'Page';
  goto = async (url: string): Promise<void> => {
    this.address = url;
  };
  screenshot = async (): Promise<Buffer> => Buffer.from('jpeg');
  captureScreenshot = vi.fn().mockResolvedValue({ data: Buffer.from('jpeg').toString('base64') });
  detach = vi.fn().mockResolvedValue(undefined);
  newCDPSession = vi.fn(async () => ({ send: this.captureScreenshot, detach: this.detach }));
  context = (): BrowserContext => ({ newCDPSession: this.newCDPSession }) as unknown as BrowserContext;
  isClosed = (): boolean => this.closed;
  close = async (): Promise<void> => {
    this.closed = true;
    this.emit('close');
  };
}

class FakeContext extends EventEmitter {
  close = vi.fn(async (): Promise<void> => {
    this.emit('close');
  });
}

describe('task-scoped shared browser', () => {
  let directory: string;
  let manager: SharedBrowserManager;
  let owner: BrowserOwner;
  let pages: FakePage[];
  let contexts: FakeContext[];
  let launched: string[];
  let launchOptions: NonNullable<Parameters<BrowserType['launchPersistentContext']>[1]>[];
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    directory = await mkdtemp(path.join(os.tmpdir(), 'shared-browser-'));
    const workspace = path.join(directory, 'task-one');
    await mkdir(workspace);
    owner = { userId: 'teacher-one', conversationId: 'task-one', workspace };
    pages = [];
    contexts = [];
    launched = [];
    launchOptions = [];
    manager = new SharedBrowserManager(directory, {
      launch: async (profile, options) => {
        launched.push(profile);
        launchOptions.push(options);
        const context = new FakeContext();
        contexts.push(context);
        return Object.assign(context, {
          pages: () => [],
          setDefaultTimeout: vi.fn(),
          setDefaultNavigationTimeout: vi.fn(),
          newPage: async () => {
            const page = new FakePage();
            pages.push(page);
            return page as unknown as Page;
          },
        }) as unknown as BrowserContext;
      },
    });
  });
  afterEach(async () => {
    try {
      await manager.close();
      await rm(directory, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });
  const tab = async (): Promise<string> =>
    (await manager.act(owner, 'agent', { kind: 'open', url: 'https://example.com' })).state.activeTabId!;

  it('bounds an unresponsive viewport capture and detaches its session', async () => {
    await tab();
    pages[0].captureScreenshot.mockImplementationOnce(() => new Promise(() => {}));
    const frame = manager.frame(owner);
    const failed = expect(frame).rejects.toMatchObject({ message: 'BROWSER_TIMEOUT', stage: 'capture' });
    await vi.advanceTimersByTimeAsync(3001);
    await failed;
    expect(pages[0].detach).toHaveBeenCalledTimes(2);
    expect(manager.state(owner).running).toBe(true);
  });

  it('detaches a session that arrives after the viewport deadline', async () => {
    await tab();
    let attached!: (session: Awaited<ReturnType<FakePage['newCDPSession']>>) => void;
    pages[0].newCDPSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          attached = resolve;
        })
    );
    const frame = manager.frame(owner);
    const failed = expect(frame).rejects.toThrow('BROWSER_TIMEOUT');
    await vi.advanceTimersByTimeAsync(3001);
    await failed;
    attached({ send: pages[0].captureScreenshot, detach: pages[0].detach });
    await Promise.resolve();
    expect(pages[0].detach).toHaveBeenCalledTimes(2);
    expect(pages[0].captureScreenshot).toHaveBeenCalledOnce();
  });

  it('keeps private protocol diagnostics out of browser failures', async () => {
    await tab();
    pages[0].captureScreenshot.mockRejectedValueOnce(new Error('private URL and profile details'));
    await expect(manager.frame(owner)).rejects.toMatchObject({ message: 'BROWSER_UNAVAILABLE', stage: 'capture' });
    expect(pages[0].detach).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ProcessSingleton: SingletonLock belongs to previous-host', 'BROWSER_PROFILE_LOCKED'],
    ['pthread_create: Resource temporarily unavailable', 'BROWSER_RESOURCES_UNAVAILABLE'],
    ['launch failed with a private fixture URL and password', 'BROWSER_START_FAILED'],
  ])('reports a bounded launch failure for %s and allows the next attempt', async (reason, code) => {
    await manager.close();
    const launch = vi.fn().mockRejectedValue(new Error(reason));
    manager = new SharedBrowserManager(directory, { launch });
    await expect(tab()).rejects.toThrow(code);
    await expect(tab()).rejects.toThrow(code);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('expires an idle browser even when the viewer continues polling its state and screenshots', async () => {
    await tab();
    await vi.advanceTimersByTimeAsync(29 * 60000);
    manager.state(owner);
    await manager.frame(owner);
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(manager.state(owner).running).toBe(false);
  });

  it('does not let polling a task without tabs keep another tasks idle browser alive', async () => {
    await tab();
    await vi.advanceTimersByTimeAsync(29 * 60000);
    manager.state({ ...owner, conversationId: 'unused-task' });
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('does not let rejected agent requests keep a browser under manual control alive', async () => {
    await tab();
    await manager.control(owner, 'human');
    await vi.advanceTimersByTimeAsync(29 * 60000);
    await expect(manager.act(owner, 'agent', { kind: 'inspect' })).rejects.toThrow('BROWSER_HUMAN_CONTROL');
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it.each(['agent', 'human'] as const)('keeps a browser alive after a real %s interaction', async (actor) => {
    const id = await tab();
    if (actor === 'human') await manager.control(owner, 'human');
    await vi.advanceTimersByTimeAsync(29 * 60000);
    await manager.act(owner, actor, { kind: 'text', tabId: id, text: 'Still working' });
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('waits for a running operation and starts its idle period after that operation finishes', async () => {
    const id = await tab();
    let finish!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    pages[0].fill.mockImplementationOnce(() => {
      started();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const operation = manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'Work' });
    await running;
    try {
      await vi.advanceTimersByTimeAsync(31 * 60000);
      expect(contexts[0].close).not.toHaveBeenCalled();
    } finally {
      finish();
      await operation;
    }
    await vi.advanceTimersByTimeAsync(29 * 60000);
    expect(contexts[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('releases Chromium immediately after the last tab closes', async () => {
    const id = await tab();
    await manager.act(owner, 'agent', { kind: 'close', tabId: id });
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(manager.state(owner).running).toBe(false);
  });

  it('releases Chromium when a website closes its own last tab', async () => {
    await tab();
    await pages[0].close();
    await vi.waitFor(() => expect(contexts[0].close).toHaveBeenCalledOnce());
  });

  it('keeps other tasks and users browsers open when a tab closes', async () => {
    const id = await tab();
    const other = { ...owner, conversationId: 'task-two' };
    const otherId = (await manager.act(other, 'agent', { kind: 'open' })).state.activeTabId!;
    await manager.act({ ...owner, userId: 'teacher-two', conversationId: 'task-three' }, 'agent', { kind: 'open' });
    await manager.act(owner, 'agent', { kind: 'close', tabId: id });
    expect(contexts[0].close).not.toHaveBeenCalled();
    await manager.act(other, 'agent', { kind: 'close', tabId: otherId });
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(contexts[1].close).not.toHaveBeenCalled();
  });

  it('preserves website sign-ins and task files when a browser is released and reopened', async () => {
    const id = await tab();
    const profileFile = path.join(launched[0], 'Cookies');
    const taskFile = path.join(owner.workspace, 'keep.txt');
    await writeFile(profileFile, 'saved sign-in');
    await writeFile(taskFile, 'task artifact');
    await manager.act(owner, 'agent', { kind: 'close', tabId: id });
    await tab();
    expect(launched).toEqual([launched[0], launched[0]]);
    expect(await readFile(profileFile, 'utf8')).toBe('saved sign-in');
    expect(await readFile(taskFile, 'utf8')).toBe('task artifact');
  });

  it('waits for Chromium to finish closing before opening the same profile again', async () => {
    const id = await tab();
    let finish!: () => void;
    let started!: () => void;
    const closingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    contexts[0].close.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      contexts[0].emit('close');
    });
    const closing = manager.act(owner, 'agent', { kind: 'close', tabId: id });
    let opening: ReturnType<SharedBrowserManager['act']> | undefined;
    try {
      await Promise.race([closingStarted, closing]);
      const other = { ...owner, conversationId: 'task-two' };
      opening = manager.act(other, 'agent', { kind: 'open' });
      await vi.advanceTimersByTimeAsync(0);
      expect(pages).toHaveLength(1);
      finish?.();
      await Promise.all([closing, opening]);
      expect(launched).toHaveLength(2);
      expect(manager.state(other).running).toBe(true);
    } finally {
      finish?.();
      await opening?.catch(() => {});
      contexts[0].close.mockReset().mockImplementation(async () => {
        contexts[0].emit('close');
      });
    }
  });

  it('does not interrupt a download when the last tab closes', async () => {
    const id = await tab();
    const stream = new PassThrough();
    pages[0].emit('download', { suggestedFilename: () => 'worksheet.txt', createReadStream: async () => stream });
    try {
      await manager.act(owner, 'agent', { kind: 'close', tabId: id });
      expect(contexts[0].close).not.toHaveBeenCalled();
      stream.end('downloaded worksheet');
      await vi.waitFor(() => expect(contexts[0].close).toHaveBeenCalledOnce());
      const saved = manager.state(owner).downloads[0];
      expect(await readFile(await manager.download(owner, saved.id), 'utf8')).toBe('downloaded worksheet');
    } finally {
      stream.destroy();
    }
  });

  it('keeps Chromium alive while a download exceeds the idle timeout', async () => {
    await tab();
    const stream = new PassThrough();
    pages[0].emit('download', { suggestedFilename: () => 'worksheet.txt', createReadStream: async () => stream });
    try {
      await vi.advanceTimersByTimeAsync(31 * 60000);
      expect(contexts[0].close).not.toHaveBeenCalled();
      stream.end('downloaded worksheet');
      await vi.waitFor(() => expect(manager.state(owner).downloads[0].state).toBe('ready'));
      await vi.advanceTimersByTimeAsync(29 * 60000);
      expect(contexts[0].close).not.toHaveBeenCalled();
    } finally {
      stream.destroy();
    }
    await vi.advanceTimersByTimeAsync(2 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('releases an empty browser after a download fails', async () => {
    const id = await tab();
    let fail!: (error: Error) => void;
    pages[0].emit('download', {
      suggestedFilename: () => 'worksheet.txt',
      createReadStream: () =>
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        }),
    });
    await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
    await manager.act(owner, 'agent', { kind: 'close', tabId: id });
    fail(new Error('Download interrupted'));
    await vi.waitFor(() => expect(contexts[0].close).toHaveBeenCalledOnce());
    expect(manager.state(owner).downloads[0].state).toBe('failed');
  });

  it('retries a failed browser release without failing the completed tab close', async () => {
    const id = await tab();
    contexts[0].close.mockRejectedValueOnce(new Error('Temporary browser close failure'));
    await manager.act(owner, 'agent', { kind: 'close', tabId: id });
    expect(contexts[0].close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60000);
    expect(contexts[0].close).toHaveBeenCalledTimes(2);
  });

  it('does not leave a failed operation blocking idle cleanup', async () => {
    const id = await tab();
    pages[0].fill.mockRejectedValueOnce(new Error('Page operation failed'));
    await expect(
      manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'Work' })
    ).rejects.toThrow('Page operation failed');
    await vi.advanceTimersByTimeAsync(31 * 60000);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it('blocks agent reads and mutations throughout manual control', async () => {
    const id = await tab();
    await manager.control(owner, 'human');
    await expect(manager.act(owner, 'agent', { kind: 'snapshot', tabId: id })).rejects.toThrow('BROWSER_HUMAN_CONTROL');
    await expect(
      manager.act(owner, 'agent', { kind: 'navigate', tabId: id, url: 'https://example.org' })
    ).rejects.toThrow('BROWSER_HUMAN_CONTROL');
  });

  it('drains the running action and rejects queued AI work before granting takeover', async () => {
    const id = await tab();
    let finish!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    pages[0].fill.mockImplementation(() => {
      started();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'first' });
    await running;
    const queued = manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'second' });
    const rejected = expect(queued).rejects.toThrow('BROWSER_HUMAN_CONTROL');
    const takeover = manager.control(owner, 'human');
    expect(manager.state(owner).takingOver).toBe(true);
    finish();
    await first;
    await rejected;
    await takeover;
    expect(pages[0].fill).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh page inspection after the user returns control', async () => {
    const id = await tab();
    await manager.control(owner, 'human');
    await manager.act(owner, 'human', { kind: 'text', tabId: id, text: '老師修改' });
    await manager.control(owner, 'agent');
    await expect(manager.act(owner, 'agent', { kind: 'click', tabId: id, x: 1, y: 1 })).rejects.toThrow(
      'BROWSER_PAGE_CHANGED'
    );
    const result = await manager.act(owner, 'agent', { kind: 'inspect' });
    expect(result.text).toContain('updated page');
    await manager.act(owner, 'agent', { kind: 'click', tabId: id, x: 1, y: 1 });
  });

  it('shares a profile within a user while isolating pages across tasks and users', async () => {
    const id = await tab();
    const other = { ...owner, conversationId: 'task-two' };
    await expect(manager.act(other, 'agent', { kind: 'snapshot', tabId: id })).rejects.toThrow('BROWSER_TAB_NOT_FOUND');
    await manager.act(other, 'agent', { kind: 'open' });
    await manager.act({ ...other, userId: 'teacher-two', conversationId: 'task-three' }, 'agent', { kind: 'open' });
    expect(new Set(launched).size).toBe(2);
  });

  it('rejects forged ownership and changed workspace paths', async () => {
    await tab();
    expect(() => manager.state({ ...owner, userId: 'someone-else' })).toThrow('BROWSER_FORBIDDEN');
    expect(() => manager.state({ ...owner, workspace: '/different' })).toThrow('BROWSER_FORBIDDEN');
  });

  it('rejects uploads that escape the task folder through a symlink', async () => {
    const id = await tab();
    const outside = path.join(directory, 'secret.txt');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(owner.workspace, 'link'));
    await expect(
      manager.act(owner, 'agent', { kind: 'uploadPath', tabId: id, selector: 'input', path: 'link' })
    ).rejects.toThrow('BROWSER_FORBIDDEN');
  });

  it('preserves the selected file MIME type and bytes for website uploads', async () => {
    const id = await tab();
    const buffer = Buffer.from([0, 255, 80, 68, 70]);
    await manager.act(owner, 'agent', {
      kind: 'upload',
      tabId: id,
      selector: 'input',
      name: '教材.pdf',
      mimeType: 'application/pdf',
      base64: buffer.toString('base64'),
    });
    expect(pages[0].upload).toHaveBeenCalledWith({ name: '教材.pdf', mimeType: 'application/pdf', buffer });
  });

  it('persists opt-out and prevents AI from reacquiring control', async () => {
    await tab();
    await manager.setPreferences(owner.userId, { agentEnabled: false });
    await expect(manager.control(owner, 'agent')).rejects.toThrow('BROWSER_AGENT_DISABLED');
    await expect(manager.act(owner, 'agent', { kind: 'inspect' })).rejects.toThrow('BROWSER_AGENT_DISABLED');
    const reopened = new SharedBrowserManager(directory);
    try {
      expect(await reopened.getPreferences(owner.userId)).toEqual({ agentEnabled: false });
    } finally {
      await reopened.close();
    }
  });

  it('clears only the current user profile and preserves task files', async () => {
    await tab();
    await writeFile(path.join(owner.workspace, 'keep.txt'), 'keep');
    await manager.clearData(owner.userId);
    expect(manager.state(owner).running).toBe(false);
    await expect(
      (await import('node:fs/promises')).readFile(path.join(owner.workspace, 'keep.txt'), 'utf8')
    ).resolves.toBe('keep');
  });

  it('launches sandboxed chromium over TCP only, resolving names like the rest of the container', async () => {
    await tab();
    expect(launchOptions).toHaveLength(1);
    expect(launchOptions[0].chromiumSandbox).toBe(true);
    // QUIC needs SOCKS5 UDP relay, which the TUN path cannot guarantee.
    expect(launchOptions[0].args).toContain('--disable-quic');
    // Playwright passes its own --disable-features list and Chromium keeps only the last occurrence of a
    // repeated switch, so any --disable-features we add would silently replace Playwright's list.
    expect(launchOptions[0].args).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--disable-features/)]));
    expect(launchOptions[0].args).not.toEqual(expect.arrayContaining([expect.stringMatching(/^--proxy-server/)]));
  });

  it('remembers the requested address when a page fails to load', async () => {
    const id = await tab();
    pages[0].goto = async (url: string): Promise<void> => {
      void url;
      pages[0].address = 'chrome-error://chromewebdata/';
      throw new Error('net::ERR_CONNECTION_RESET');
    };
    await expect(
      manager.act(owner, 'agent', { kind: 'navigate', tabId: id, url: 'https://www.hko.gov.hk/tc/' })
    ).rejects.toThrow('ERR_CONNECTION_RESET');
    expect(manager.state(owner).tabs[0]).toMatchObject({
      url: 'chrome-error://chromewebdata/',
      requestedUrl: 'https://www.hko.gov.hk/tc/',
    });
  });

  it('tracks the requested address for in-page navigations as well', async () => {
    await tab();
    expect(manager.state(owner).tabs[0].requestedUrl).toBe('https://example.com/');
    const request = (url: string, frame: unknown, navigation = true) => ({
      url: () => url,
      frame: () => frame,
      isNavigationRequest: () => navigation,
    });
    pages[0].emit('request', request('https://example.com/image.png', pages[0].frame, false));
    pages[0].emit('request', request('https://ads.example.net/frame', {}));
    expect(manager.state(owner).tabs[0].requestedUrl).toBe('https://example.com/');
    pages[0].emit('request', request('https://www.edb.gov.hk/', pages[0].frame));
    expect(manager.state(owner).tabs[0].requestedUrl).toBe('https://www.edb.gov.hk/');
  });

  it('rejects internal URLs and malformed browser inputs', () => {
    expect(() => browserUrl('file:///etc/passwd')).toThrow('INVALID_BROWSER_URL');
    expect(() => browserUrl('javascript:alert(1)')).toThrow('INVALID_BROWSER_URL');
    expect(browserActionSchema.safeParse({ kind: 'click', tabId: 'bad', x: -1, y: 0 }).success).toBe(false);
  });
});
