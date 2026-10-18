import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildEgressRules,
  buildTunConfig,
  loadProxySettings,
  NetworkProxyStore,
  parseSocksProxy,
  proxyFingerprint,
  PROXY_FILE_NAME,
} from './proxy.js';

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
    'socks5://proxy.example:1080',
    'socks5://192.0.2.1:0',
    'socks5://192.0.2.1:1080/?secret=password',
    'socks5://192.0.2.1:1080/path',
  ])('rejects invalid or DNS-dependent upstreams without disclosing their URL', (url) => {
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

  it('sends both DNS and arbitrary destinations through SOCKS with no direct outbound', () => {
    const config = buildTunConfig(parseSocksProxy('socks5://192.0.2.1:1080'));
    expect(config).toMatchObject({
      dns: { servers: [{ type: 'https', detour: 'socks' }] },
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
