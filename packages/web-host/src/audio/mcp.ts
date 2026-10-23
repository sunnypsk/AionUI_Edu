import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSchemas } from './types.ts';

const server = new McpServer({ name: 'aionui-audio', version: '1.0.0' });
const shared =
  'Use action=start (default) to create a background task, then action=wait with task_id until completed; each wait is at most 50 seconds. status reads a task; cancel stops it. A wait ending does not cancel work. Never repeat start because a wait timed out. Do not deliver an unfinished task. Completed files are workspace-relative: deliver each with a FileCard. No API keys belong in tool arguments. AUDIO_KEY_REQUIRED means ask the user to configure Vercel under Settings > Tools; AUDIO_MODEL_UNSUPPORTED means change the configured multimodal model there, not silently use another service. Parent Stop cancels active tasks. ';
const descriptions = {
  transcribe_audio:
    shared +
    'Use whenever an audio recording needs transcription, captions or subtitles. audio_path must be a file in the current task workspace. Uses the multimodal model configured under Settings > Tools (default google/gemini-3.8-flash). Default output is SRT with approximate sentence times, preserving Hong Kong Cantonese in Traditional Chinese. Respect an explicit user format (txt/vtt/json), language, or transcription instructions. Long recordings are segmented and merged automatically. Never promise precise word alignment. Costs are reported when the provider supplies them.',
  synthesize_speech:
    shared +
    'Use when spoken narration, a voice-over audio file, a listening exercise or text-to-speech is needed. Supply text OR a workspace-relative UTF-8 text_path. HiuMaan is a female Hong Kong Cantonese voice (default); WanLung is male. One voice per file. Edge TTS supports rate and volume as signed percentages (+0%, -20%) and pitch as signed Hz (+0Hz, +20Hz). Request subtitles=true to generate SRT directly from the same synthesis stream, without transcription charges; boundary may be SentenceBoundary (default) or WordBoundary. Output is MP3; no Azure/Vercel key is needed for synthesis. Do not translate or rewrite the supplied text unless requested.',
};
for (const name of Object.keys(toolSchemas) as (keyof typeof toolSchemas)[]) {
  server.registerTool(
    name,
    {
      description: descriptions[name],
      inputSchema: toolSchemas[name].shape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => {
      try {
        const gateway = process.env.AIONUI_AUDIO_GATEWAY;
        const capability = process.env.AIONUI_AUDIO_CAPABILITY;
        const token = process.env.AIONUI_RUNTIME_TOKEN;
        if (!gateway || !capability || !token) throw new Error('AUDIO_UNAVAILABLE');
        const response = await fetch(`${gateway}/command`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-aionui-audio-capability': capability,
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
        return { isError: true, content: [{ type: 'text' as const, text: 'AUDIO_UNAVAILABLE' }] };
      }
    }
  );
}
void server.connect(new StdioServerTransport()).catch(() => {
  process.stderr.write('AUDIO_MCP_UNAVAILABLE\n');
  process.exitCode = 1;
});
