import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createBrowserMcpInput, createBrowserMcpOutput } from './stdioProxy.mjs';

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
