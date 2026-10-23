// @ts-check
import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/** @typedef {import('../../browser/launcher.js').BrowserMcpConfig} BrowserMcpConfig */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** @param {string} line @param {Record<string, BrowserMcpConfig>} scoped @returns {string} */
function mergeScopedConfig(line, scoped) {
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
      mcp_servers: { ...(record(servers) ? servers : {}), ...scoped },
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
  return createScopedMcpInput({ aionui_browser: browser });
}

/** @param {Record<string, BrowserMcpConfig>} servers
 * @param {(frame: Record<string, unknown>) => Promise<void>} observe
 * @returns {Transform} */
export function createScopedMcpInput(servers, observe = async () => {}) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  /** @param {string} line */
  const processLine = async (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return line;
    }
    if (record(frame)) await observe(frame);
    return mergeScopedConfig(line, servers);
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      void (async () => {
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          this.push((await processLine(pending.slice(0, newline))) + '\n');
          pending = pending.slice(newline + 1);
        }
      })().then(() => callback(), callback);
    },
    flush(callback) {
      pending += decoder.end();
      void (async () => {
        if (pending) this.push(await processLine(pending));
      })().then(() => callback(), callback);
    },
  });
}

/** Forward native output byte-for-byte and report only the scoped server's bounded startup state.
 * @param {(status: string) => void} report
 * @returns {Transform}
 */
export function createBrowserMcpOutput(report) {
  return createScopedMcpOutput(['aionui_browser'], (_name, status) => report(status));
}

/** @param {string[]} names @param {(name: string, status: string) => void} report
 * @param {(frame: Record<string, unknown>) => Promise<void>} observe @returns {Transform} */
export function createScopedMcpOutput(names, report, observe = async () => {}) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += decoder.write(chunk);
      void (async () => {
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let frame;
          try {
            frame = JSON.parse(line);
          } catch {
            continue;
          }
          if (!record(frame)) continue;
          if (
            frame.method === 'mcpServer/startupStatus/updated' &&
            record(frame.params) &&
            names.includes(String(frame.params.name))
          ) {
            const status = String(frame.params.status);
            if (['starting', 'ready', 'failed', 'cancelled'].includes(status))
              report(String(frame.params.name), status);
          }
          await observe(frame);
        }
        this.push(chunk);
      })().then(() => callback(), callback);
    },
  });
}

/** Track only the Core-bound parent thread. Child-agent notifications cannot reopen admission.
 * @param {(event: Record<string, string>) => Promise<void>} notify
 */
export function createSpecialistLifecycle(notify) {
  let threadId = '';
  const prefix = randomUUID();
  /** @type {Map<string, {method: string, eventId: string, threadId: string}>} */
  const requests = new Map();
  return {
    /** @param {Record<string, unknown>} frame */
    async input(frame) {
      const params = record(frame.params) ? frame.params : {};
      const method = String(frame.method);
      const id = String(frame.id);
      if (['thread/start', 'thread/resume', 'thread/fork'].includes(method))
        requests.set(id, { method, eventId: '', threadId: '' });
      else if (
        method === 'turn/start' &&
        typeof params.threadId === 'string' &&
        (!threadId || threadId === params.threadId)
      ) {
        threadId = params.threadId;
        const eventId = `${prefix}:${id}`;
        requests.set(id, { method, eventId, threadId });
        await notify({ event: 'start', event_id: eventId, thread_id: threadId });
      } else if (method === 'turn/interrupt' && params.threadId === threadId && typeof params.turnId === 'string') {
        await notify({ event: 'stop', thread_id: threadId, turn_id: params.turnId });
      }
    },
    /** @param {Record<string, unknown>} frame */
    async output(frame) {
      if (frame.id === undefined || frame.method) return;
      const request = requests.get(String(frame.id));
      if (!request) return;
      requests.delete(String(frame.id));
      const result = record(frame.result) ? frame.result : {};
      if (request.method.startsWith('thread/') && record(result.thread) && typeof result.thread.id === 'string')
        threadId = result.thread.id;
      if (request.method === 'turn/start' && record(result.turn) && typeof result.turn.id === 'string')
        await notify({
          event: 'bound',
          event_id: request.eventId,
          thread_id: request.threadId,
          turn_id: result.turn.id,
        });
    },
  };
}

/** Node owns the protocol pipe so Bun never has to consume the native app-server's stdin.
 * Configuration contains only executable paths and environment variable names, never credentials.
 * @returns {Promise<number>}
 */
async function main() {
  const [, , configuration, command, ...args] = process.argv;
  if (!configuration || !command) return 1;
  const parsed = JSON.parse(configuration);
  const servers = /** @type {Record<string, BrowserMcpConfig>} */ (
    parsed.command ? { aionui_browser: parsed } : parsed
  );
  const lifecycle = createSpecialistLifecycle(async (event) => {
    await Promise.all(
      [
        ['aionui_specialists', 'AIONUI_SPECIALISTS', 'x-aionui-specialist-capability'],
        ['aionui_audio', 'AIONUI_AUDIO', 'x-aionui-audio-capability'],
      ].map(async ([name, prefix, header]) => {
        if (!servers[name]) return;
        const gateway = process.env[`${prefix}_GATEWAY`];
        const capability = process.env[`${prefix}_CAPABILITY`];
        const token = process.env.AIONUI_RUNTIME_TOKEN;
        if (!gateway || !capability || !token) throw new Error('SCOPED_TOOL_UNAVAILABLE');
        const response = await fetch(`${gateway}/lifecycle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', [header]: capability, 'x-aionui-runtime-token': token },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('SCOPED_TOOL_UNAVAILABLE');
      })
    );
  });
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 + osConstants.signals[signal] : 1)));
  });
  void result.catch(() => {});
  if (!child.stdin || !child.stdout) throw new Error('CODEX_STDIO_PROXY_UNAVAILABLE');
  const input = createScopedMcpInput(servers, lifecycle.input);
  const output = createScopedMcpOutput(
    Object.keys(servers),
    (name, status) => {
      process.stderr.write(
        JSON.stringify({
          event:
            name === 'aionui_browser'
              ? 'browser.mcpStartup'
              : name === 'aionui_audio'
                ? 'audio.mcpStartup'
                : 'specialist.mcpStartup',
          status,
        }) + '\n'
      );
    },
    lifecycle.output
  );
  const outputDone = pipeline(child.stdout, output, process.stdout);
  void outputDone.catch(() => child.kill('SIGTERM'));
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
