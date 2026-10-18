import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeControls } from './routes.js';
import { NetworkProxyStore } from './proxy.js';

const signedOut = { authenticated: false, login: { state: 'idle' as const } };
const versionStatus = {
  installedVersion: '0.163.0',
  latestVersion: null,
  checkedAt: null,
  updateAvailable: null,
  canInstall: true,
  installation: { phase: 'idle' as const, targetVersion: null },
};

describe('authenticated WebUI runtime controls', () => {
  let dataDir: string;
  let backend: http.Server;
  let server: http.Server;
  let base: string;
  let controls: ReturnType<typeof createRuntimeControls>;
  let backendHealthy: boolean;
  const updates = {
    status: vi.fn(),
    check: vi.fn(),
    install: vi.fn(),
    versions: vi.fn(),
    cleanup: vi.fn(),
    close: vi.fn(),
  };
  const proxyProbe = vi.fn();
  const auth = {
    status: vi.fn().mockResolvedValue(signedOut),
    startLogin: vi.fn().mockResolvedValue(signedOut),
    cancelLogin: vi.fn().mockResolvedValue(signedOut),
    logout: vi.fn().mockResolvedValue(signedOut),
    close: vi.fn(),
  };
  const listen = async (listener: http.Server) => {
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    return (listener.address() as { port: number }).port;
  };
  const request = (route: string, options: RequestInit = {}) =>
    fetch(base + route, { ...options, headers: { cookie: 'test-session=valid', ...options.headers } });

  beforeEach(async () => {
    vi.clearAllMocks();
    auth.status.mockResolvedValue(signedOut);
    updates.status.mockResolvedValue(versionStatus);
    proxyProbe.mockResolvedValue({ state: 'success', elapsedMs: 30 });
    updates.check.mockResolvedValue(versionStatus);
    updates.install.mockResolvedValue(versionStatus);
    updates.versions.mockResolvedValue({ versions: [], supported: true, inspectionComplete: true, busy: false });
    updates.cleanup.mockResolvedValue({ removed: [], retained: [], inventory: await updates.versions() });
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-controls-test-'));
    backendHealthy = true;
    backend = http.createServer((req, res) => {
      const healthProbe = req.url === '/api/auth/internal/users/system';
      res.writeHead(
        healthProbe ? (backendHealthy ? 200 : 503) : req.headers.cookie === 'test-session=valid' ? 200 : 401,
        { 'content-type': 'application/json' }
      );
      res.end('{}');
    });
    const backendPort = await listen(backend);
    controls = createRuntimeControls({
      backendPort,
      dataDir,
      auth,
      updates,
      proxy: new NetworkProxyStore(dataDir, {}, proxyProbe),
      sourceCommit: 'a'.repeat(40),
      releaseSequence: '12.1',
    });
    server = http.createServer((req, res) => {
      void controls.handleRequest(req, res).then((handled) => {
        if (!handled) res.writeHead(404).end();
      });
    });
    base = `http://127.0.0.1:${await listen(server)}`;
  });
  afterEach(async () => {
    controls?.close();
    for (const listener of [server, backend]) {
      listener?.closeAllConnections();
      if (listener?.listening) await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it('does not start Codex or return account details to an anonymous request', async () => {
    const response = await fetch(base + '/api/edu/codex/account');
    expect(response.status).toBe(401);
    expect(auth.status).not.toHaveBeenCalled();
  });

  it('reports the running build without starting Codex or exposing account details', async () => {
    const response = await fetch(base + '/healthz');
    expect(await response.json()).toEqual({
      ok: true,
      app: 'aionui-edu',
      sourceCommit: 'a'.repeat(40),
      releaseSequence: '12.1',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(auth.status).not.toHaveBeenCalled();
  });

  it('fails the health check when the backend is unavailable', async () => {
    backendHealthy = false;
    expect((await fetch(base + '/healthz')).status).toBe(503);
  });

  it('validates the session with AionCore instead of trusting the presence of a cookie', async () => {
    const response = await request('/api/edu/codex/account', { headers: { cookie: 'test-session=invalid' } });
    expect(response.status).toBe(401);
    expect(auth.status).not.toHaveBeenCalled();
  });

  it('does not cache account responses containing device codes', async () => {
    const response = await request('/api/edu/codex/account');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: signedOut });
  });

  it('starts device login for an authenticated same-origin JSON request', async () => {
    const response = await request('/api/edu/codex/login', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(auth.startLogin).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin changes even when the request carries a valid cookie', async () => {
    const response = await request('/api/edu/codex/login', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(auth.startLogin).not.toHaveBeenCalled();
  });

  it('rejects form submissions to mutation endpoints', async () => {
    const response = await request('/api/edu/codex/logout', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('saves proxy credentials on the host without returning them in the response', async () => {
    const response = await request('/api/edu/network-proxy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, proxyUrl: 'socks5://user:private-password@192.0.2.1:1080' }),
    });
    const body = await response.json();
    expect(body.data).toMatchObject({ active: false, pendingRestart: true, hasCredentials: true });
    expect(JSON.stringify(body)).not.toContain('private-password');
  });

  it('rejects invalid proxy settings and leaves routing disabled', async () => {
    const response = await request('/api/edu/network-proxy', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, proxyUrl: 'http://user:private-password@192.0.2.1:1080' }),
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-password');
    expect((await (await request('/api/edu/network-proxy')).json()).data.enabled).toBe(false);
  });

  it('does not expose upstream CLI errors through the control API', async () => {
    auth.status.mockRejectedValueOnce(new Error('private upstream credential'));
    const response = await request('/api/edu/codex/account');
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private upstream credential');
  });

  it('does not run proxy probes for anonymous requests', async () => {
    const response = await fetch(base + '/api/edu/network-proxy/test', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(proxyProbe).not.toHaveBeenCalled();
  });

  it('rejects cross-origin proxy tests before accessing credentials or the network', async () => {
    const response = await request('/api/edu/network-proxy/test', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(proxyProbe).not.toHaveBeenCalled();
  });

  it('returns both proxy test results without saving the draft or caching credentials', async () => {
    const response = await request('/api/edu/network-proxy/test', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ proxyUrl: 'socks5://alice:private-password@192.0.2.1:1080' }),
    });
    expect(await response.json()).toEqual({
      data: {
        current: { state: 'skipped', reason: 'containerOnly' },
        configured: { state: 'success', elapsedMs: 30 },
        configuredSource: 'input',
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await (await request('/api/edu/network-proxy')).json()).data.endpoint).toBe('');
  });

  it('rejects unsupported proxy test request fields without running a probe', async () => {
    const response = await request('/api/edu/network-proxy/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://arbitrary.example' }),
    });
    expect(response.status).toBe(400);
    expect(proxyProbe).not.toHaveBeenCalled();
  });

  it('does not check versions for anonymous users', async () => {
    const response = await fetch(base + '/api/edu/codex/check-update', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(updates.check).not.toHaveBeenCalled();
  });

  it('returns installed version status without initiating a registry check', async () => {
    const response = await request('/api/edu/codex/version');
    expect(await response.json()).toEqual({ data: versionStatus });
    expect(updates.check).not.toHaveBeenCalled();
  });

  it('checks for updates only for an authenticated same-origin JSON request', async () => {
    const response = await request('/api/edu/codex/check-update', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(updates.check).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-origin update check before contacting npm', async () => {
    const response = await request('/api/edu/codex/check-update', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(updates.check).not.toHaveBeenCalled();
  });

  it('redacts update check failures', async () => {
    updates.check.mockRejectedValueOnce(new Error('private upstream detail'));
    const response = await request('/api/edu/codex/check-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private upstream detail');
  });

  it('queues an update for a signed-in user without granting Docker or shell access', async () => {
    const response = await request('/api/edu/codex/install-update', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(updates.install).toHaveBeenCalledTimes(1);
  });

  it('does not install for an anonymous request', async () => {
    const response = await fetch(base + '/api/edu/codex/install-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it('does not install for a cross-origin request with a valid session', async () => {
    const response = await request('/api/edu/codex/install-update', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it('rejects a user-supplied package version instead of passing it to the installer', async () => {
    const response = await request('/api/edu/codex/install-update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"version":"untrusted"}',
    });
    expect(response.status).toBe(400);
    expect(updates.install).not.toHaveBeenCalled();
  });

  it('returns the version inventory only after authenticating the session', async () => {
    const response = await request('/api/edu/codex/versions');
    expect(response.status).toBe(200);
    expect(updates.versions).toHaveBeenCalled();
  });

  it('accepts only an explicit list of installation IDs for cleanup', async () => {
    const id = '0.160.0-12345678-1234-1234-1234-123456789abc';
    const response = await request('/api/edu/codex/cleanup-versions', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    });
    expect(response.status).toBe(200);
    expect(updates.cleanup).toHaveBeenCalledWith([id]);
  });

  it('does not clean versions for an anonymous request', async () => {
    const response = await fetch(base + '/api/edu/codex/cleanup-versions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
    expect(updates.cleanup).not.toHaveBeenCalled();
  });

  it('does not clean versions from a cross-origin request with a valid cookie', async () => {
    const response = await request('/api/edu/codex/cleanup-versions', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect(updates.cleanup).not.toHaveBeenCalled();
  });

  it.each([{ ids: ['../../codex'] }, { ids: [] }, { ids: [42] }, { ids: ['latest'], all: true }, []])(
    'rejects malformed cleanup input %#',
    async (body) => {
      const response = await request('/api/edu/codex/cleanup-versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(updates.cleanup).not.toHaveBeenCalled();
    }
  );
});
