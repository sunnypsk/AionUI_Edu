// @ts-check
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

/** @typedef {import('../../browser/launcher.js').BrowserMcpConfig} BrowserMcpConfig */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} line @param {BrowserMcpConfig} browser @returns {string} */
function mergeBrowserConfig(line, browser) {
  if (!/"method"\s*:\s*"thread\/(?:start|resume|fork)"/.test(line)) return line;
  try {
    const message = /** @type {unknown} */ (JSON.parse(line));
    if (!record(message) || !['thread/start', 'thread/resume', 'thread/fork'].includes(String(message.method)))
      return line;
    if (!record(message.params) || !record(message.params.config) || !record(message.params.config.mcp_servers))
      return line;
    message.params.config.mcp_servers.aionui_browser = browser;
    return JSON.stringify(message);
  } catch {
    return line;
  }
}

/** Preserve UTF-8 and ordinary frames while merging only explicit per-thread MCP overrides.
 * @param {BrowserMcpConfig} browser @returns {Transform}
 */
export function createBrowserMcpInput(browser) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        this.push(mergeBrowserConfig(pending.slice(0, newline), browser) + '\n');
        pending = pending.slice(newline + 1);
      }
      callback();
    },
    flush(callback) {
      pending += decoder.end();
      if (pending) this.push(mergeBrowserConfig(pending, browser));
      callback();
    },
  });
}

/** Node owns the protocol pipe so Bun never has to consume the native app-server's stdin.
 * Configuration contains only executable paths and environment variable names, never credentials.
 * @returns {Promise<number>}
 */
async function main() {
  const [, , configuration, command, ...args] = process.argv;
  if (!configuration || !command) return 1;
  const browser = /** @type {BrowserMcpConfig} */ (JSON.parse(configuration));
  const child = spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 + osConstants.signals[signal] : 1)));
  });
  void result.catch(() => {});
  if (!child.stdin) throw new Error('CODEX_STDIO_PROXY_UNAVAILABLE');
  const input = createBrowserMcpInput(browser);
  input.on('error', () => child.kill('SIGTERM'));
  child.stdin.on('error', () => input.destroy());
  process.stdin.pipe(input).pipe(child.stdin);
  const signals = /** @type {NodeJS.Signals[]} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);
  const handlers = signals.map((signal) => {
    const handler = () => child.kill(signal);
    process.on(signal, handler);
    return { signal, handler };
  });
  try {
    return /** @type {number} */ (await result);
  } finally {
    process.stdin.unpipe(input);
    process.stdin.pause();
    input.destroy();
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write('CODEX_STDIO_PROXY_UNAVAILABLE\n');
      process.stdin.pause();
      process.exitCode = 1;
    });
}
