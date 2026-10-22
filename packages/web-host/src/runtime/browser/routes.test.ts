import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRuntime, signBrowserCapability } from './routes.js';
import { browserCodexLaunch } from './launcher.js';
import { SharedBrowserManager } from './manager.js';
import { BrowserRuntimeError } from './types.js';

describe('shared browser authorization and Codex integration', () => {
  let directory: string;
  let backend: http.Server;
  let server: http.Server;
  let runtime: Awaited<ReturnType<typeof createBrowserRuntime>>;
  let base: string;
  let authChecks: number;
  let manager: SharedBrowserManager;
  const listen = async (server: http.Server): Promise<number> => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    return (server.address() as { port: number }).port;
  };
  beforeEach(async () => {
    authChecks = 0;
    directory = await mkdtemp(path.join(os.tmpdir(), 'browser-routes-'));
    backend = http.createServer((req, res) => {
      if (req.url === '/api/auth/user') authChecks++;
      const signedIn = req.headers.cookie === 'session=valid';
      const runtimeValid =
        req.headers['x-aionui-runtime-token'] === 'runtime-secret' &&
        req.headers['x-aionui-user-id'] === 'teacher' &&
        req.headers['x-aionui-conversation-id'] === 'task-one';
      if ((!signedIn && !runtimeValid) || (req.url === '/api/auth/user' && !signedIn)) {
        res.writeHead(401).end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/system/current-user') res.end(JSON.stringify({ data: { id: 'teacher' } }));
      else if (req.url === '/api/conversations/task-one')
        res.end(JSON.stringify({ data: { id: 'task-one', extra: { workspace: directory } } }));
      else if (req.url === '/api/auth/user') res.end(JSON.stringify({ user: { id: 'teacher' } }));
      else res.writeHead(404).end('{}');
    });
    manager = new SharedBrowserManager(directory);
    runtime = await createBrowserRuntime({ dataDir: directory, manager });
    runtime.setBackendPort(await listen(backend));
    server = http.createServer((req, res) => {
      void runtime.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await runtime.close();
    for (const item of [server, backend]) {
      item.closeAllConnections();
      await new Promise<void>((resolve) => item.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  });
  const request = (route: string, options: RequestInit = {}): Promise<Response> =>
    fetch(base + '/api/edu/browser/' + route, { ...options, headers: { cookie: 'session=valid', ...options.headers } });

  it('returns a diagnostic stage and correlation id without logging browser input', async () => {
    vi.spyOn(manager, 'act').mockRejectedValue(new BrowserRuntimeError('BROWSER_START_FAILED', 'launch'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await request('task-one/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'open', url: 'https://example.com/private?token=fixture-secret' }),
    });
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: 'BROWSER_START_FAILED', stage: 'launch', diagnostic_id: expect.any(String) },
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('fixture-secret');
  });

  it.each([
    ['BROWSER_SELECTOR_AMBIGUOUS', 2],
    ['BROWSER_SELECTOR_NOT_FOUND', 0],
  ])('preserves the bounded %s diagnosis for callers', async (code, matchCount) => {
    vi.spyOn(manager, 'act').mockRejectedValue(
      new BrowserRuntimeError(String(code), 'selector', { matchCount: Number(matchCount) })
    );
    const response = await request('task-one/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'open', url: 'https://example.com' }),
    });
    expect(await response.json()).toMatchObject({ error: { code, stage: 'selector', details: { matchCount } } });
  });

  it('rejects anonymous requests even when the backend local identity route might allow them', async () => {
    expect((await fetch(base + '/api/edu/browser/task-one/state')).status).toBe(401);
  });
  it('does not expose another task through a valid session', async () => {
    expect((await request('task-other/state')).status).toBe(403);
  });
  it('reuses a short authentication lease for viewport polls without caching failed sessions', async () => {
    await Promise.all(Array.from({ length: 20 }, () => request('task-one/state')));
    expect(authChecks).toBe(1);
    const response = await fetch(base + '/api/edu/browser/task-one/state', { headers: { cookie: 'invalid-session' } });
    expect(response.status).toBe(401);
  });

  it('rejects cross-origin takeover without changing control', async () => {
    const response = await request('task-one/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
      body: JSON.stringify({ control: 'human' }),
    });
    expect(response.status).toBe(403);
    expect((await (await request('task-one/state')).json()).data.control).toBe('agent');
  });
  it('validates browser actions before launching a browser', async () => {
    const response = await request('task-one/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'evaluate', script: 'secret' }),
    });
    expect(response.status).toBe(400);
    expect((await (await request('task-one/state')).json()).data.running).toBe(false);
  });
  it('rejects a forged or task-mismatched MCP capability', async () => {
    for (const capability of [
      'forged',
      signBrowserCapability(runtime.env.AIONUI_BROWSER_SIGNING_KEY, 'teacher', 'task-other'),
    ]) {
      const response = await fetch(runtime.env.AIONUI_BROWSER_GATEWAY, {
        method: 'POST',
        headers: { 'x-aionui-browser-capability': capability, 'x-aionui-runtime-token': 'runtime-secret' },
        body: JSON.stringify({ kind: 'inspect' }),
      });
      expect(response.status).toBe(401);
    }
  });
  it('authorizes MCP inspection with the bound runtime context', async () => {
    const response = await fetch(runtime.env.AIONUI_BROWSER_GATEWAY, {
      method: 'POST',
      headers: {
        'x-aionui-browser-capability': signBrowserCapability(
          runtime.env.AIONUI_BROWSER_SIGNING_KEY,
          'teacher',
          'task-one'
        ),
        'x-aionui-runtime-token': 'runtime-secret',
      },
      body: JSON.stringify({ kind: 'inspect' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.state.tabs).toEqual([]);
  });
  it('blocks MCP requests while the user has control', async () => {
    await request('task-one/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ control: 'human' }),
    });
    const response = await fetch(runtime.env.AIONUI_BROWSER_GATEWAY, {
      method: 'POST',
      headers: {
        'x-aionui-browser-capability': signBrowserCapability(
          runtime.env.AIONUI_BROWSER_SIGNING_KEY,
          'teacher',
          'task-one'
        ),
        'x-aionui-runtime-token': 'runtime-secret',
      },
      body: JSON.stringify({ kind: 'inspect' }),
    });
    expect((await response.json()).error.code).toBe('BROWSER_HUMAN_CONTROL');
  });
  it('injects MCP only for task app-server processes and keeps credentials out of argv', () => {
    const env = {
      ...runtime.env,
      AIONUI_USER_ID: 'teacher',
      AIONUI_CONVERSATION_ID: 'task-one',
      AIONUI_RUNTIME_TOKEN: 'runtime-secret',
    };
    const launch = browserCodexLaunch(['app-server'], env);
    expect(launch.args.join(' ')).toContain('mcp_servers.aionui_browser.command');
    expect(launch.args.join(' ')).not.toContain('runtime-secret');
    expect(launch.env.AIONUI_BROWSER_SIGNING_KEY).toBeUndefined();
  });
  it.each([['--version'], ['login'], ['features', 'list']])('leaves non-server commands unmodified: %j', (...args) => {
    expect(browserCodexLaunch(args, runtime.env).args).toEqual(args);
  });
  it('disables account tools even without a browser capability or a conversation context', () => {
    const launch = browserCodexLaunch(['app-server', '--listen', 'stdio://'], {});
    expect(launch.browser).toBeUndefined();
    expect(launch.args).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '-c',
      'features.apps=false',
      '-c',
      'features.plugins=false',
      '-c',
      'features.remote_plugin=false',
    ]);
  });
  it('overrides attempts to enable account integrations without mutating the caller options', () => {
    const args = ['-c', 'features.apps=true', '-c', 'features.plugins=true', 'app-server'];
    const launch = browserCodexLaunch(args, {});
    const effective = Object.fromEntries(
      launch.args.filter((arg) => arg.startsWith('features.')).map((arg) => arg.split('='))
    );
    expect(effective).toEqual({
      'features.apps': 'false',
      'features.plugins': 'false',
      'features.remote_plugin': 'false',
    });
    expect(args).toEqual(['-c', 'features.apps=true', '-c', 'features.plugins=true', 'app-server']);
  });
});
