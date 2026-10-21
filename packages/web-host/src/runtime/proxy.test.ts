import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NetworkProxyProbeResult } from '../types.js';
import {
  buildEgressRules,
  buildTunConfig,
  loadProxySettings,
  NetworkProxyStore,
  parseSocksProxy,
  resolveSocksProxy,
  proxyFingerprint,
  PROXY_FILE_NAME,
  probeProxyConnection,
} from './proxy.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

beforeEach(() => {
  vi.mocked(lookup).mockReset().mockRejectedValue(new Error('Unconfigured DNS fixture'));
});

afterEach(() => vi.useRealTimers());

describe('SOCKS5 full routing', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-proxy-test-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it.each([
    'http://192.0.2.1:1080',
    'socks5://bad_host.example:1080',
    'socks5://proxy..example:1080',
    'socks5://-proxy.example:1080',
    'socks5://192.0.2.1:0',
    'socks5://192.0.2.1:1080/?secret=password',
    'socks5://192.0.2.1:1080/path',
  ])('rejects invalid upstreams without disclosing their URL', (url) => {
    expect(() => parseSocksProxy(url)).toThrow(/^INVALID_SOCKS5_PROXY$/);
  });

  it('supports authenticated SOCKS5h with percent-encoded credentials and redacts the public endpoint', () => {
    const proxy = parseSocksProxy('socks5h://alice:p%40ss@192.0.2.1:1080');
    expect(proxy.password).toBe('p@ss');
    expect(proxy.endpoint).toBe('socks5://192.0.2.1:1080');
  });

  it('supports IPv6 upstream addresses', () => {
    expect(parseSocksProxy('socks5://[2001:db8::1]:1080').server).toBe('2001:db8::1');
  });

  it('accepts and normalizes authenticated hostname URLs without exposing credentials in the endpoint', () => {
    expect(parseSocksProxy('socks5h://alice:p%40ss@Proxy.Example:1080')).toMatchObject({
      server: 'proxy.example',
      password: 'p@ss',
      endpoint: 'socks5://proxy.example:1080',
    });
  });

  it('prefers a resolved IPv4 upstream and preserves encoded credentials', async () => {
    vi.mocked(lookup).mockResolvedValue([
      { address: '2001:db8::1', family: 6 },
      { address: '192.0.2.1', family: 4 },
    ]);
    expect(await resolveSocksProxy('socks5://alice:p%40ss@proxy.example:1080')).toMatchObject({
      server: '192.0.2.1',
      url: 'socks5://alice:p%40ss@192.0.2.1:1080',
      endpoint: 'socks5://192.0.2.1:1080',
    });
  });

  it('supports hostname upstreams with only IPv6 records', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '2001:db8::1', family: 6 }]);
    expect((await resolveSocksProxy('socks5://proxy.example:1080')).url).toBe('socks5://[2001:db8::1]:1080');
  });

  it('does not resolve IP literals', async () => {
    expect((await resolveSocksProxy('socks5://192.0.2.1:1080')).server).toBe('192.0.2.1');
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([[], [{ address: 'not-an-ip', family: 4 }]])('rejects DNS answers without an IP (%j)', async (answers) => {
    vi.mocked(lookup).mockResolvedValue(answers);
    await expect(resolveSocksProxy('socks5://alice:secret@proxy.example')).rejects.toThrow(
      /^SOCKS5_HOSTNAME_RESOLUTION_FAILED$/
    );
  });

  it('bounds DNS resolution time and clears its timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(lookup).mockReturnValue(new Promise(() => {}));
    const failure = expect(resolveSocksProxy('socks5://proxy.example')).rejects.toThrow(
      /^SOCKS5_HOSTNAME_RESOLUTION_FAILED$/
    );
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects unresolved hostnames at both routing boundaries', () => {
    const proxy = parseSocksProxy('socks5://proxy.example:1080');
    expect(() => buildTunConfig(proxy)).toThrow('SOCKS5_PROXY_IP_REQUIRED');
    expect(() => buildEgressRules(proxy)).toThrow('SOCKS5_PROXY_IP_REQUIRED');
  });

  it('pins saved hostnames to an IP so restarts and blank replacements do not require DNS', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.0.2.1', family: 4 }]);
    const store = new NetworkProxyStore(dataDir, {});
    expect(await store.save({ enabled: true, proxyUrl: 'socks5://alice:secret@proxy.example:1080' })).toMatchObject({
      endpoint: 'socks5://192.0.2.1:1080',
      hasCredentials: true,
    });
    await store.save({ enabled: false });
    expect(await loadProxySettings(dataDir, {})).toEqual({
      enabled: false,
      proxyUrl: 'socks5://alice:secret@192.0.2.1:1080',
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('preserves existing settings and redacts errors when hostname resolution fails', async () => {
    const store = new NetworkProxyStore(dataDir, {});
    await store.save({ enabled: true, proxyUrl: 'socks5://192.0.2.1:1080' });
    const before = await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8');
    vi.mocked(lookup).mockRejectedValue(new Error('private URL and credential detail'));
    await expect(store.save({ enabled: true, proxyUrl: 'socks5://alice:secret@proxy.example' })).rejects.toThrow(
      /^SOCKS5_HOSTNAME_RESOLUTION_FAILED$/
    );
    expect(await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8')).toBe(before);
  });

  it('resolves environment-managed hostnames before generating IP-only routing rules', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.0.2.1', family: 4 }]);
    const settings = await loadProxySettings(dataDir, { AIONUI_SOCKS5_PROXY: 'socks5://proxy.example:1080' });
    const proxy = await resolveSocksProxy(settings.proxyUrl);
    expect(buildTunConfig(proxy).outbounds).toEqual([expect.objectContaining({ server: '192.0.2.1' })]);
    expect(buildEgressRules(proxy).some((rule) => rule.args.includes('proxy.example'))).toBe(false);
  });

  it('sends both DNS and arbitrary destinations through SOCKS with no direct outbound', () => {
    const config = buildTunConfig(parseSocksProxy('socks5://192.0.2.1:1080'));
    expect(config).toMatchObject({
      dns: { strategy: 'ipv4_only', servers: [{ type: 'https', detour: 'socks' }] },
      route: { final: 'socks', rules: [{ port: 53, action: 'hijack-dns' }] },
    });
    expect(config.outbounds).toEqual([expect.objectContaining({ type: 'socks' })]);
    expect(config.inbounds).toEqual([
      expect.objectContaining({ auto_route: true, auto_redirect: true, strict_route: true }),
    ]);
  });

  it('installs reject rules for both families while permitting only the upstream socket and tunnel', () => {
    const rules = buildEgressRules(parseSocksProxy('socks5://192.0.2.1:1080'));
    expect(
      rules.filter((rule) => rule.args.length === 5 && rule.args.includes('REJECT')).map((rule) => rule.command)
    ).toEqual(['iptables', 'ip6tables']);
    expect(
      rules
        .filter((rule) => rule.args.includes('-d') && rule.args.includes('ACCEPT'))
        .map((rule) => rule.args[rule.args.indexOf('-d') + 1])
    ).toEqual(['192.0.2.1', '192.0.2.1']);
    expect(rules.find((rule) => rule.args.includes('udp') && rule.args.includes('ACCEPT'))?.args).toContain(
      '--uid-owner'
    );
    expect(rules).toContainEqual({
      command: 'iptables',
      args: ['-w', '-A', 'AIONUI_EGRESS', '-d', '127.0.0.11', '-j', 'REJECT'],
    });
  });

  it('stores credentials with restricted permissions but never returns them to the browser', async () => {
    const store = new NetworkProxyStore(dataDir, { AIONUI_CONTAINER: '1' });
    const status = await store.save({ enabled: true, proxyUrl: 'socks5://alice:secret@192.0.2.1:1080' });
    expect(status).toMatchObject({ enabled: true, active: false, pendingRestart: true, hasCredentials: true });
    expect(JSON.stringify(status)).not.toContain('secret');
    expect((await stat(path.join(dataDir, PROXY_FILE_NAME))).mode & 0o777).toBe(0o600);
  });

  it('allows local transparent redirects without reopening Docker resolver egress', () => {
    const rules = buildEgressRules(parseSocksProxy('socks5://192.0.2.1:1080'));
    for (const command of ['iptables', 'ip6tables']) {
      expect(
        rules.some(
          (rule) =>
            rule.command === command &&
            rule.args.includes('--dst-type') &&
            rule.args.includes('LOCAL') &&
            rule.args.includes('ACCEPT')
        )
      ).toBe(true);
    }
    expect(rules.findIndex((rule) => rule.args.includes('127.0.0.11'))).toBeLessThan(
      rules.findIndex((rule) => rule.args.includes('--dst-type'))
    );
  });

  it('keeps the existing password when the replacement field is left empty', async () => {
    const store = new NetworkProxyStore(dataDir, {});
    await store.save({ enabled: true, proxyUrl: 'socks5://alice:secret@192.0.2.1:1080' });
    await store.save({ enabled: false });
    expect(await loadProxySettings(dataDir, {})).toEqual({
      enabled: false,
      proxyUrl: 'socks5://alice:secret@192.0.2.1:1080',
    });
  });

  it('does not replace valid settings after an invalid save', async () => {
    const store = new NetworkProxyStore(dataDir, {});
    await store.save({ enabled: true, proxyUrl: 'socks5://192.0.2.1:1080' });
    const previous = await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8');
    await expect(store.save({ enabled: true, proxyUrl: 'invalid' })).rejects.toThrow('INVALID_SOCKS5_PROXY');
    expect(await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8')).toBe(previous);
  });

  it('fails closed when persisted configuration is corrupted', async () => {
    await writeFile(path.join(dataDir, PROXY_FILE_NAME), '{broken');
    await expect(loadProxySettings(dataDir, {})).rejects.toThrow();
  });

  it('keeps routing active until restart when the saved preference is disabled', async () => {
    const initial = { enabled: true, proxyUrl: 'socks5://192.0.2.1:1080' };
    const store = new NetworkProxyStore(dataDir, { AIONUI_ACTIVE_PROXY_HASH: proxyFingerprint(initial) });
    await store.save(initial);
    expect(await store.status()).toMatchObject({ active: true, pendingRestart: false });
    expect(await store.save({ enabled: false })).toMatchObject({ active: true, enabled: false, pendingRestart: true });
  });

  it('does not allow a Settings save to override an environment-managed proxy', async () => {
    const store = new NetworkProxyStore(dataDir, { AIONUI_SOCKS5_PROXY: 'socks5://192.0.2.1:1080' });
    await expect(store.save({ enabled: false })).rejects.toThrow('PROXY_MANAGED_BY_ENV');
  });
});

describe('read-only proxy connection tests', () => {
  let dataDir: string;
  const success = { state: 'success' as const, elapsedMs: 25 };
  const probe = vi.fn<(proxy?: ReturnType<typeof parseSocksProxy>) => Promise<NetworkProxyProbeResult>>();
  const settings = { enabled: true, proxyUrl: 'socks5://alice:private-password@192.0.2.1:1080' };
  const env = { AIONUI_CONTAINER: '1', AIONUI_ACTIVE_PROXY_HASH: proxyFingerprint(settings) };
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'aionui-probe-test-'));
    probe.mockReset().mockResolvedValue(success);
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('tests the actual route and saved credentials without modifying settings or exposing secrets', async () => {
    const store = new NetworkProxyStore(dataDir, env, probe);
    await store.save(settings);
    const before = await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8');
    const result = await store.test({});
    expect(result).toEqual({ current: success, configured: success, configuredSource: 'saved' });
    expect(probe.mock.calls.map(([proxy]) => proxy?.password)).toEqual([undefined, 'private-password']);
    expect(await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8')).toBe(before);
    expect(JSON.stringify(result)).not.toContain('private-password');
  });

  it('uses a draft instead of saved credentials and keeps pending-restart state unchanged', async () => {
    const store = new NetworkProxyStore(dataDir, env, probe);
    await store.save({ ...settings, enabled: false });
    const status = await store.status();
    const result = await store.test({ proxyUrl: 'socks5://draft:other-secret@192.0.2.2:1081' });
    expect(result.configuredSource).toBe('input');
    expect(probe.mock.calls[1][0]).toMatchObject({ server: '192.0.2.2', port: 1081, password: 'other-secret' });
    expect(await store.status()).toEqual(status);
  });

  it('tests environment-managed settings without requiring permission to save', async () => {
    const store = new NetworkProxyStore(dataDir, { ...env, AIONUI_SOCKS5_PROXY: settings.proxyUrl }, probe);
    expect(await store.test({ proxyUrl: '  ' })).toEqual({
      current: success,
      configured: success,
      configuredSource: 'environment',
    });
    expect(probe.mock.calls[1][0]?.password).toBe('private-password');
    await expect(readFile(path.join(dataDir, PROXY_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not send a direct request when container proxy routing is inactive', async () => {
    const store = new NetworkProxyStore(dataDir, { AIONUI_CONTAINER: '1' }, probe);
    await store.save({ ...settings, enabled: false });
    const result = await store.test({});
    expect(result.current).toEqual({ state: 'skipped', reason: 'proxyInactive' });
    expect(result.configured).toEqual(success);
    expect(probe).toHaveBeenCalledExactlyOnceWith(parseSocksProxy(settings.proxyUrl));
  });

  it('skips unsupported current routes and unconfigured proxies without launching probes', async () => {
    const store = new NetworkProxyStore(dataDir, {}, probe);
    expect(await store.test({})).toEqual({
      current: { state: 'skipped', reason: 'containerOnly' },
      configured: { state: 'skipped', reason: 'notConfigured' },
      configuredSource: 'saved',
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('keeps an invalid draft from suppressing the current route result', async () => {
    const store = new NetworkProxyStore(dataDir, env, probe);
    const result = await store.test({ proxyUrl: 'http://user:secret@192.0.2.2' });
    expect(result).toEqual({
      current: success,
      configured: { state: 'failed', reason: 'invalidProxy', elapsedMs: 0 },
      configuredSource: 'input',
    });
    expect(probe).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('tests a hostname draft through its resolved IP without saving it', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '192.0.2.2', family: 4 }]);
    const store = new NetworkProxyStore(dataDir, env, probe);
    const result = await store.test({ proxyUrl: 'socks5://alice:secret@proxy.example:1080' });
    expect(result.configured.state).toBe('success');
    expect(probe.mock.calls[1][0]).toMatchObject({ server: '192.0.2.2', password: 'secret' });
    await expect(readFile(path.join(dataDir, PROXY_FILE_NAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the current route result independent from DNS errors without disclosing credentials', async () => {
    vi.mocked(lookup).mockRejectedValue(new Error('private URL and credential detail'));
    const result = await new NetworkProxyStore(dataDir, env, probe).test({
      proxyUrl: 'socks5://alice:secret@proxy.example',
    });
    expect(result).toMatchObject({ current: success, configured: { state: 'failed', reason: 'connection' } });
    expect(probe).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });

  it('keeps a saved settings read failure independent from the current route', async () => {
    await writeFile(path.join(dataDir, PROXY_FILE_NAME), '{broken');
    const result = await new NetworkProxyStore(dataDir, env, probe).test({});
    expect(result.current).toEqual(success);
    expect(result.configured).toMatchObject({ state: 'failed', reason: 'settingsUnavailable' });
  });

  it('can test a new proxy even if the saved settings are corrupted', async () => {
    await writeFile(path.join(dataDir, PROXY_FILE_NAME), '{broken');
    const result = await new NetworkProxyStore(dataDir, env, probe).test({ proxyUrl: settings.proxyUrl });
    expect(result.configured).toEqual(success);
  });

  it('reports independent results when the current connection fails but the draft succeeds', async () => {
    probe.mockRejectedValueOnce(new Error('private connection detail'));
    const result = await new NetworkProxyStore(dataDir, env, probe).test({ proxyUrl: settings.proxyUrl });
    expect(result.current).toMatchObject({ state: 'failed', reason: 'unavailable' });
    expect(result.configured).toEqual(success);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it.each([null, [], { proxyUrl: 42 }, { url: 'https://arbitrary.example' }])(
    'rejects malformed requests before starting any network request (%j)',
    async (input) => {
      await expect(new NetworkProxyStore(dataDir, env, probe).test(input)).rejects.toThrow('INVALID_REQUEST');
      expect(probe).not.toHaveBeenCalled();
    }
  );
});

describe('bounded curl HTTPS probes', () => {
  const makeChild = () =>
    Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
    });
  let child: ReturnType<typeof makeChild>;
  beforeEach(() => {
    child = makeChild();
    vi.mocked(spawn)
      .mockReset()
      .mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => vi.useRealTimers());

  it('requires a successful HTTPS response with a valid public-address response', async () => {
    const result = probeProxyConnection();
    child.stdout.write('2001:db8::1\n200');
    child.emit('close', 0);
    expect(await result).toEqual({ state: 'success', elapsedMs: expect.any(Number) });
  });

  it('passes SOCKS5h credentials only over stdin and ignores inherited bypass settings', async () => {
    let config = '';
    child.stdin.on('data', (data: Buffer) => {
      config += data.toString();
    });
    const result = probeProxyConnection(parseSocksProxy('socks5://alice:private-password@192.0.2.1:1080'), {
      PATH: '/usr/bin',
      ALL_PROXY: 'other-secret',
      http_proxy: 'other-secret',
      NO_PROXY: '*',
    });
    child.stdout.write('192.0.2.1\n200');
    child.emit('close', 0);
    await result;
    expect(config).toContain('proxy = "socks5h://alice:private-password@192.0.2.1:1080"\nnoproxy = ""');
    expect(JSON.stringify(vi.mocked(spawn).mock.calls[0])).not.toContain('secret');
    expect(vi.mocked(spawn).mock.calls[0]).toMatchObject([
      'curl',
      expect.arrayContaining(['--disable', '--config', '-', '--proto', '=https', '--url', 'https://api.ipify.org']),
      { env: { PATH: '/usr/bin' } },
    ]);
  });

  it('explicitly disables application-level proxies when checking the running TUN route', async () => {
    let config = '';
    child.stdin.on('data', (data: Buffer) => {
      config += data.toString();
    });
    const result = probeProxyConnection(undefined, { HTTPS_PROXY: 'socks5://192.0.2.2:1080' });
    child.stdout.write('192.0.2.1\n200');
    child.emit('close', 0);
    await result;
    expect(config).toBe('proxy = ""\nnoproxy = ""\n');
  });

  it.each([
    [28, '', 'timeout'],
    [67, 'private password', 'authentication'],
    [97, 'User was rejected by the SOCKS5 server (private-password)', 'authentication'],
    [97, 'Cannot complete SOCKS5 connection', 'connection'],
    [7, 'private detail', 'connection'],
    [60, 'private TLS detail', 'tls'],
  ])('maps curl exit %i to a safe %s result', async (code, stderr, reason) => {
    const result = probeProxyConnection();
    child.stderr.write(stderr);
    child.emit('close', code);
    expect(await result).toEqual({ state: 'failed', reason, elapsedMs: expect.any(Number) });
  });

  it.each(['not-an-ip\n200', '192.0.2.1\n302', '192.0.2.1', '<html>login required</html>\n200'])(
    'rejects unexpected HTTPS content (%s)',
    async (response) => {
      const result = probeProxyConnection();
      child.stdout.write(response);
      child.emit('close', 0);
      expect(await result).toMatchObject({ state: 'failed', reason: 'invalidResponse' });
    }
  );

  it('kills a hung process within the ten-second deadline', async () => {
    vi.useFakeTimers();
    const result = probeProxyConnection();
    await vi.advanceTimersByTimeAsync(10000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(await result).toMatchObject({ state: 'failed', reason: 'timeout' });
  });

  it('terminates oversized responses without keeping their contents', async () => {
    const result = probeProxyConnection();
    child.stdout.write('x'.repeat(4097));
    expect(await result).toMatchObject({ state: 'failed', reason: 'invalidResponse' });
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('handles missing curl and stdin errors without leaking host error details', async () => {
    const result = probeProxyConnection();
    child.stdin.emit('error', new Error('private EPIPE'));
    child.emit('error', new Error('private executable path'));
    expect(await result).toEqual({ state: 'failed', reason: 'unavailable', elapsedMs: expect.any(Number) });
  });
});
