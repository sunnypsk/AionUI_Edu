import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { startWebHost, resetWebUiPassword } from '../../src/index';
import { resolveOpenUiCore } from '../core/resolve';
import { fixtureMessages, fixtureServer } from './fixtures';
import { runAgentAcceptance } from './agent';
import { runControlAcceptance, runModalAcceptance } from './controls';
import { prepareUpgradeFixture, upgradeFixtureMessagePath } from './upgrade';
import { runTableAcceptance } from './table';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const data = mkdtempSync(path.join(os.tmpdir(), 'yuyu-openui-browser-'));
const output = path.join(root, '.cache', 'openui-qa', path.basename(data));
mkdirSync(output, { recursive: true });
const binary = resolveOpenUiCore(root);
const password = resetWebUiPassword(binary, data);
execFileSync(binary, ['--data-dir', data, 'user', 'create', '--username', 'second-qa', '--password-stdin'], {
  input: password + '\n',
  stdio: 'pipe',
});
const upgrade = prepareUpgradeFixture(data);
process.env.PATH = path.join(root, 'node_modules', '.bin') + path.delimiter + process.env.PATH;
process.env.AIONUI_LOG_LEVEL = 'info';
const errors: string[] = [];
const diagnostics: string[] = [];
const evidence: Record<string, unknown> = { data, output, checks: [] };
const checks = evidence.checks as string[];

async function login(context: BrowserContext, base: string, username = 'admin') {
  await context.request.get(base + '/api/auth/status');
  const response = await context.request.post(base + '/login', { data: { username, password } });
  assert.equal(response.status(), 200, 'fixture login');
}

async function api<T>(
  context: BrowserContext,
  base: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  route: string,
  body?: unknown
) {
  const csrf = (await context.cookies(base)).find((cookie) => cookie.name === 'aionui-csrf-token')?.value;
  const response = await context.request.fetch(base + route, {
    method,
    data: body,
    headers: csrf ? { 'x-csrf-token': csrf } : {},
  });
  if (!response.ok()) throw new Error(`${method} ${route}: ${response.status()} ${await response.text()}`);
  return (await response.json()).data as T;
}

async function savePage(page: Page, name: string) {
  await page.screenshot({ path: path.join(output, name + '.png'), animations: 'disabled' });
  writeFileSync(path.join(output, name + '.txt'), await page.locator('body').innerText());
}

/** A valid large raster fixture exercises raw-byte streaming without chat base64. */
function imageFixture(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const header = Buffer.from([0, 0, 0, 64, 0, 0, 0, 64, 8, 2, 0, 0, 0]);
  const pixels = Buffer.alloc(64 * (64 * 3 + 1));
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const at = y * 193 + 1 + x * 3;
      pixels.set([x * 4, y * 4, 180], at);
    }
  const text = Buffer.alloc(3 * 1024 * 1024, 120);
  text.set(Buffer.from('Fixture\0'));
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('tEXt', text),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function observePage(page: Page) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  page.on('requestfailed', (request) =>
    diagnostics.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
  );
}

