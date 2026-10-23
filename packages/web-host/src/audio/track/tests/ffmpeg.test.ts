/** Opt-in media integration: synthetic audio only, with no provider credentials or network calls. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AudioManager } from '../../manager.js';
import { media, runProcess } from '../../providers/media.js';
import { MultimodalTranscriber } from '../../providers/gemini.js';
import { detectSilences } from '../ffmpeg.js';

it.runIf(process.env.AIONUI_AUDIO_REFERENCE_TEST === '1')(
  'transcribes a real five-minute boundary without an extra encoder-padding request',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reference-boundary-'));
    const workspace = path.join(root, 'workspace');
    const signal = AbortSignal.timeout(30000);
    let requests = 0;
    const transcriber = new MultimodalTranscriber(async () => {
      requests++;
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                segments: [{ text: '請留意下一題。', startSecond: 0, endSecond: 1 }],
              }),
            },
          },
        ],
        usage: { cost: 0 },
      });
    });
    const manager = new AudioManager(root, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      silences: async () => [],
      transcribe: (options) => transcriber.transcribe(options),
    });
    try {
      await mkdir(workspace);
      await runProcess(
        process.env.AIONUI_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=24000:duration=305',
          path.join(workspace, 'long.wav'),
        ],
        signal
      );
      const owner = { userId: 'fixture', conversationId: 'fixture', workspace };
      await manager.parentStart(owner, 'event', 'thread');
      await manager.store.saveSettings(owner.userId, { model: 'fixture/model', apiKey: 'fixture-key' });
      const started = await manager.command(
        owner,
        'analyze_reference_audio',
        { audio_path: 'long.wav', mode: 'speech' },
        signal
      );
      const task = await manager.command(
        owner,
        'analyze_reference_audio',
        { action: 'wait', task_id: started.id, wait_sec: 20 },
        signal
      );
      expect(task).toMatchObject({ status: 'completed', warnings: ['AUDIO_APPROXIMATE_TIMESTAMPS'] });
      expect(requests).toBe(2);
    } finally {
      await manager.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  40000
);

it.runIf(process.env.AIONUI_AUDIO_REFERENCE_TEST === '1')(
  'detects real leading and trailing silence and renders the analyzed clip project',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'reference-ffmpeg-'));
    const workspace = path.join(root, 'workspace');
    const manager = new AudioManager(root);
    const signal = AbortSignal.timeout(30000);
    try {
      await mkdir(workspace);
      const file = path.join(workspace, 'original.wav');
      await runProcess(
        process.env.AIONUI_FFMPEG ?? 'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-f',
          'lavfi',
          '-i',
          "aevalsrc=exprs='if(between(t,1,2)+between(t,4,6),0.1*sin(2*PI*440*t),0)':s=24000:d=8",
          '-ac',
          '2',
          file,
        ],
        signal
      );
      const silences = await detectSilences(file, { noiseDb: -35, minSeconds: 0.5, duration: 8 }, signal);
      expect(silences.map((interval) => [Math.round(interval.start), Math.round(interval.end)])).toEqual([
        [0, 1],
        [2, 4],
        [6, 8],
      ]);
      const owner = { userId: 'fixture', conversationId: 'fixture', workspace };
      await manager.parentStart(owner, 'event', 'thread');
      const started = await manager.command(owner, 'analyze_reference_audio', { audio_path: 'original.wav' }, signal);
      const analysis = await manager.command(
        owner,
        'analyze_reference_audio',
        { action: 'wait', task_id: started.id, wait_sec: 20 },
        signal
      );
      expect(analysis).toMatchObject({ status: 'completed', files: expect.any(Array) });
      const render = await manager.startUserTrack(owner, { project_path: analysis.projectPath!, verify: false });
      const track = await manager.command(
        owner,
        'render_listening_track',
        { action: 'wait', task_id: render.id, wait_sec: 20 },
        signal
      );
      expect(track).toMatchObject({ status: 'completed' });
      const duration = await media.probe(path.join(workspace, track.files[0].path), signal);
      expect(Math.abs(duration - 8)).toBeLessThan(0.15);
      const report = JSON.parse(await readFile(path.join(workspace, analysis.files[1].path), 'utf8')) as {
        regions: unknown[];
      };
      expect(report.regions).toHaveLength(2);
    } finally {
      await manager.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  40000
);
