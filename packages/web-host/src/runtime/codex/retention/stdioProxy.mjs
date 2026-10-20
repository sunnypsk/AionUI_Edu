// @ts-check
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
    if (!record(message.params)) return line;
    const config = message.params.config;
    if (config !== undefined && config !== null && !record(config)) return line;
    const base = record(config) ? config : {};
    const servers = base.mcp_servers;
    if (servers !== undefined && servers !== null && !record(servers)) return line;
    message.params.config = {
      ...base,
      mcp_servers: { ...(record(servers) ? servers : {}), aionui_browser: browser },
    };
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

/** Forward native output byte-for-byte and report only the scoped server's bounded startup state.
 * @param {(status: string) => void} report
 * @returns {Transform}
 */
export function createBrowserMcpOutput(report) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk);
      pending += decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const frame = JSON.parse(line);
          if (frame.method === 'mcpServer/startupStatus/updated' && frame.params?.name === 'aionui_browser') {
            const status = frame.params.status;
            if (['starting', 'ready', 'failed', 'cancelled'].includes(status)) report(status);
          }
        } catch {
          // The native protocol reader owns validation. Never echo untrusted frame contents.
        }
      }
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
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 + osConstants.signals[signal] : 1)));
  });
  void result.catch(() => {});
  if (!child.stdin || !child.stdout) throw new Error('CODEX_STDIO_PROXY_UNAVAILABLE');
  const input = createBrowserMcpInput(browser);
  const output = createBrowserMcpOutput((status) => {
    process.stderr.write(JSON.stringify({ event: 'browser.mcpStartup', status }) + '\n');
  });
  const outputDone = pipeline(child.stdout, output, process.stdout);
  void outputDone.catch(() => {});
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
    const code = /** @type {number} */ (await result);
    await outputDone;
    return code;
  } finally {
    process.stdin.unpipe(input);
    process.stdin.pause();
    input.destroy();
    output.destroy();
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
