import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpecialistRuntime } from '../../droid/routes.js';
import { SpecialistManager } from '../../droid/manager.js';
import { signBrowserCapability } from '../../browser/types.js';
import { specialistCodexLaunch } from '../../droid/launcher.js';
import { browserCodexLaunch, browserCodexSpawn } from '../../browser/launcher.js';
import { startStaticServer, type StaticServerHandle } from '../../../static-server.js';

describe('specialist gateway ownership and parent Stop', () => {
  let directory: string;
  let core: http.Server;
  let runtime: Awaited<ReturnType<typeof createSpecialistRuntime>>;
  let host: StaticServerHandle;
  let capability: string;
  let manager: SpecialistManager;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'aion-gateway-'));
    core = http.createServer((req, res) => {
      const authenticated =
        req.headers.cookie === 'fixture=teacher' || req.headers['x-aionui-runtime-token'] === 'fixture-runtime';
      res.setHeader('content-type', 'application/json');
      if (!authenticated) {
        res.writeHead(401).end('{}');
        return;
      }
      if (req.url === '/api/auth/user' && req.headers.cookie === 'fixture=teacher')
        res.end(JSON.stringify({ data: { user: { id: 'teacher' } } }));
      else if (req.url === '/api/system/current-user') res.end(JSON.stringify({ data: { id: 'teacher' } }));
      else if (req.url === '/api/conversations/lesson')
        res.end(JSON.stringify({ data: { id: 'lesson', extra: { workspace: directory } } }));
      else if (req.url === '/api/conversations/lesson/cancel') res.end(JSON.stringify({ data: { idle: true } }));
      else res.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => core.listen(0, '127.0.0.1', resolve));
    manager = new SpecialistManager(directory, {
      open: async () => {
        throw new Error('SPECIALIST_AUTH_REQUIRED');
      },
    });
    runtime = await createSpecialistRuntime({ dataDir: directory, manager });
    runtime.setBackendPort((core.address() as { port: number }).port);
    capability = signBrowserCapability(runtime.env.AIONUI_SPECIALISTS_SIGNING_KEY, 'teacher', 'lesson');
    host = await startStaticServer({
      staticDir: directory,
      backendPort: (core.address() as { port: number }).port,
      port: 0,
      handleRequest: runtime.handleRequest,
      onBackendResponse: runtime.onBackendResponse,
    });
  });
  afterEach(async () => {
    await runtime.close();
    await host.stop();
    core.closeAllConnections();
    await new Promise<void>((resolve) => core.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const privateCall = (route: string, data: unknown, cap = capability, token = 'fixture-runtime') =>
    fetch(`${runtime.env.AIONUI_SPECIALISTS_GATEWAY}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aionui-specialist-capability': cap,
        'x-aionui-runtime-token': token,
      },
      body: JSON.stringify(data),
    });
  it('rejects invalid capability and runtime token independently', async () => {
    expect((await privateCall('command', { name: 'specialist_get', arguments: {} }, 'wrong')).status).toBe(401);
    expect((await privateCall('command', { name: 'specialist_get', arguments: {} }, capability, 'wrong')).status).toBe(
      401
    );
  });
  it('requires a real browser session even when local Core identity is available', async () => {
    const response = await fetch(`${host.url}/api/edu/specialists/tasks?conversation_id=lesson`);
    expect(response.status).toBe(401);
  });
  it('refuses cross-origin cancellation even with a valid session cookie', async () => {
    const response = await fetch(`${host.url}/api/edu/specialists/cancel?conversation_id=lesson`, {
      method: 'POST',
      headers: { cookie: 'fixture=teacher', origin: 'https://foreign.invalid', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });
  it('interprets an owned idle-parent cancel response as Stop intent', async () => {
    await privateCall('lifecycle', { event: 'start', event_id: 'first', thread_id: 'parent' });
    const response = await fetch(`${host.url}/api/conversations/lesson/cancel`, {
      method: 'POST',
      headers: { cookie: 'fixture=teacher', 'content-type': 'application/json' },
      body: '{"turn_id":"stale"}',
    });
    expect(response.status).toBe(200);
    const start = await privateCall('command', {
      name: 'specialist_start',
      arguments: { specialist: 'argon', prompt: 'late' },
    });
    expect(await start.json()).toEqual({ error: { code: 'SPECIALIST_PARENT_STOPPED' } });
  });
  it('an unowned Stop does not change the admission state', async () => {
    await privateCall('lifecycle', { event: 'start', event_id: 'first', thread_id: 'parent' });
    await fetch(`${host.url}/api/conversations/lesson/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const start = await privateCall('command', {
      name: 'specialist_start',
      arguments: { specialist: 'argon', prompt: 'allowed' },
    });
    expect(start.status).toBe(200);
  });
});

describe('scoped specialist launcher', () => {
  const env = {
    AIONUI_SPECIALISTS_SIGNING_KEY: 'specialist-key',
    AIONUI_SPECIALISTS_GATEWAY: 'http://127.0.0.1:1',
    AIONUI_BROWSER_SIGNING_KEY: 'browser-key',
    AIONUI_BROWSER_GATEWAY: 'http://127.0.0.1:2',
    AIONUI_USER_ID: 'teacher',
    AIONUI_CONVERSATION_ID: 'lesson',
    AIONUI_RUNTIME_TOKEN: 'runtime',
  };
  it('removes both signing keys and combines browser and specialist configuration', () => {
    const browser = browserCodexLaunch(['app-server'], env);
    const specialists = specialistCodexLaunch(browser.args, browser.env);
    const child = browserCodexSpawn('codex', { ...browser, ...specialists });
    expect(specialists.env.AIONUI_SPECIALISTS_SIGNING_KEY).toBeUndefined();
    expect(specialists.env.AIONUI_BROWSER_SIGNING_KEY).toBeUndefined();
    expect(Object.keys(JSON.parse(child.args[1]))).toEqual(['aionui_browser', 'aionui_specialists']);
  });
  it('does not inject tools into non-app-server commands', () => {
    const launch = specialistCodexLaunch(['--version'], env);
    expect(launch.args).toEqual(['--version']);
    expect(launch.specialists).toBeUndefined();
  });
});
