import http, { type IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionValidator } from '../sessionAuth.js';
import { createBrowserRuntime } from '../browser/routes.js';
import { createSpecialistRuntime } from '../droid/routes.js';
import { createAudioRuntime } from '../../audio/routes.js';
import { createRuntimeControls } from '../routes.js';

afterEach(() => vi.restoreAllMocks());

describe('shared session validation leases', () => {
  it('coalesces concurrent requests, expires successful leases and separates credentials', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const user = (init!.headers as Record<string, string>).authorization;
      return Response.json({ data: { user: { id: user === 'Bearer bob' ? 'bob' : 'alice' } } });
    });
    const auth = new SessionValidator(() => 1234);
    expect(await Promise.all(Array.from({ length: 12 }, () => auth.validate({ cookie: 'session=alice' })))).toEqual(
      Array(12).fill('alice')
    );
    expect(request).toHaveBeenCalledTimes(1);
    await auth.validate({ authorization: 'Bearer bob' });
    now += 15001;
    await auth.validate({ cookie: 'session=alice' });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([401, 500])('does not cache a %s as a successful session', async (status) => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));
    const auth = new SessionValidator(() => 1234);
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(auth.validate({ cookie: 'session=alice' })).rejects.toMatchObject({
        status: status === 401 ? 401 : 503,
      });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['7', 7000],
    [null, 5000],
    ['invalid', 5000],
  ] as const)(
    'shares a 429 cooldown with Retry-After %s without converting it to logout',
    async (retryAfter, delay) => {
      let now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const request = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response('{}', { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} })
        );
      const auth = new SessionValidator(() => 1234);
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(auth.validate({ cookie: 'session=alice' })).rejects.toMatchObject({
          status: 429,
          message: 'RATE_LIMITED',
          retryAfter: String(delay / 1000),
        });
      expect(request).toHaveBeenCalledTimes(1);
      now += delay + 1;
      await expect(auth.validate({ cookie: 'session=alice' })).rejects.toMatchObject({ status: 429 });
      expect(request).toHaveBeenCalledTimes(2);
    }
  );

  it('invalidates an in-flight lease on logout without letting completion restore it', async () => {
    let complete!: (response: Response) => void;
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          })
      )
      .mockImplementation(async () => Response.json({ user: { id: 'alice' } }));
    const auth = new SessionValidator(() => 1234);
    const pending = auth.validate({ cookie: 'session=alice' });
    auth.onBackendResponse({ method: 'POST', url: '/logout' } as IncomingMessage, 200);
    complete(Response.json({ user: { id: 'alice' } }));
    await pending;
    await auth.validate({ cookie: 'session=alice' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('mixed public runtime polling', () => {
  it('shares one auth request across four modules while preserving live ownership checks and 429', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-auth-'));
    const requests: string[] = [];
    let limited = false;
    const backend = http.createServer((req, res) => {
      requests.push(req.url!);
      res.setHeader('content-type', 'application/json');
      if (limited && req.url === '/api/auth/user') {
        res.writeHead(429, { 'retry-after': '8' }).end('{}');
        return;
      }
      if (req.url === '/api/auth/user') res.end(JSON.stringify({ user: { id: 'teacher' } }));
      else if (req.url === '/api/system/current-user') res.end(JSON.stringify({ data: { id: 'teacher' } }));
      else if (req.url === '/api/conversations/lesson')
        res.end(JSON.stringify({ data: { id: 'lesson', extra: { workspace: directory } } }));
      else res.writeHead(404).end('{}');
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const backendPort = (backend.address() as { port: number }).port;
    const sessionAuth = new SessionValidator(() => backendPort);
    const browser = await createBrowserRuntime({ dataDir: directory, sessionAuth });
    const specialists = await createSpecialistRuntime({ dataDir: directory, sessionAuth });
    const audio = await createAudioRuntime({ dataDir: directory, sessionAuth });
    const controls = createRuntimeControls({
      dataDir: directory,
      backendPort,
      sessionAuth,
      auth: {
        status: async () => ({ authenticated: false, login: { state: 'idle' } }),
        close: () => {},
        startLogin: vi.fn(),
        cancelLogin: vi.fn(),
        logout: vi.fn(),
      },
    });
    for (const runtime of [browser, specialists, audio]) runtime.setBackendPort(backendPort);
    const runtimes = [audio, specialists, browser, controls];
    const server = http.createServer((req, res) => {
      void (async () => {
        for (const runtime of runtimes) if (await runtime.handleRequest(req, res)) return;
        res.writeHead(404).end();
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const paths = [
      '/api/edu/browser/lesson/state',
      '/api/edu/specialists/tasks?conversation_id=lesson',
      '/api/edu/audio/settings',
      '/api/edu/codex/account',
    ];
    const poll = (route: string) => fetch(base + route, { headers: { cookie: 'session=teacher' } });
    try {
      expect((await Promise.all(paths.map(poll))).map((response) => response.status)).toEqual([200, 200, 200, 200]);
      expect(requests.filter((route) => route === '/api/auth/user')).toHaveLength(1);
      expect((await poll('/api/edu/browser/other-account/state')).status).toBe(403);
      limited = true;
      sessionAuth.clear();
      const responses = await Promise.all(paths.map(poll));
      expect(responses.map((response) => [response.status, response.headers.get('retry-after')])).toEqual(
        Array(4).fill([429, '8'])
      );
      expect(requests.filter((route) => route === '/api/auth/user')).toHaveLength(2);
    } finally {
      controls.close();
      await Promise.all([audio.close(), specialists.close(), browser.close()]);
      for (const listener of [server, backend]) {
        listener.closeAllConnections();
        await new Promise<void>((resolve) => listener.close(() => resolve()));
      }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
