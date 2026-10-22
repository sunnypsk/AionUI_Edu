import { describe, expect, it } from 'vitest';
import { containerErrorCode, ProxyLog } from '../proxyLog.js';

describe('bounded proxy diagnostics', () => {
  it('redacts decoded, encoded and chunk-split credentials before logging', () => {
    const lines: string[] = [];
    const log = new ProxyLog({ username: 'alice', password: 'p@ss' }, (line) => lines.push(line));
    log.push('login ali');
    log.push('ce failed p@');
    expect(lines).toEqual([]);
    log.push('ss p%40ss socks5://other:credential@proxy.example\n');
    expect(lines.join('')).not.toMatch(/alice|p@ss|p%40ss|other|credential/);
    expect(log.tail()).toEqual(['login [redacted] failed [redacted] [redacted] socks5://[redacted]@proxy.example']);
  });

  it('redacts short credentials and removes terminal controls', () => {
    const lines: string[] = [];
    const log = new ProxyLog({ username: 'xy', password: 'z' }, (line) => lines.push(line));
    log.push('\u001b[31mxy z\u001b[0m\r\n');
    expect(lines).toEqual(['[proxy] [redacted] [redacted]']);
  });

  it('bounds floods, long unterminated lines, and the diagnostic tail', () => {
    const lines: string[] = [];
    const log = new ProxyLog({ username: '', password: '' }, (line) => lines.push(line));
    log.push('private'.repeat(100000));
    log.push('\n' + 'failure\n'.repeat(1000));
    log.finish();
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe('[proxy] suppressed 981 diagnostic lines');
    expect(log.tail()).toHaveLength(20);
  });

  it('flushes the final partial line and resumes after the rate window', () => {
    const lines: string[] = [];
    let now = 0;
    const log = new ProxyLog(
      { username: '', password: '' },
      (line) => lines.push(line),
      () => now
    );
    log.push('failure\n'.repeat(21));
    now = 10000;
    log.push('last failure');
    log.finish();
    expect(lines.slice(-2)).toEqual(['[proxy] suppressed 1 diagnostic lines', '[proxy] last failure']);
  });

  it('never exposes child stderr or an arbitrary startup exception', () => {
    expect(containerErrorCode(new Error('Command failed: sing-box user=alice password=private'))).toBe(
      'CONTAINER_STARTUP_FAILED'
    );
    expect(containerErrorCode(new Error('SOCKS5_HOSTNAME_RESOLUTION_FAILED'))).toBe(
      'SOCKS5_HOSTNAME_RESOLUTION_FAILED'
    );
    expect(containerErrorCode(Object.assign(new Error('secret'), { code: 'EACCES' }))).toBe('EACCES');
  });
});
