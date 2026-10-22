import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runContainer } from '../container.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn(), writeFile: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFileSync: mocks.execFileSync }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), chown: vi.fn(), writeFile: mocks.writeFile }));
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
      env: { AIONUI_CONTAINER: '1' },
      once: vi.fn(),
      exit,
      kill,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tunnel = child(101);
    app = child(102);
    mocks.spawn.mockReturnValueOnce(tunnel).mockReturnValueOnce(app);
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

  it('handles diagnostic stream failure without logging the raw exception', async () => {
    await runContainer();
    tunnel.stderr.emit('error', new Error('private configuration'));
    expect(console.error).toHaveBeenCalledWith('[network] SOCKS5 diagnostics failed code=CONTAINER_STARTUP_FAILED');
    expect(kill).toHaveBeenCalledWith(-102, 'SIGTERM');
  });
});
