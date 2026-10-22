import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSchemas } from './types.ts';

const server = new McpServer({ name: 'aionui-specialists', version: '1.0.0' });
const descriptions = {
  specialist_start:
    'Delegate a writing task to Factory Droid. Default argon (Gemini 4 Argon low) for natural Chinese, general prose, rewriting and editing; use opus (Claude Opus 5.5 low) for stories, narrative and character dialogue. Honor an explicit user model choice. Give a self-contained brief, audience, language, tone and requirements. Optional files are UTF-8 paths relative to the current workspace; the specialist receives their content but has NO tools. Returns immediately with task ID. Wait for needed drafts before your final answer. Preserve the specialist wording; check facts and requirements rather than rewriting the prose yourself. For revisions, reply to the same task. Do not delegate recursively or automatically run both models for every task.',
  specialist_reply:
    'Continue the SAME writing session with feedback, a question, revised requirements or additional source files. Returns immediately; SPECIALIST_BUSY means wait for the current run first. Use for collaboration and polishing so the specialist preserves its own voice.',
  specialist_wait:
    'Wait up to 50 seconds until any specified writing task finishes. Repeat while needed. Stopping this wait does NOT cancel the task. Results remain available after Codex resumes. Read nextOffset pages with specialist_get to retrieve the entire draft.',
  specialist_get:
    'Without task_id list writing tasks in this conversation. With task_id retrieve the latest or selected run, including the original draft, status and usage. Follow nextOffset until null for the full text. Reading does not consume or delete results.',
  specialist_cancel:
    'Cancel one writing task, preserving completed results and partial drafts. The user Stop button cancels ALL active specialists in this conversation. A canceled native session can be continued explicitly in a later parent turn.',
};
for (const name of Object.keys(toolSchemas) as (keyof typeof toolSchemas)[]) {
  server.registerTool(
    name,
    { description: descriptions[name], inputSchema: toolSchemas[name].shape },
    async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => {
      try {
        const gateway = process.env.AIONUI_SPECIALISTS_GATEWAY;
        const capability = process.env.AIONUI_SPECIALISTS_CAPABILITY;
        const token = process.env.AIONUI_RUNTIME_TOKEN;
        if (!gateway || !capability || !token) throw new Error('SPECIALIST_UNAVAILABLE');
        const response = await fetch(`${gateway}/command`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-aionui-specialist-capability': capability,
            'x-aionui-runtime-token': token,
          },
          body: JSON.stringify({ name, arguments: args }),
          signal: AbortSignal.any([extra.signal, AbortSignal.timeout(60000)]),
        });
        const result = (await response.json()) as { data?: unknown; error?: { code: string } };
        return {
          isError: !response.ok,
          content: [{ type: 'text' as const, text: JSON.stringify(response.ok ? result.data : result.error) }],
        };
      } catch {
        return { isError: true, content: [{ type: 'text' as const, text: 'SPECIALIST_UNAVAILABLE' }] };
      }
    }
  );
}
void server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write('SPECIALIST_MCP_UNAVAILABLE\n');
  process.exitCode = 1;
});
