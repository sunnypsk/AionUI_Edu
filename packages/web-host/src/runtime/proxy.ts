import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import type { NetworkProxySettings, NetworkProxyStatus } from '../types.js';

export const TUN_INTERFACE = 'aionedu0';
export const TUN_DNS = '198.18.0.2';
export const PROXY_FILE_NAME = 'network-proxy.json';

export type SocksProxy = {
  url: string;
  server: string;
  port: number;
  username: string;
  password: string;
  endpoint: string;
};

/** Full routing uses an IP upstream so no bootstrap DNS query can bypass the tunnel. */
export function parseSocksProxy(value: unknown): SocksProxy {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const url = new URL(value.trim());
    const server = url.hostname.replace(/^\[|\]$/g, '');
    const port = url.port ? Number(url.port) : 1080;
    const username = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    if (
      !['socks5:', 'socks5h:'].includes(url.protocol) ||
      !isIP(server) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname) ||
      Buffer.byteLength(username) > 255 ||
      Buffer.byteLength(password) > 255 ||
      (password && !username)
    )
      throw new Error();
    const host = isIP(server) === 6 ? `[${server}]` : server;
    const authority = username ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
    return {
      url: `socks5://${authority}${host}:${port}`,
      server,
      port,
      username,
      password,
      endpoint: `socks5://${host}:${port}`,
    };
  } catch {
    throw new Error('INVALID_SOCKS5_PROXY');
  }
}

export function proxyFingerprint(settings: NetworkProxySettings): string {
  return settings.enabled && settings.proxyUrl
    ? createHash('sha256').update(parseSocksProxy(settings.proxyUrl).url).digest('hex')
    : '';
}

/** Route every external destination through SOCKS; DNS itself uses HTTPS through SOCKS. */
export function buildTunConfig(proxy: SocksProxy): Record<string, unknown> {
  return {
    log: { level: 'error', timestamp: true },
    dns: {
      servers: [
        {
          type: 'https',
          tag: 'remote-dns',
          server: '1.1.1.1',
          path: '/dns-query',
          tls: { enabled: true, server_name: 'cloudflare-dns.com' },
          detour: 'socks',
        },
      ],
      final: 'remote-dns',
    },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun',
        interface_name: TUN_INTERFACE,
        address: ['198.18.0.1/30', 'fdfe:dcba:9876::1/126'],
        mtu: 1500,
        auto_route: true,
        auto_redirect: true,
        strict_route: true,
        stack: 'mixed',
      },
    ],
    outbounds: [
      {
        type: 'socks',
        tag: 'socks',
        server: proxy.server,
        server_port: proxy.port,
        version: '5',
        ...(proxy.username ? { username: proxy.username, password: proxy.password } : {}),
      },
    ],
    route: {
      auto_detect_interface: true,
      default_domain_resolver: 'remote-dns',
      final: 'socks',
      rules: [{ port: 53, action: 'hijack-dns' }],
    },
  };
}

