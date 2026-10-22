import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSchemas } from './types.ts';

const server = new McpServer({ name: 'aionui-specialists', version: '1.0.0' });
const descriptions = {
  specialist_start:
    "Delegate to a Factory Droid specialist. Choose by role: argon (the configured writing role) is the writer for Chinese text that students, parents or colleagues will read, such as model essays and answers, reading passages, worksheet wording, notices, parent letters and comments, plus rewriting and polishing; opus (the configured teaching-design role) is the teaching designer for lesson plans, unit and scheme-of-work planning, activity sequences, questioning design, assessment blueprints and rubric frameworks. Use the model and reasoning configured for that role in Settings > Agents; role names are stable identifiers, not model IDs. Do it yourself instead for short answers, text analysis and Q&A, fact and quotation checks, mark totals, OpenUI blocks, file production and formatting, and anything only a sentence or two long. When both roles are needed, get and confirm the opus plan first, then brief argon with it; unrelated tasks may run in parallel. The specialist has NO tools and cannot see this conversation: write a self-contained brief with grade, text or topic, lesson count and length, learning goals, audience, genre, length, language and register, constraints and what the teacher already decided. files are workspace-relative UTF-8 text files (256 KiB each, 1 MiB total); first extract .docx, .pdf or .pptx sources to .md in the workspace. Returns immediately with task ID; wait for needed drafts before your final answer. Use student-facing text verbatim and keep a plan's wording when restructuring it into tables or outlines; check facts, quotations, totals and requirements, and send problems back with specialist_reply instead of rewriting or re-polishing the prose yourself (at most two revision rounds). Errors: SPECIALIST_AUTH_REQUIRED, SPECIALIST_MODEL_UNAVAILABLE or SPECIALIST_UNAVAILABLE mean do the work yourself (for AUTH_REQUIRED add one sentence that the teacher can sign in to Factory under Settings > Agents); SPECIALIST_LIMIT means wait for a running task; SPECIALIST_TEXT_REQUIRED or SPECIALIST_FILE_TOO_LARGE mean extract or shorten the source text. Do not mention specialists or model names to the teacher unless asked. Do not delegate recursively.",
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
