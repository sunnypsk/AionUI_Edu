import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  createBrowserMcpInput,
  createBrowserMcpOutput,
  createScopedMcpInput,
  createSpecialistLifecycle,
} from './stdioProxy.mjs';

const browser = {
  command: 'node',
  args: ['--experimental-strip-types', '/app/browser/mcp.ts'],
  env_vars: ['AIONUI_BROWSER_CAPABILITY', 'AIONUI_RUNTIME_TOKEN'],
  startup_timeout_sec: 10,
  tool_timeout_sec: 20,
};
const transform = async (chunks: Buffer[]): Promise<string> => {
  const stream = createBrowserMcpInput(browser);
  const output: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => output.push(chunk));
  const ended = once(stream, 'end');
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  await ended;
  return Buffer.concat(output).toString('utf8');
};

describe('Codex browser MCP protocol compatibility', () => {
  it('reports scoped MCP failures without exposing their raw error or changing the native frame', async () => {
    const statuses: string[] = [];
    const stream = createBrowserMcpOutput((status) => statuses.push(status));
    let forwarded = '';
    stream.on('data', (chunk: Buffer) => {
      forwarded += chunk.toString();
    });
    const ended = once(stream, 'end');
    const frame =
      JSON.stringify({
        method: 'mcpServer/startupStatus/updated',
        params: { name: 'aionui_browser', status: 'failed', error: 'private fixture secret' },
      }) + '\n';
    stream.end(frame);
    await ended;
    expect(statuses).toEqual(['failed']);
    expect(forwarded).toBe(frame);
  });
  it.each(['thread/start', 'thread/resume', 'thread/fork'])('retains existing MCP servers in %s', async (method) => {
    const other = { command: 'existing-tool', env: { FIXTURE: 'unchanged' } };
    const frame = { id: 1, method, params: { cwd: '/task', config: { mcp_servers: { other }, unrelated: true } } };
    const result = JSON.parse(await transform([Buffer.from(JSON.stringify(frame) + '\n')]));
    expect(result.params.config.mcp_servers).toEqual({ other, aionui_browser: browser });
    expect(result.params.config.unrelated).toBe(true);
  });

  it('preserves ordinary frames, Chinese text split across chunks, and the final partial line', async () => {
    const text = '{"id":2, "method":"turn/start", "params":{"text":"老師中文😀"}}\r\n{"id":3,"method":"shutdown"}';
    const bytes = Buffer.from(text);
    const split = bytes.indexOf(Buffer.from('老')) + 1;
    expect(
      await transform([bytes.subarray(0, split), bytes.subarray(split, split + 2), bytes.subarray(split + 2)])
    ).toBe(text);
  });

  it.each(['thread/start', 'thread/resume', 'thread/fork'])(
    'injects browser MCP when %s has no override',
    async (method) => {
      const frame = { id: 4, method, params: { cwd: '/task' } };
      const result = JSON.parse(await transform([Buffer.from(JSON.stringify(frame) + '\n')]));
      expect(result.params.config.mcp_servers.aionui_browser).toEqual(browser);
    }
  );

  it('leaves malformed or unsupported input for the native protocol validator', async () => {
    const frame = '{"id":5,"method":"thread/start","params":{"config":{"mcp_servers":[]}}}\nnot-json\n';
    expect(await transform([Buffer.from(frame)])).toBe(frame);
  });
});

describe('multiple scoped MCP servers and parent lifecycle', () => {
  it('merges both reserved servers while retaining user MCPs', async () => {
    const specialist = { ...browser, args: ['/app/droid/mcp.ts'] };
    const stream = createScopedMcpInput({ aionui_browser: browser, aionui_specialists: specialist });
    let output = '';
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const ended = once(stream, 'end');
    stream.end(
      JSON.stringify({
        id: 1,
        method: 'thread/resume',
        params: {
          config: { mcp_servers: { custom: { command: 'custom' }, aionui_specialists: { command: 'override' } } },
        },
      }) + '\n'
    );
    await ended;
    expect(JSON.parse(output).params.config.mcp_servers).toEqual({
      custom: { command: 'custom' },
      aionui_browser: browser,
      aionui_specialists: specialist,
    });
  });
  it('waits for host acknowledgement before forwarding a new turn', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lifecycle = createSpecialistLifecycle(async () => pending);
    const stream = createScopedMcpInput({}, lifecycle.input);
    let output = '';
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const ended = once(stream, 'end');
    const frame = JSON.stringify({ id: 1, method: 'turn/start', params: { threadId: 'parent' } }) + '\n';
    stream.end(frame);
    await Promise.resolve();
    expect(output).toBe('');
    release();
    await ended;
    expect(output).toBe(frame);
  });
  it('ignores child turns and binds native turn IDs before cancellation', async () => {
    const events: Record<string, string>[] = [];
    const lifecycle = createSpecialistLifecycle(async (event) => {
      events.push(event);
    });
    await lifecycle.input({ id: 1, method: 'thread/start', params: {} });
    await lifecycle.output({ id: 1, result: { thread: { id: 'parent' } } });
    await lifecycle.input({ id: 2, method: 'turn/start', params: { threadId: 'child' } });
    await lifecycle.input({ id: 3, method: 'turn/start', params: { threadId: 'parent' } });
    await lifecycle.output({ id: 3, result: { turn: { id: 'turn' } } });
    await lifecycle.input({ id: 4, method: 'turn/interrupt', params: { threadId: 'parent', turnId: 'turn' } });
    expect(events.map((event) => event.event)).toEqual(['start', 'bound', 'stop']);
    expect(events[2].turn_id).toBe('turn');
  });
  it('does not forward turn/start if the scoped host acknowledgement fails', async () => {
    const stream = createScopedMcpInput({}, async () => {
      throw new Error('unavailable');
    });
    let output = '';
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const error = once(stream, 'error');
    stream.end('{"method":"turn/start","params":{"threadId":"parent"}}\n');
    await error;
    expect(output).toBe('');
  });
});
