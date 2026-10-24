/** Explicit opt-in live MCP smoke: one paid transcription and two short Edge syntheses. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createAudioRuntime } from '../routes.js';
import { AudioStore } from '../store.js';
import { signBrowserCapability } from '../../runtime/browser/types.js';
import type { AudioTask } from '../types.js';

export async function runAudioSmoke(source: string, root: string): Promise<void> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  assert(apiKey, 'AI_GATEWAY_API_KEY is required for this explicit live smoke');
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, { recursive: true });
  await copyFile(source, path.join(workspace, 'recording.mp3'));
  const backend = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (
      req.headers['x-aionui-runtime-token'] !== 'audio-smoke-token' ||
      req.headers['x-aionui-user-id'] !== 'audio-smoke'
    ) {
      res.writeHead(401).end('{}');
      return;
    }
    res.end(
      JSON.stringify({
        data: req.url === '/api/system/current-user' ? { id: 'audio-smoke' } : { id: 'lesson', extra: { workspace } },
      })
    );
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const runtime = await createAudioRuntime({ dataDir: path.join(root, 'data') });
  runtime.setBackendPort((backend.address() as { port: number }).port);
  const capability = signBrowserCapability(runtime.env.AIONUI_AUDIO_SIGNING_KEY, 'audio-smoke', 'lesson');
  const headers = {
    'content-type': 'application/json',
    'x-aionui-audio-capability': capability,
    'x-aionui-runtime-token': 'audio-smoke-token',
  };
  const client = new Client({ name: 'audio-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['--experimental-strip-types', fileURLToPath(new URL('../mcp.ts', import.meta.url))],
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      AIONUI_AUDIO_GATEWAY: runtime.env.AIONUI_AUDIO_GATEWAY,
      AIONUI_AUDIO_CAPABILITY: capability,
      AIONUI_RUNTIME_TOKEN: 'audio-smoke-token',
    },
    stderr: 'pipe',
  });
  try {
    const identity = { userId: 'audio-smoke', conversationId: 'lesson', workspace };
    // This synthetic Core fixture validates the same runtime headers without touching a live user's data.
    const lifecycle = await fetch(`${runtime.env.AIONUI_AUDIO_GATEWAY}/lifecycle`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'start', event_id: 'smoke-start', thread_id: 'smoke-thread' }),
    });
    assert.equal(lifecycle.status, 200);
    await new AudioStore(path.join(root, 'data')).saveSettings(identity.userId, {
      model: 'google/gemini-3.8-flash',
      apiKey,
    });
    await client.connect(transport);
    const inventory = await client.listTools();
    assert.deepEqual(inventory.tools.map((tool) => tool.name).toSorted(), [
      'analyze_reference_audio',
      'render_listening_track',
      'synthesize_speech',
      'transcribe_audio',
    ]);
    const call = async (name: string, args: Record<string, unknown>): Promise<AudioTask> => {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 65000 });
      const content = Array.isArray(result.content)
        ? result.content.find(
            (item: unknown): item is { type: 'text'; text: string } =>
              typeof item === 'object' &&
              item !== null &&
              'type' in item &&
              item.type === 'text' &&
              'text' in item &&
              typeof item.text === 'string'
          )
        : undefined;
      assert(content && typeof content.text === 'string');
      assert(!result.isError, content.text);
      return JSON.parse(content.text) as AudioTask;
    };
    const complete = async (name: string, args: Record<string, unknown>): Promise<AudioTask> => {
      let task = await call(name, args);
      while (task.status === 'queued' || task.status === 'running')
        task = await call(name, { action: 'wait', task_id: task.id });
      assert.equal(task.status, 'completed', task.error);
      for (const file of task.files) assert((await readFile(path.join(workspace, file.path))).length > 0);
      return task;
    };
    const previousTask = process.env.AIONUI_AUDIO_SMOKE_TRANSCRIPTION_TASK_ID;
    const tasks = [
      previousTask
        ? await call('transcribe_audio', { action: 'status', task_id: previousTask })
        : await complete('transcribe_audio', { audio_path: 'recording.mp3' }),
    ];
    assert.equal(tasks[0].status, 'completed');
    const text =
      '各位同學，請留意。星期六嘅西貢考察會改到星期日舉行。大家要喺朝早八點四十五分，喺學校正門集合。記得帶學生證、水同雨褸。如果有疑問，請喺小息嗰陣問班主任。';
    tasks.push(await complete('synthesize_speech', { text, voice: 'HiuMaan', subtitles: true }));
    tasks.push(
      await complete('synthesize_speech', {
        text,
        voice: 'WanLung',
        rate: '-10%',
        volume: '+5%',
        pitch: '+10Hz',
        subtitles: true,
      })
    );
    const report = {
      checkedAt: new Date().toISOString(),
      sourceSha256: createHash('sha256')
        .update(await readFile(source))
        .digest('hex'),
      mcpTools: inventory.tools.map((tool) => tool.name),
      tasks,
    };
    await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await new AudioStore(path.join(root, 'data')).saveSettings('audio-smoke', {
      model: 'google/gemini-3.8-flash',
      clearApiKey: true,
    });
    await runtime.close();
    backend.closeAllConnections();
    await new Promise<void>((resolve) => backend.close(() => resolve()));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.argv[2];
  const root = process.argv[3];
  assert(source && root, 'Usage: smoke.ts SOURCE_MP3 OUTPUT_DIRECTORY');
  void runAudioSmoke(path.resolve(source), path.resolve(root)).catch(() => {
    console.error('Audio smoke failed; inspect the task report for sanitized errors.');
    process.exitCode = 1;
  });
}