/** A stopped/crashed tunnel must not expose the container's ordinary default route. */
export function buildEgressRules(proxy: SocksProxy): Array<{ command: string; args: string[] }> {
  return [4, 6].flatMap((family) => {
    const command = family === 4 ? 'iptables' : 'ip6tables';
    const rules: string[][] = [
      ['-N', 'AIONUI_EGRESS'],
      // Docker may DNAT its resolver to a random loopback port before filter/OUTPUT.
      ...(family === 4 ? [['-A', 'AIONUI_EGRESS', '-d', '127.0.0.11', '-j', 'REJECT']] : []),
      ['-A', 'AIONUI_EGRESS', '-o', 'lo', '-p', 'udp', '--dport', '53', '-j', 'REJECT'],
      ['-A', 'AIONUI_EGRESS', '-o', 'lo', '-p', 'tcp', '--dport', '53', '-j', 'REJECT'],
      // sing-tun routes transparent redirects to a LOCAL loopback address via eth0.
      // Match the destination's route type, rather than only the output interface.
      ['-A', 'AIONUI_EGRESS', '-m', 'addrtype', '--dst-type', 'LOCAL', '-j', 'ACCEPT'],
      ['-A', 'AIONUI_EGRESS', '-o', 'lo', '-j', 'ACCEPT'],
      ['-A', 'AIONUI_EGRESS', '-m', 'conntrack', '--ctstate', 'ESTABLISHED,RELATED', '-j', 'ACCEPT'],
      ...(isIP(proxy.server) === family
        ? [['-A', 'AIONUI_EGRESS', '-d', proxy.server, '-p', 'tcp', '--dport', String(proxy.port), '-j', 'ACCEPT']]
        : []),
      ...(isIP(proxy.server) === family
        ? [['-A', 'AIONUI_EGRESS', '-d', proxy.server, '-p', 'udp', '-m', 'owner', '--uid-owner', '0', '-j', 'ACCEPT']]
        : []),
      ['-A', 'AIONUI_EGRESS', '-o', TUN_INTERFACE, '-j', 'ACCEPT'],
      ['-A', 'AIONUI_EGRESS', '-j', 'REJECT'],
      ['-I', 'OUTPUT', '1', '-j', 'AIONUI_EGRESS'],
    ];
    return rules.map((args) => ({ command, args: ['-w', ...args] }));
  });
}

export async function loadProxySettings(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<NetworkProxySettings> {
  if (env.AIONUI_SOCKS5_PROXY?.trim()) return { enabled: true, proxyUrl: parseSocksProxy(env.AIONUI_SOCKS5_PROXY).url };
  let raw: string;
  try {
    raw = await readFile(path.join(dataDir, PROXY_FILE_NAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false };
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as NetworkProxySettings).enabled !== 'boolean')
    throw new Error('INVALID_PROXY_SETTINGS');
  const settings = parsed as NetworkProxySettings;
  const proxyUrl = settings.proxyUrl ? parseSocksProxy(settings.proxyUrl).url : undefined;
  if (settings.enabled && !proxyUrl) throw new Error('INVALID_PROXY_SETTINGS');
  return { enabled: settings.enabled, ...(proxyUrl ? { proxyUrl } : {}) };
}

export class NetworkProxyStore {
  constructor(
    private readonly dataDir: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async status(): Promise<NetworkProxyStatus> {
    const settings = await loadProxySettings(this.dataDir, this.env);
    const proxy = settings.proxyUrl ? parseSocksProxy(settings.proxyUrl) : null;
    const activeHash = this.env.AIONUI_ACTIVE_PROXY_HASH || '';
    return {
      enabled: settings.enabled,
      endpoint: proxy?.endpoint ?? '',
      hasCredentials: Boolean(proxy?.username),
      active: Boolean(activeHash),
      pendingRestart: proxyFingerprint(settings) !== activeHash,
      managedByEnvironment: Boolean(this.env.AIONUI_SOCKS5_PROXY?.trim()),
      containerSupported: this.env.AIONUI_CONTAINER === '1',
    };
  }

  async save(input: unknown): Promise<NetworkProxyStatus> {
    if (this.env.AIONUI_SOCKS5_PROXY?.trim()) throw new Error('PROXY_MANAGED_BY_ENV');
    if (!input || typeof input !== 'object' || typeof (input as NetworkProxySettings).enabled !== 'boolean')
      throw new Error('INVALID_PROXY_SETTINGS');
    const request = input as NetworkProxySettings;
    if (request.proxyUrl !== undefined && typeof request.proxyUrl !== 'string') throw new Error('INVALID_SOCKS5_PROXY');
    const previous = await loadProxySettings(this.dataDir, this.env);
    const proxyUrl = request.proxyUrl?.trim() ? parseSocksProxy(request.proxyUrl).url : previous.proxyUrl;
    if (request.enabled && !proxyUrl) throw new Error('INVALID_SOCKS5_PROXY');
    const settings = { enabled: request.enabled, ...(proxyUrl ? { proxyUrl } : {}) };
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dataDir, PROXY_FILE_NAME);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return this.status();
  }
}
