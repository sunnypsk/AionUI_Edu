import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContainer } from '../container.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn(), writeFile: vi.fn(), access: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFileSync: mocks.execFileSync }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  chown: vi.fn(),
  writeFile: mocks.writeFile,
  access: mocks.access,
}));
vi.mock('../proxy.js', () => ({
  loadProxySettings: async () => ({ enabled: true, proxyUrl: 'fixture' }),
  resolveSocksProxy: async () => ({ username: 'alice', password: 'private' }),
  buildTunConfig: () => ({}),
  buildEgressRules: () => [{ command: 'iptables', args: ['-A', 'fixture'] }],
  proxyFingerprint: () => 'fixture',
  TUN_DNS: '198.18.0.2',
  TUN_INTERFACE: 'fixture',
}));

function child(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    stderr: new PassThrough(),
    exitCode: null as number | null,
    signalCode: null as string | null,
    kill: vi.fn(),
  });
}

describe('container failure diagnostics and shutdown', () => {
  let tunnel: ReturnType<typeof child>;
  let app: ReturnType<typeof child>;
  const exit = vi.fn();
  const kill = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal('process', {
      ...process,
      platform: 'linux',
      getuid: () => 0,
      env: { AIONUI_CONTAINER: '1', AIONUI_APP_ROOT: '/fixture/app' },
      once: vi.fn(),
      exit,
      kill,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tunnel = child(101);
    app = child(102);
    mocks.spawn.mockReset().mockReturnValueOnce(tunnel).mockReturnValueOnce(app);
    mocks.access.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a redacted tunnel exit and terminates the app without removing egress rules', async () => {
    await runContainer();
    tunnel.stderr.write('authentication failed ali');
    tunnel.stderr.write('ce private\n');
    tunnel.emit('exit', 1, null);
    app.exitCode = 0;
    app.emit('exit', 0, null);
    const diagnostics = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(diagnostics).toContain('SOCKS5 process exited code=1 signal=null');
    expect(diagnostics).not.toMatch(/alice|private/);
    expect(kill).toHaveBeenCalledWith(-102, 'SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.execFileSync.mock.calls.some(([, args]) => args.includes('-D') || args.includes('-X'))).toBe(false);
  });

  it('reports an application abort signal and stops the tunnel once', async () => {
    await runContainer();
    app.signalCode = 'SIGABRT';
    app.emit('exit', null, 'SIGABRT');
    tunnel.emit('exit', 0, null);
    expect(console.error).toHaveBeenCalledWith('[network] Application exited code=null signal=SIGABRT');
    expect(tunnel.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('launches the bundled Node host from the explicit application root', async () => {
    await runContainer();
    const [, args, options] = mocks.spawn.mock.calls[1];
    const root = path.resolve('/fixture/app');
    expect(args.slice(-5)).toEqual([
      'node',
      path.join(root, 'dist-server', 'host', 'webui.mjs'),
      '--no-build',
      '--no-open',
      '--remote',
    ]);
    expect(options.env.AIONUI_APP_ROOT).toBe(root);
    expect(options.cwd).toBe(root);
  });

  it('fails before starting networking or the application if bundled assets are missing', async () => {
    mocks.access.mockRejectedValueOnce(new Error('missing file'));
    await expect(runContainer()).rejects.toThrow('CONTAINER_ASSETS_MISSING');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it('handles diagnostic stream failure without logging the raw exception', async () => {
    await runContainer();
    tunnel.stderr.emit('error', new Error('private configuration'));
    expect(console.error).toHaveBeenCalledWith('[network] SOCKS5 diagnostics failed code=CONTAINER_STARTUP_FAILED');
    expect(kill).toHaveBeenCalledWith(-102, 'SIGTERM');
  });
});
