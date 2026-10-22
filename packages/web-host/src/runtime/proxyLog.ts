import { stripVTControlCharacters } from 'node:util';
import type { SocksProxy } from './proxy.js';

const MAX_LINE = 4096;
const MAX_OUTPUT = 512;
const MAX_LINES = 20;
const WINDOW_MS = 10000;

/** Drain proxy diagnostics with bounded memory/output and redact credentials before publication. */
export class ProxyLog {
  private pending = '';
  private discarding = false;
  private readonly secrets: RegExp | undefined;
  private readonly recent: string[] = [];
  private windowStart: number;
  private emitted = 0;
  private suppressed = 0;

  constructor(
    proxy: Pick<SocksProxy, 'username' | 'password'>,
    private readonly write: (line: string) => void,
    private readonly now: () => number = Date.now
  ) {
    const values = [
      ...new Set(
        [proxy.username, proxy.password].flatMap((secret) => [
          secret,
          stripVTControlCharacters(secret),
          encodeURIComponent(secret),
          JSON.stringify(secret).slice(1, -1),
          ...secret.split(/[\r\n]/),
        ])
      ),
    ]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    this.secrets = values.length
      ? new RegExp(values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
      : undefined;
    this.windowStart = now();
  }

  push(chunk: string): void {
    // Never split and publish a long line: a credential could cross the cut.
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf('\n', start);
      const fragment = chunk.slice(start, end < 0 ? chunk.length : end);
      if (!this.discarding) {
        if (this.pending.length + fragment.length > MAX_LINE) {
          this.pending = '';
          this.discarding = true;
        } else this.pending += fragment;
      }
      if (end < 0) break;
      this.flushLine();
      start = end + 1;
    }
  }

  finish(): void {
    if (this.pending || this.discarding) this.flushLine();
    this.reportSuppressed();
  }

  tail(): readonly string[] {
    return [...this.recent];
  }

  private reportSuppressed(): void {
    if (this.suppressed) this.write(`[proxy] suppressed ${this.suppressed} diagnostic lines`);
    this.suppressed = 0;
  }

  private flushLine(): void {
    let line = this.discarding ? '[oversized diagnostic line omitted]' : this.pending;
    this.pending = '';
    this.discarding = false;
    line = stripVTControlCharacters(line).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@');
    if (this.secrets) line = line.replace(this.secrets, '[redacted]');
    line = line
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .slice(0, MAX_OUTPUT);
    if (!line) return;
    this.recent.push(line);
    if (this.recent.length > MAX_LINES) this.recent.shift();
    if (this.now() - this.windowStart >= WINDOW_MS) {
      this.reportSuppressed();
      this.windowStart = this.now();
      this.emitted = 0;
    }
    if (this.emitted < MAX_LINES) {
      this.write(`[proxy] ${line}`);
      this.emitted += 1;
    } else this.suppressed += 1;
  }
}

/** Child-process errors may contain full commands/configuration; publish only known diagnostic codes. */
export function containerErrorCode(error: unknown): string {
  const allowed = new Set([
    'CONTAINER_ENTRYPOINT_REQUIRES_LINUX_ROOT',
    'INVALID_CONTAINER_USER',
    'INVALID_SOCKS5_PROXY',
    'SOCKS5_HOSTNAME_RESOLUTION_FAILED',
    'SOCKS5_PROXY_IP_REQUIRED',
    'SOCKS5_TUNNEL_START_FAILED',
    'ENOENT',
    'EACCES',
    'EPERM',
    'EIO',
    'ENOSPC',
  ]);
  if (error instanceof Error && allowed.has(error.message)) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    allowed.has(error.code)
  )
    return error.code;
  return 'CONTAINER_STARTUP_FAILED';
}