const handle = await startWebHost({
  app: {
    version: '2.2.2',
    isPackaged: false,
    resourcesPath: root,
    userDataPath: data,
    builtinSkillsDir: path.join(root, 'out/renderer/builtin-skills'),
  },
  staticDir: path.join(root, 'out/renderer'),
  port: 0,
  allowRemote: false,
  dataDir: data,
  enableRuntimeControls: true,
  dirs: { cacheDir: data, workDir: data, logDir: path.join(data, 'logs') },
  backend: { kind: 'ownBackend', resolveBackend: () => binary },
});
const browser = await chromium.launch({
  executablePath: process.env.AIONUI_QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
let desktop: Page | undefined;
try {
  const base = handle.localUrl.replace(/\/$/, '');
  evidence.base = base;
  assert.equal(
    (await fetch(base + '/api/openui/capabilities')).status,
    401,
    'the real WebUI must require authentication'
  );
  checks.push('real WebUI authentication');
  const first = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Hong_Kong' });
  await login(first, base);
  const capability = await api<{ hash: string; enabled: boolean }>(first, base, 'GET', '/api/openui/capabilities');
  assert.equal(capability.enabled, true);
  evidence.manifest = capability.hash;
  const legacy = await api<{ content: { content: string }; position: string }>(
    first,
    base,
    'GET',
    upgradeFixtureMessagePath
  );
  assert.equal(legacy.content.content, upgrade.content);
  assert.equal(legacy.position, 'right');
  upgrade.verify();
  checks.push('version-43 conversation, message, attachment and preference survive the additive migration');
  const skills = await api<Array<{ name: string; is_auto_inject: boolean }>>(first, base, 'GET', '/api/skills');
  assert.equal(skills.find((skill) => skill.name === 'humanizer-zh')?.is_auto_inject, true);
  checks.push('Humanizer-zh remains enabled for automatic skill injection');
  if (process.env.AIONUI_QA_AGENT_ONLY === '1') {
    desktop = await first.newPage();
    observePage(desktop);
    checks.push(
      ...(await runAgentAcceptance(
        desktop,
        base,
        data,
        output,
        <T>(method: 'GET' | 'POST', route: string, body?: unknown) => api<T>(first, base, method, route, body)
      ))
    );
    assert.deepEqual(errors, [], 'browser JavaScript errors');
    evidence.ok = true;
  } else {
    const counter = path.join(data, 'fixture-writes.json');
    const conversation = await api<{ id: string }>(first, base, 'POST', '/api/conversations', {
      type: 'acp',
      name: 'OpenUI browser acceptance',
      extra: {
        backend: 'codex',
        workspace: data,
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [fixtureServer(counter)],
      },
    });
    const contents = fixtureMessages();
    const seed = `import json,sqlite3,sys,time
p=json.load(sys.stdin)
db=sqlite3.connect(p['db'])
for i,content in enumerate(p['contents']):
 db.execute("INSERT INTO messages (id,conversation_id,msg_id,type,content,position,status,hidden,created_at) VALUES (?,?,?,'text',?,'left',?,0,?)",('openui-qa-'+str(i),p['conversation'],'openui-qa-'+str(i),json.dumps({'content':content}),'work' if i == 2 else 'finish',int(time.time()*1000)+i))
db.commit()
`;
    execFileSync('python3', ['-c', seed], {
      input: JSON.stringify({ db: path.join(data, 'aionui-backend.db'), conversation: conversation.id, contents }),
      stdio: 'pipe',
    });
    desktop = await first.newPage();
    observePage(desktop);
    await desktop.goto(base + '/#/conversation/' + conversation.id);
    const topic = desktop.getByPlaceholder('Topic', { exact: true });
    await topic.waitFor({ timeout: 30000 });
    await desktop.getByText('Fixture ready', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await topic.isEnabled(), true);
    await topic.fill('Device one draft');
    const stateRoute = `/api/conversations/${conversation.id}/messages/openui-qa-0/openui/0/state`;
    await desktop.waitForTimeout(650);
    const saved = await api<{ state: Record<string, unknown> }>(first, base, 'GET', stateRoute);
    assert.equal(saved.state.$topic, 'Device one draft');
    checks.push('official form, real Query and account state autosave');
    await savePage(desktop, 'desktop-light');

    const second = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      timezoneId: 'America/Los_Angeles',
    });
    await login(second, base);
    const mobile = await second.newPage();
    observePage(mobile);
    await mobile.goto(base + '/#/conversation/' + conversation.id);
    const mobileTopic = mobile.getByPlaceholder('Topic', { exact: true });
    await mobileTopic.waitFor({ timeout: 30000 });
    await mobile.waitForTimeout(500);
    assert.equal(await mobileTopic.inputValue(), 'Device one draft');
    await mobileTopic.scrollIntoViewIfNeeded();
    await savePage(mobile, 'mobile-light');
    checks.push('second browser context and mobile state restoration');

    const mobileWrite = mobile.waitForResponse(
      (response) => response.url().endsWith(stateRoute) && response.request().method() === 'PATCH'
    );
    await mobileTopic.fill('Device two draft');
    assert.equal((await mobileWrite).status(), 200);
    await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
    await desktop.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[placeholder="Topic"]')?.value === 'Device two draft'
    );
    await mobile.reload();
    await mobileTopic.waitFor();
    await mobile.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[placeholder="Topic"]')?.value === 'Device two draft'
    );
    checks.push('focus refresh and full-page reload preserve an unsubmitted form');

    const { promise: held, resolve: patchHeld } = Promise.withResolvers<void>();
    const { promise: resume, resolve: continueMobile } = Promise.withResolvers<void>();
    let intercept = true;
    await mobile.route('**' + stateRoute, async (route) => {
      if (intercept && route.request().method() === 'PATCH') {
        intercept = false;
        patchHeld();
        await resume;
      }
      await route.continue();
    });
    await mobileTopic.fill('Preserved mobile conflict draft');
    await held;
    const desktopWrite = desktop.waitForResponse(
      (response) => response.url().endsWith(stateRoute) && response.request().method() === 'PATCH'
    );
    await topic.fill('Latest desktop version');
    assert.equal((await desktopWrite).status(), 200);
    const conflict = mobile.waitForResponse(
      (response) => response.url().endsWith(stateRoute) && response.status() === 409
    );
    continueMobile();
    await conflict;
    const reapply = mobile.getByRole('button', { name: 'Reapply draft' });
    await reapply.waitFor();
    await reapply.scrollIntoViewIfNeeded();
    await savePage(mobile, 'mobile-conflict');
    const reapplied = mobile.waitForResponse(
      (response) => response.url().endsWith(stateRoute) && response.request().method() === 'PATCH' && response.ok()
    );
    await reapply.click();
    await reapplied;
    const recovered = await api<{ state: Record<string, unknown> }>(first, base, 'GET', stateRoute);
    assert.equal(recovered.state.$topic, 'Preserved mobile conflict draft');
    checks.push('two-context revision conflict retains and explicitly reapplies the local draft');
    await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
    await desktop.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>('input[placeholder="Topic"]')?.value ===
        'Preserved mobile conflict draft'
    );

    await topic.fill('Switch draft');
    await desktop.goto(base + '/#/guid');
    await topic.waitFor({ state: 'detached' });
    await desktop.goto(base + '/#/conversation/' + conversation.id);
    await topic.waitFor();
    await desktop.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[placeholder="Topic"]')?.value === 'Switch draft'
    );
    assert.equal(
      (await api<{ state: Record<string, unknown> }>(first, base, 'GET', stateRoute)).state.$topic,
      'Switch draft'
    );
    checks.push('conversation navigation flushes pending edits');

    await desktop.getByRole('button', { name: 'Save fixture', exact: true }).click();
    const allow = desktop.getByTestId('message-permission-option-allow_once');
    await allow.waitFor({ timeout: 15000 });
    await allow.scrollIntoViewIfNeeded();
    assert.ok((await desktop.locator('body').innerText()).includes('Switch draft'));
    await savePage(desktop, 'tool-confirmation');
    await allow.click();
    await desktop.getByText('Writes: 1', { exact: true }).waitFor({ timeout: 15000 });
    checks.push('Mutation, localized confirmation card and refreshed Query');

    await desktop.getByRole('button', { name: 'Open lesson', exact: true }).click();
    await runModalAcceptance(desktop, (name) => savePage(desktop!, name), 'modal-light');
    checks.push('modal Tab/Shift-Tab focus loop, nested popovers and focus restoration');

    const learner = desktop.getByText('Learner', { exact: true });
    await learner.click();
    await learner.click();
    const cell = desktop.locator('input.openui-editable-table-cell-input');
    await cell.fill('Unsaved table learner');
    const tableState = `/api/conversations/${conversation.id}/messages/openui-qa-1/openui/0/state`;
    const tableWrite = desktop.waitForResponse(
      (response) => response.url().endsWith(tableState) && response.request().method() === 'PATCH'
    );
    await cell.press('Tab');
    assert.equal((await tableWrite).status(), 200);
    await desktop.reload();
    await desktop.getByText('Unsaved table learner', { exact: true }).waitFor();
    await desktop.getByRole('button', { name: /reset/i }).click();
    await learner.waitFor();
    checks.push('official editable grid restores an unsubmitted cell draft and its reset baseline');
    await runTableAcceptance(desktop, (name) => savePage(desktop!, name), 'desktop');
    checks.push('all editable table cell types persist without submission');

    const carousel = desktop.locator('.openui-carousel-item').first();
    await carousel.scrollIntoViewIfNeeded();
    const colors = await carousel.evaluate((element) => {
      const css = getComputedStyle(element);
      return { background: css.backgroundColor, color: css.color };
    });
    assert.notEqual(colors.background, colors.color, 'surface and text tokens must remain distinct');
    await savePage(desktop, 'carousel-light');
    checks.push(...(await runControlAcceptance(desktop, (name) => savePage(desktop!, name), 'desktop')));
    await mobile.evaluate(() => window.dispatchEvent(new Event('focus')));
    await mobile.waitForFunction(
      () => document.querySelector<HTMLInputElement>('input[placeholder="Topic"]')?.value === 'Switch draft'
    );
    checks.push(...(await runControlAcceptance(mobile, (name) => savePage(mobile, name), 'mobile')));
    await api(first, base, 'PUT', '/api/settings/client', { 'theme.activeId': 'dark' });
    await Promise.all([desktop.reload(), mobile.reload()]);
    await Promise.all(
      [desktop, mobile].map((page) =>
        page.waitForFunction(
          () =>
            document.documentElement.getAttribute('data-theme') === 'dark' &&
            document.body.getAttribute('arco-theme') === 'dark'
        )
      )
    );
    await desktop.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Topic"]');
      return input && !input.disabled && !input.closest('[inert]');
    });
    await topic.scrollIntoViewIfNeeded();
    await mobile.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder="Topic"]');
      return input && !input.disabled && !input.closest('[inert]');
    });
    await mobileTopic.scrollIntoViewIfNeeded();
    await savePage(desktop, 'desktop-dark');
    await savePage(mobile, 'mobile-dark');
    await mobile.getByRole('button', { name: 'Open lesson', exact: true }).click();
    await mobile.getByRole('dialog').waitFor();
    const darkModalColor = await mobile
      .getByRole('dialog')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.ok(
      (darkModalColor.match(/[\d.]+/g) ?? []).slice(0, 3).every((channel) => Number(channel) < 128),
      'the modal must inherit the dark surface'
    );
    await runModalAcceptance(mobile, (name) => savePage(mobile, name), 'mobile-modal-dark');
    checks.push('desktop and mobile dark theme');

    const other = await browser.newContext();
    await login(other, base, 'second-qa');
    const isolated = await other.request.get(base + stateRoute);
    assert.equal(isolated.status(), 404);
    checks.push('real WebUI cross-account isolation');

    const streaming = desktop.getByPlaceholder('Streaming topic', { exact: true });
    await streaming.scrollIntoViewIfNeeded();
    assert.equal(await streaming.isDisabled(), true);
    await savePage(desktop, 'streaming-preview');
    const repair = desktop.getByRole('button', { name: 'Ask assistant to fix this interface', exact: true });
    await repair.scrollIntoViewIfNeeded();
    await savePage(desktop, 'invalid-block');
    assert.equal(await repair.isEnabled(), true);
    checks.push('unfinished streaming controls stay disabled and an invalid block exposes a repair action');

    const forked = await api<{ id: string }>(first, base, 'POST', `/api/conversations/${conversation.id}/fork`, {
      message_id: 'openui-qa-3',
      name: 'OpenUI fork acceptance',
    });
    const forkMessages = await api<{ items: Array<{ id: string; msg_id?: string }> }>(
      first,
      base,
      'GET',
      `/api/conversations/${forked.id}/messages`
    );
    const forkMessage = forkMessages.items.find((message) => message.msg_id === 'openui-qa-0');
    assert.ok(forkMessage);
    const forkState = `/api/conversations/${forked.id}/messages/${forkMessage.id}/openui/0/state`;
    const forkSnapshot = await api<{ state: Record<string, unknown>; revision: number }>(first, base, 'GET', forkState);
    assert.equal(forkSnapshot.state.$topic, 'Switch draft');
    await api(first, base, 'PATCH', forkState, {
      ...forkSnapshot,
      state: { ...forkSnapshot.state, $topic: 'Fork-only draft' },
    });
    assert.equal(
      (await api<{ state: Record<string, unknown> }>(first, base, 'GET', stateRoute)).state.$topic,
      'Switch draft'
    );
    await api(first, base, 'DELETE', `/api/conversations/${forked.id}`);
    assert.equal((await first.request.get(base + forkState)).status(), 404);
    checks.push('real conversation fork copies independent state and delete removes access');
    const imageConversation = await api<{ id: string }>(first, base, 'POST', '/api/conversations', {
      type: 'acp',
      name: 'Native image acceptance',
      extra: { backend: 'codex', workspace: data },
    });
    const imagePath = path.join(data, 'native-generated.png');
    const imageBytes = imageFixture();
    writeFileSync(imagePath, imageBytes);
    execFileSync(
      'python3',
      [
        '-c',
        `import json,sqlite3,sys,time
p=json.load(sys.stdin)
db=sqlite3.connect(p['db'])
db.execute("INSERT INTO messages (id,conversation_id,msg_id,type,content,position,status,hidden,created_at) VALUES (?,?,?,'tool_call',?,'left','finish',0,?)",('native-image',p['conversation'],'native-image',json.dumps({'call_id':'native-image','name':'imageGen','args':{},'status':'completed','images':[{'path':p['path'],'mime_type':'image/png'}]}),int(time.time()*1000)))
db.commit()
`,
      ],
      {
        input: JSON.stringify({
          db: path.join(data, 'aionui-backend.db'),
          conversation: imageConversation.id,
          path: imagePath,
        }),
        stdio: 'pipe',
      }
    );
    await desktop.goto(base + '/#/conversation/' + imageConversation.id);
    const gallery = desktop.getByTestId('tool-image-gallery');
    await gallery.waitFor();
    const image = gallery.getByRole('img', { name: 'native-generated.png' });
    await image.waitFor();
    await image.evaluate(async (element: HTMLImageElement) => {
      await element.decode();
    });
    assert.equal(await image.evaluate((element: HTMLImageElement) => element.naturalWidth), 64);
    await savePage(desktop, 'native-generated-image');
    await image.click();
    await desktop.locator('.arco-image-preview').waitFor();
    await savePage(desktop, 'native-generated-preview');
    await desktop.keyboard.press('Escape');
    const downloaded = desktop.waitForEvent('download');
    await gallery.getByRole('button', { name: 'Download image', exact: true }).click();
    const download = await downloaded;
    const downloadedPath = await download.path();
    assert.ok(downloadedPath);
    assert.equal(
      createHash('sha256').update(readFileSync(downloadedPath)).digest('hex'),
      createHash('sha256').update(imageBytes).digest('hex')
    );
    await desktop.reload();
    await gallery.waitFor();
    assert.equal(await gallery.count(), 1);
    await gallery.getByRole('img', { name: 'native-generated.png' }).evaluate(async (element: HTMLImageElement) => {
      await element.decode();
    });
    checks.push(
      'native image is visible with collapsed tools and no final text, preview/download preserve a large original PNG, reload shows one artifact'
    );
    if (process.env.AIONUI_QA_AGENT === '1') {
      checks.push(
        ...(await runAgentAcceptance(
          desktop,
          base,
          data,
          output,
          <T>(method: 'GET' | 'POST', route: string, body?: unknown) => api<T>(first, base, method, route, body)
        ))
      );
    }
    assert.deepEqual(errors, [], 'browser JavaScript errors');
    evidence.ok = true;
  }
} catch (error) {
  evidence.ok = false;
  evidence.error = error instanceof Error ? error.message : String(error);
  if (desktop) await savePage(desktop, 'failure').catch(() => undefined);
  throw error;
} finally {
  evidence.browserErrors = errors;
  evidence.diagnostics = diagnostics;
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
  await handle.stop();
  console.info('OpenUI browser evidence: ' + output);
}
