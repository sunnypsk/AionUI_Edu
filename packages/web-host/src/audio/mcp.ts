import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { toolSchemas } from './types.ts';

const server = new McpServer({ name: 'aionui-audio', version: '1.0.0' });
const shared =
  'Use action=start (default) to create a background task, then action=wait with task_id until completed; each wait is at most 50 seconds. status reads a task; cancel stops it. A wait ending does not cancel work. Never repeat start because a wait timed out. Do not deliver an unfinished task. Completed files are workspace-relative: deliver each with a FileCard. No API keys belong in tool arguments. AUDIO_KEY_REQUIRED means ask the user to configure Vercel under Settings > Tools; AUDIO_MODEL_UNSUPPORTED means change the configured multimodal model there, not silently use another service. Parent Stop cancels active tasks. ';
const descriptions = {
  transcribe_audio:
    shared +
    'Use whenever an audio recording needs transcription, captions or subtitles. audio_path must be a file in the current task workspace. Uses the multimodal model configured under Settings > Tools (default google/gemini-3.8-flash). Default output is SRT with approximate sentence times, preserving Hong Kong Cantonese in Traditional Chinese. Respect an explicit user format (txt/vtt/json), language, or transcription instructions. Long recordings are segmented and merged automatically. Never promise precise word alignment. Never mention costs, tokens or billing to the user.',
  synthesize_speech:
    shared +
    'Use for a single narration, voice-over or text-to-speech file. Listening tests or exercises with several parts, speakers, pauses or repeats must use render_listening_track instead. Supply text OR a workspace-relative UTF-8 text_path. HiuMaan is a female Hong Kong Cantonese voice (default); WanLung is male. One voice per file. Edge TTS supports rate and volume as signed percentages (+0%, -20%) and pitch as signed Hz (+0Hz, +20Hz). Request subtitles=true to generate SRT directly from the same synthesis stream, without a transcription pass; boundary may be SentenceBoundary (default) or WordBoundary. Output is MP3; no Azure/Vercel key is needed for synthesis. Do not translate or rewrite the supplied text unless requested.',
  render_listening_track:
    shared +
    'Use to build a listening test or listening exercise audio track. First write a workspace project file (e.g. listening/<slug>.listening.json) and pass it as project_path; edit that same file for every later change, then render again — unchanged speech is reused from cache. ' +
    'Project JSON: {"version":1,"title":string,"defaults"?:{"voice":"HiuMaan"|"WanLung","rate":"+0%","volume":"+0%","pitch":"+0Hz"},"lexicon"?:[{"match":string,"speak":string}],"sections":[{"id":string,"label"?:string,"plays"?:1-5 (default 1),"gapBetweenPlays"?:seconds (default 5),"gapAfter"?:seconds (default 3),"segments":[...]}]}. ' +
    'Segments (id unique across the project, letters/digits/_/-): {"id","type":"speech","text","speaker"?,"voice"?,"rate"?,"volume"?,"pitch"?} | {"id","type":"pause","seconds":0.1-600,"note"?} | {"id","type":"chime","preset"?:"start"|"end"} | {"id","type":"clip","path":workspace audio file,"start":seconds,"end":seconds,"note"?} to reuse part of an uploaded recording. ' +
    "lexicon fixes pronunciation: match is replaced by speak in TTS input only; subtitles and script keep the original wording. Follow the teacher's stated structure; there is no fixed exam template. " +
    'Outputs track.mp3, track.srt, script.txt, timeline.json and, when verify=true (default) and a Vercel key is configured, qa.json listing speech segments whose re-transcription differs from the script (qaIssues counts them). AUDIO_QA_SKIPPED means no key: the track is still valid. Treat QA as hints, not proof: tell the teacher which lines may be misread and suggest a lexicon entry or rewording; let the teacher decide. Deliver the project file with its own FileCard too: teachers open it in an editor to change lines, preview, re-render and mark QA readings as correct. Teachers may edit the project or render in that editor between turns, so re-read the project file before every change instead of rewriting it from memory. only_sections renders a preview of selected section ids. AUDIO_PROJECT_INVALID includes details naming the fields to fix. Never mention costs, tokens or billing to the user.',
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
