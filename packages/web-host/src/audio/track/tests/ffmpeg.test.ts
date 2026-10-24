/** Opt-in media integration: synthetic audio only, with no provider credentials or network calls. */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AudioManager } from '../../manager.js';
import { media, runProcess } from '../../providers/media.js';
import { MultimodalTranscriber } from '../../providers/gemini.js';
import { detectSilences, sourceTrackMedia } from '../ffmpeg.js';

it.runIf(process.env.AIONUI_AUDIO_REFERENCE_TEST === '1')(
  'keeps every MP3 sample across fractional contiguous clip boundaries',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mp3-sample-boundaries-'));
    const signal = AbortSignal.timeout(30000);
    const command = process.env.AIONUI_FFMPEG ?? 'ffmpeg';
    try {
      const source = path.join(root, 'source.mp3');
      await runProcess(
        command,
        [
          '-v',
          'error',
          '-nostdin',
          '-n',
          '-f',
          'lavfi',
          '-i',
          'aevalsrc=0.1*sin(2*PI*443*t)|0.03*sin(2*PI*661*t):s=44100:d=3',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '320k',
          source,
        ],
        signal
      );
      const profile = await sourceTrackMedia(source, signal);
      const raw = async (file: string, name: string): Promise<Buffer> => {
        const output = path.join(root, name + '.raw');
        await runProcess(command, ['-v', 'error', '-nostdin', '-n', '-i', file, '-f', 'f32le', output], signal);
        return readFile(output);
      };
      const original = await raw(source, 'original');
      const boundaries = [0, 0.987654, 1.234567, 2.876543, 3];
      const pieces: Buffer[] = [];
      for (let i = 1; i < boundaries.length; i++) {
        const file = path.join(root, `clip-${i}.wav`);
        await profile.decode(source, file, signal, { start: boundaries[i - 1], end: boundaries[i] });
        pieces.push(await raw(file, `clip-${i}`));
      }
      expect(Buffer.concat(pieces).equals(original)).toBe(true);
      const start = Math.round(boundaries[2] * 44100) * 8;
      expect(pieces[2].equals(original.subarray(start, Math.round(boundaries[3] * 44100) * 8))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  40000
);

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

it.runIf(process.env.AIONUI_AUDIO_REFERENCE_TEST === '1')(
  'retains stereo source PCM outside a natural-duration replacement and encodes its source profile',
  async () => {
    const { renderTrack } = await import('../render.js');
    const { trackMedia } = await import('../ffmpeg.js');
    const { parseProject } = await import('../project.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'source-preserving-'));
    const signal = AbortSignal.timeout(60000);
    const command = process.env.AIONUI_FFMPEG ?? 'ffmpeg';
    try {
      const source = path.join(root, 'source.wav');
      await runProcess(
        command,
        [
          '-v',
          'error',
          '-nostdin',
          '-n',
          '-f',
          'lavfi',
          '-i',
          'aevalsrc=0.1*sin(2*PI*440*t)|0.03*sin(2*PI*660*t):s=44100:d=3',
          source,
        ],
        signal
      );
      const project = parseProject({
        version: 1,
        title: 'source',
        sourceAudio: 'source.wav',
        sections: [
          {
            id: 'one',
            plays: 1,
            gapAfter: 0,
            segments: [
              { id: 'before', type: 'clip', path: 'source.wav', start: 0, end: 1.25 },
              {
                id: 'year',
                type: 'speech',
                text: '二零二六年',
                replaces: { path: 'source.wav', start: 1.25, end: 1.75 },
              },
              { id: 'after', type: 'clip', path: 'source.wav', start: 1.75, end: 3 },
            ],
          },
        ],
      });
      const directory = path.join(root, 'render');
      await mkdir(directory);
      const result = await renderTrack({
        project,
        workspace: root,
        directory,
        signal,
        services: {
          media: trackMedia,
          speak: async (options) => {
            await runProcess(
              command,
              [
                '-v',
                'error',
                '-nostdin',
                '-n',
                '-f',
                'lavfi',
                '-i',
                'sine=frequency=880:sample_rate=24000:duration=2.25',
                '-c:a',
                'libmp3lame',
                options.output,
              ],
              signal
            );
            return { segments: [{ text: options.text!, startSecond: 0, endSecond: 2.25 }] };
          },
        },
        progress: async () => {},
      });
      const raw = async (file: string, name: string): Promise<Buffer> => {
        const destination = path.join(root, name + '.raw');
        await runProcess(command, ['-v', 'error', '-nostdin', '-n', '-i', file, '-f', 'f32le', destination], signal);
        return readFile(destination);
      };
      const original = await raw(source, 'original');
      const before = await raw(path.join(directory, 'pcm', 'clip-before.wav'), 'before');
      const after = await raw(path.join(directory, 'pcm', 'clip-after.wav'), 'after');
      expect(before.equals(original.subarray(0, Math.round(1.25 * 44100) * 8))).toBe(true);
      expect(after.equals(original.subarray(Math.round(1.75 * 44100) * 8))).toBe(true);
      const metadata = JSON.parse(
        await runProcess(
          process.env.AIONUI_FFPROBE ?? 'ffprobe',
          [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=sample_rate,channels,bit_rate',
            '-of',
            'json',
            result.files[0],
          ],
          signal
        )
      );
      expect(metadata.streams[0]).toMatchObject({ sample_rate: '44100', channels: 2, bit_rate: '192000' });
      const timeline = JSON.parse(await readFile(path.join(directory, 'timeline.json'), 'utf8'));
      expect(timeline.entries.at(-1).end).toBeCloseTo(4.75, 2);
      expect(Math.abs(result.durationSeconds - 4.75)).toBeLessThan(0.08);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  70000
);
