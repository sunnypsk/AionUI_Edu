/** Real Chromium + MCP smoke gate. Uses synthetic auth, temporary profiles and no model inference. */
import http from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium, type BrowserContext } from 'playwright-core';
import { SharedBrowserManager } from './manager.js';
import { createBrowserRuntime, signBrowserCapability } from './routes.js';
import { browserCodexLaunch, browserCodexSpawn } from './launcher.js';
import type { BrowserAction, BrowserResult, BrowserState } from './types.js';

const listen = async (server: http.Server): Promise<number> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as { port: number }).port;
};
const close = async (server: http.Server): Promise<void> => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
};
const delay = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

async function codexInventory(env: NodeJS.ProcessEnv, directory: string): Promise<void> {
  const executable = process.env.AIONUI_BUNDLED_CODEX;
  if (!executable) return;
  const configHome = path.join(directory, 'codex');
  await mkdir(configHome);
  // Catalog/socket prewarming stays on the disposable fixture server, never an inference provider.
  const fixture = env.AIONUI_BROWSER_GATEWAY?.replace('/command', '/v1') ?? 'http://127.0.0.1:1/v1';
  const launch = browserCodexLaunch(
    [
      '-c',
      'model_provider="browser_smoke"',
      '-c',
      'model_providers.browser_smoke.name="Browser smoke"',
      '-c',
      `model_providers.browser_smoke.base_url=${JSON.stringify(fixture)}`,
      '-c',
      'model_providers.browser_smoke.wire_api="responses"',
      'app-server',
    ],
    { ...process.env, ...env, CODEX_HOME: configHome }
  );
  const program = browserCodexSpawn(executable, launch);
  const child = spawn(program.command, program.args, { env: launch.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const input = child.stdin;
  let sequence = 0;
  let buffer = '';
  let browserStatus = '';
  let browserFailure = '';
  const notifications = new Set<string>();
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  child.stdout.on('data', (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const frame = JSON.parse(line) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: unknown;
          method?: string;
          params?: { name?: string; status?: string; error?: string };
        };
        if (frame.method) notifications.add(frame.method);
        if (frame.method === 'mcpServer/startupStatus/updated' && frame.params?.name === 'aionui_browser') {
          browserStatus = frame.params.status ?? '';
          // This runner uses only synthetic credentials and a disposable CODEX_HOME.
          browserFailure = frame.params.error?.slice(0, 1200) ?? '';
        }
        if (frame.id && pending.has(frame.id)) {
          const response = pending.get(frame.id)!;
          pending.delete(frame.id);
          if (frame.error) response.reject(new Error('Codex RPC failed'));
          else response.resolve(frame.result ?? {});
        }
      } catch {
        /* Ignore non-protocol startup diagnostics. */
      }
    }
  });
  let diagnostic = '';
  child.stderr.on('data', (data: Buffer) => {
    diagnostic = (diagnostic + data.toString()).slice(-2000);
  });
  child.on('exit', (code) => {
    for (const request of pending.values()) request.reject(new Error(`Codex exited (${code}): ${diagnostic}`));
    pending.clear();
  });
  const rpc = (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex RPC timed out (${method}): ${diagnostic}`));
      }, 30000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      input.write(JSON.stringify({ id, method, params }) + '\n');
    });
  };
  try {
    await rpc('initialize', {
      clientInfo: { name: 'aionui-browser-smoke', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    input.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const started = await rpc('thread/start', {
      cwd: directory,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      config: {
        mcp_servers: {
          qa_sidecar: {
            command: 'node',
            args: ['--experimental-strip-types', fileURLToPath(new URL('./mcp.ts', import.meta.url))],
            env_vars: ['AIONUI_BROWSER_GATEWAY', 'AIONUI_BROWSER_CAPABILITY', 'AIONUI_RUNTIME_TOKEN'],
          },
        },
      },
    });
    for (let attempt = 0; attempt < 150 && browserStatus !== 'ready' && browserStatus !== 'failed'; attempt++)
      await delay();
    assert.equal(
      browserStatus,
      'ready',
      'Codex MCP startup did not finish: ' + [...notifications].join(', ') + ' ' + diagnostic + ' ' + browserFailure
    );
    // Verified: Codex 0.163.0 app-server generated v2/ListMcpServerStatus{Params,Response}.json.
    const thread = started.thread as { id: string };
    const inventory = await rpc('mcpServerStatus/list', { threadId: thread.id, serverName: 'aionui_browser' });
    const servers = inventory.data as { name: string; tools: Record<string, { name: string }> }[];
    const shared = servers.find((server) => server.name === 'aionui_browser');
    assert(
      shared && Object.values(shared.tools).some((tool) => tool.name === 'browser'),
      'Browser tool missing from native inventory'
    );
    console.log('Codex app-server discovered aionui_browser (no inference).');
  } finally {
    input.destroy();
    child.kill('SIGTERM');
  }
}

/** Run with Bun; AIONUI_BROWSER_EXECUTABLE selects system Chromium/Chrome. */
export async function runBrowserSmoke(): Promise<void> {
  console.log('Starting isolated browser smoke');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aionui-browser-smoke-'));
  const tasks: Record<string, string> = { 'task-one': 'teacher', 'task-two': 'teacher', 'task-three': 'other' };
  await Promise.all(Object.keys(tasks).map((id) => mkdir(path.join(directory, id))));
  let uploaded = '';
  const backend = http.createServer((req, res) => {
    const user = req.headers.cookie?.match(/qa=(\w+)/)?.[1] ?? req.headers['x-aionui-user-id'];
    const task = req.headers['x-aionui-conversation-id'];
    const valid =
      req.headers.cookie?.startsWith('qa=') ||
      (typeof task === 'string' &&
        tasks[task] === user &&
        req.headers['x-aionui-runtime-token'] === 'synthetic-browser-fixture');
    if (req.url?.startsWith('/api/')) {
      if (!valid) {
        res.writeHead(401).end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/system/current-user' || req.url === '/api/auth/user')
        res.end(JSON.stringify({ data: { id: user } }));
      else {
        const id = req.url.split('/').pop() ?? '';
        if (tasks[id] !== user) res.writeHead(404).end('{}');
        else res.end(JSON.stringify({ data: { id, extra: { workspace: path.join(directory, id) } } }));
      }
      return;
    }
    if (req.url === '/signin') {
      res
        .writeHead(302, { 'set-cookie': 'browser-qa=signed; HttpOnly; Path=/; Max-Age=3600', location: '/signed' })
        .end();
      return;
    }
    if (req.url === '/download') {
      res
        .writeHead(200, { 'content-type': 'text/plain', 'content-disposition': 'attachment; filename="lesson.txt"' })
        .end('teacher lesson');
      return;
    }
    if (req.url === '/uploaded') {
      let text = '';
      req.on('data', (data) => {
        text += data;
      });
      req.on('end', () => {
        uploaded = text;
        res.end('ok');
      });
      return;
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(
      `<h1>${req.headers.cookie?.includes('browser-qa=signed') ? 'Welcome 老師' : 'Guest'}</h1><input id="name"><a id="signin" href="/signin">Sign in</a><a id="download" href="/download">Download</a><input type="file" onchange="this.files[0].text().then(text=>fetch('/uploaded',{method:'POST',body:text}))">`
    );
  });
  console.log('Listening for fixtures');
  const backendPort = await listen(backend);
  console.log('Fixtures ready');
  const browsers = new Set<BrowserContext>();
  const newRuntime = () =>
    createBrowserRuntime({
      dataDir: directory,
      manager: new SharedBrowserManager(directory, {
        launch: async (profile, options) => {
          const browser = await chromium.launchPersistentContext(profile, options);
          browsers.add(browser);
          browser.once('close', () => browsers.delete(browser));
          return browser;
        },
      }),
    });
  let runtime = await newRuntime();
  runtime.setBackendPort(backendPort);
  const server = http.createServer((req, res) => {
    void runtime.handleRequest(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  console.log('Starting public browser bridge');
  const base = `http://127.0.0.1:${await listen(server)}`;
  console.log('Browser bridge ready');
  const site = `http://127.0.0.1:${backendPort}`;
  const clients: Client[] = [];
  const connection = async (task: string): Promise<Client> => {
    const client = new Client({ name: 'browser-smoke', version: '1.0.0' });
    const env = {
      ...process.env,
      AIONUI_BROWSER_GATEWAY: runtime.env.AIONUI_BROWSER_GATEWAY,
      AIONUI_BROWSER_CAPABILITY: signBrowserCapability(runtime.env.AIONUI_BROWSER_SIGNING_KEY, tasks[task], task),
      AIONUI_RUNTIME_TOKEN: 'synthetic-browser-fixture',
    } as Record<string, string>;
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('./mcp.ts', import.meta.url))],
        env,
        stderr: 'pipe',
      })
    );
    clients.push(client);
    return client;
  };
  const tool = async (client: Client, action: BrowserAction) =>
    client.callTool({ name: 'browser', arguments: { action } });
  const result = (response: Awaited<ReturnType<typeof tool>>): { state: BrowserState; page: string } => {
    assert(!response.isError, 'MCP browser action failed: ' + JSON.stringify(response.content));
    const content = response.content as { type: string; text?: string }[];
    return JSON.parse(content.find((item) => item.type === 'text')!.text!);
  };
  const ui = async (operation: string, input?: unknown): Promise<BrowserResult> => {
    const response = await fetch(`${base}/api/edu/browser/task-one/${operation}`, {
      method: input ? 'POST' : 'GET',
      headers: { cookie: 'qa=teacher', 'content-type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    assert(response.ok, 'UI browser request failed');
    return ((await response.json()) as { data: BrowserResult }).data;
  };
  try {
    console.log('MCP handshake');
    const agent = await connection('task-one');
    console.log('Open shared page');
    const opened = result(await tool(agent, { kind: 'open', url: site }));
    const tabId = opened.state.activeTabId!;
    assert(opened.page.includes('Guest'));
    assert((await ui('frame')).image, 'Manual viewport must show the agent page');
    console.log('Manual takeover');
    await ui('control', { control: 'human' });
    assert((await tool(agent, { kind: 'inspect' })).isError, 'AI must pause while user has control');
    await ui('action', { kind: 'fill', tabId, selector: '#name', text: '老師中文輸入' });
    await ui('action', {
      kind: 'upload',
      tabId,
      selector: 'input[type=file]',
      name: '中文.txt',
      base64: Buffer.from('老師上載').toString('base64'),
    });
    for (let attempt = 0; attempt < 30 && uploaded !== '老師上載'; attempt++) await delay();
    assert.equal(uploaded, '老師上載');
    await ui('action', { kind: 'clickElement', tabId, selector: '#signin' });
    await ui('action', { kind: 'clickElement', tabId, selector: '#download' });
    let download: BrowserState['downloads'][number] | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      download = (await ui('frame')).state.downloads.find((item) => item.state === 'ready');
      if (download) break;
      await delay();
    }
    assert(download, 'Download must be saved in the task folder');
    assert.equal(await readFile(path.join(directory, 'task-one', download.name), 'utf8'), 'teacher lesson');
    console.log('Return to AI');
    await ui('control', { control: 'agent' });
    assert(
      (await tool(agent, { kind: 'click', tabId, x: 1, y: 1 })).isError,
      'A fresh inspection is required after handoff'
    );
    const resumed = result(await tool(agent, { kind: 'inspect' }));
    assert.equal(resumed.state.activeTabId, tabId);
    assert(resumed.page.includes('Welcome 老師'));
    const sibling = await connection('task-two');
    const siblingPage = result(await tool(sibling, { kind: 'open', url: site + '/signed' }));
    assert(siblingPage.page.includes('Welcome 老師'));
    assert((await tool(sibling, { kind: 'snapshot', tabId })).isError, 'Task tabs must be isolated');
    const other = await connection('task-three');
    assert(
      result(await tool(other, { kind: 'open', url: site + '/signed' })).page.includes('Guest'),
      'User profiles must be isolated'
    );
    console.log('Release empty browser and reopen the saved profile');
    result(await tool(agent, { kind: 'close', tabId }));
    assert.equal(browsers.size, 2, 'A sibling task must keep its shared browser running');
    result(await tool(sibling, { kind: 'close', tabId: siblingPage.state.activeTabId! }));
    assert.equal(browsers.size, 1, 'Closing the last tab must release only that user browser');
    assert(
      result(await tool(agent, { kind: 'open', url: site + '/signed' })).page.includes('Welcome 老師'),
      'Releasing Chromium must preserve website sign-ins'
    );
    assert.equal(browsers.size, 2, 'Reopening a task must start its browser again');
    console.log('Codex discovery');
    await codexInventory(
      {
        ...runtime.env,
        AIONUI_USER_ID: 'teacher',
        AIONUI_CONVERSATION_ID: 'task-one',
        AIONUI_RUNTIME_TOKEN: 'synthetic-browser-fixture',
      },
      directory
    );
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await runtime.close();
    runtime = await newRuntime();
    runtime.setBackendPort(backendPort);
    const reopened = await connection('task-one');
    assert(
      result(await tool(reopened, { kind: 'open', url: site + '/signed' })).page.includes('Welcome 老師'),
      'Login must survive browser restart'
    );
    console.log(
      'Shared browser passed: same-page handoff, Chinese upload, task/user isolation, downloads, last-tab release, persistent login and MCP.'
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await runtime.close();
    await Promise.all([close(server), close(backend)]);
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runBrowserSmoke().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Shared browser smoke failed');
    process.exitCode = 1;
  });
}
