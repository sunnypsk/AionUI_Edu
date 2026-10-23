import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listeningProjectSchema,
  type ListeningTimeline,
} from '../../../../../desktop/src/common/types/platform/listeningProject.ts';
import type { TrackMedia } from '../ffmpeg.js';
import { renderTrack, SEGMENT_CACHE, type TrackServices } from '../render.js';

/** Fake media: every piece is a text file whose content encodes its duration. */
const fakeMedia = (): TrackMedia => ({
  probe: async (file) => {
    const content = await readFile(file, 'utf8');
    const match = /^(?:silence|clip):([\d.]+)/.exec(content);
    if (match) return Number(match[1]);
    if (content.startsWith('source')) return 60;
    if (content.startsWith('track:')) return content.split('\n').length - 1;
    return 2;
  },
  silence: async (file, seconds) => writeFile(file, `silence:${seconds}`),
  tone: async (file, preset) => writeFile(file, `tone:${preset}`),
  decode: async (source, file, _signal, window) =>
    writeFile(file, window ? `clip:${window.end - window.start}` : `decoded:${await readFile(source, 'utf8')}`),
  assemble: async (pieces, file) =>
    writeFile(file, `track:\n${(await Promise.all(pieces.map((piece) => readFile(piece, 'utf8')))).join('\n')}`),
});

describe('listening track rendering', () => {
  let root: string;
  let workspace: string;
  let run = 0;
  let speak: ReturnType<typeof vi.fn<TrackServices['speak']>>;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'listening-render-'));
    workspace = path.join(root, 'workspace');
    await mkdir(workspace);
    speak = vi.fn<TrackServices['speak']>(async (options) => {
      await writeFile(options.output, `tts:${options.voice}:${options.text}`);
      return { segments: [{ text: options.text!, startSecond: 0.1, endSecond: 1.9 }] };
    });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const render = async (
    sections: unknown[],
    extra: { lexicon?: unknown[]; onlySections?: string[]; transcribe?: TrackServices['transcribe'] } = {}
  ) => {
    const directory = path.join(root, `work-${run++}`);
    await mkdir(directory);
    const progress = vi.fn(async () => {});
    const result = await renderTrack({
      project: listeningProjectSchema.parse({ version: 1, title: '單元二', lexicon: extra.lexicon, sections }),
      onlySections: extra.onlySections,
      workspace,
      directory,
      signal: new AbortController().signal,
      services: { media: fakeMedia(), speak, transcribe: extra.transcribe },
      progress,
    });
    const read = (name: string) => readFile(path.join(directory, name), 'utf8');
    return { result, read, progress };
  };
  const dialogue = [
    {
      id: 'part1',
      plays: 2,
      gapBetweenPlays: 5,
      segments: [
        { id: 'a', type: 'speech', voice: 'WanLung', text: '請重新排隊。' },
        { id: 'b', type: 'speech', text: '好的。' },
      ],
    },
    { id: 'end', segments: [{ id: 'c', type: 'chime', preset: 'end' }] },
  ];

  it('assembles plays, gaps and speakers in order with offset subtitles in script wording', async () => {
    const { result, read } = await render(dialogue, { lexicon: [{ match: '重新', speak: '蟲新' }] });
    expect(speak.mock.calls.map(([options]) => [options.voice, options.text])).toEqual([
      ['WanLung', '請蟲新排隊。'],
      ['HiuMaan', '好的。'],
    ]);
    const timeline = JSON.parse(await read('timeline.json')) as ListeningTimeline;
    expect(timeline.entries.map((entry) => [entry.type, entry.segmentId ?? null, entry.start, entry.end])).toEqual([
      ['speech', 'a', 0, 2],
      ['speech', 'b', 2, 4],
      ['gap', null, 4, 9],
      ['speech', 'a', 9, 11],
      ['speech', 'b', 11, 13],
      ['gap', null, 13, 16],
      ['chime', 'c', 16, 18],
    ]);
    const srt = await read('track.srt');
    expect(srt).toContain('00:00:00,100 --> 00:00:01,900\n請重新排隊。');
    expect(srt).toContain('00:00:09,100 --> 00:00:10,900\n請重新排隊。');
    expect(srt).not.toContain('蟲新');
    expect(result.files.map((file) => path.basename(file))).toEqual([
      'track.mp3',
      'track.srt',
      'timeline.json',
      'script.txt',
    ]);
    expect(result.warnings).toEqual(['AUDIO_QA_SKIPPED']);
  });

  it('re-synthesizes only changed speech on later renders', async () => {
    await render(dialogue);
    expect(speak).toHaveBeenCalledTimes(2);
    await render(dialogue);
    expect(speak).toHaveBeenCalledTimes(2);
    const edited = structuredClone(dialogue);
    edited[0].segments[1] = { id: 'b', type: 'speech', text: '明白。' };
    const { progress } = await render(edited);
    expect(speak).toHaveBeenCalledTimes(3);
    expect(speak.mock.calls[2][0].text).toBe('明白。');
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    const cached = await readdir(path.join(workspace, ...SEGMENT_CACHE.split('/')));
    expect(cached.filter((name) => name.endsWith('.mp3'))).toHaveLength(3);
    expect(cached.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('reports misheard speech and reuses cached QA transcripts', async () => {
    const transcribe = vi.fn<NonNullable<TrackServices['transcribe']>>(async (source) =>
      (await readFile(source, 'utf8')).includes('好的') ? '好嘅' : '請重新排隊'
    );
    const first = await render(dialogue, { transcribe });
    expect(first.result).toMatchObject({ qaIssues: 1, warnings: [] });
    expect(JSON.parse(await first.read('qa.json'))).toEqual([
      { segmentId: 'b', expected: '好的。', heard: '好嘅', similarity: 0.5 },
    ]);
    await render(dialogue, { transcribe });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('keeps rendering when one QA transcription fails', async () => {
    const transcribe = vi.fn<NonNullable<TrackServices['transcribe']>>(async () => {
      throw new Error('AUDIO_PROVIDER_FAILED');
    });
    const { result } = await render(dialogue, { transcribe });
    expect(result).toMatchObject({ qaIssues: 0, warnings: ['AUDIO_QA_INCOMPLETE'] });
  });

  it('reuses a window of an uploaded recording and rejects windows past its end', async () => {
    await writeFile(path.join(workspace, 'old.mp3'), 'source');
    const clip = (end: number) => [
      { id: 'ref', segments: [{ id: 'k', type: 'clip', path: 'old.mp3', start: 10, end }] },
    ];
    const { result } = await render(clip(25));
    expect(result.durationSeconds).toBe(1);
    await expect(render(clip(61))).rejects.toMatchObject({
      message: 'AUDIO_PROJECT_INVALID',
      details: ['k.end: beyond the end of old.mp3'],
    });
  });

  it('renders only the requested sections', async () => {
    const { read } = await render(dialogue, { onlySections: ['end'] });
    expect(speak).not.toHaveBeenCalled();
    expect((JSON.parse(await read('timeline.json')) as ListeningTimeline).entries).toHaveLength(1);
    expect(await read('script.txt')).not.toContain('好的');
  });
});
