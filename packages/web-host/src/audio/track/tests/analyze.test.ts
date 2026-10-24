import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listeningProjectSchema } from '../../../../../desktop/src/common/types/platform/listeningProject.ts';
import { analyzeReference, type AnalysisOptions } from '../analyze.js';
import { buildProject, MAX_REGIONS, speechRegions, splitText, type StructureOptions } from '../structure.js';
import { planTrack } from '../project.js';

const structure: StructureOptions = {
  title: '聆聽練習',
  audioPath: 'audio/task/reference.wav',
  mode: 'clip',
  duration: 20,
  sectionGap: 3,
  padding: 0.15,
};
const line = '放學後請同學到學校禮堂集合，聽老師講解明天的參觀安排。';

describe('reference structure', () => {
  it('handles overlapping and out-of-range silences without losing short chimes', () => {
    expect(
      speechRegions(
        [
          { start: 5, end: 50 },
          { start: -2, end: 1 },
          { start: 2, end: 3 },
          { start: 2.5, end: 4.8 },
        ],
        10,
        0.1
      )
    ).toEqual([
      { start: 1, end: 2 },
      { start: 4.8, end: 5 },
    ]);
    expect(speechRegions([{ start: 0, end: 10 }], 10, 1)).toEqual([]);
  });

  it('bounds highly fragmented projects without dropping their first or last sound', () => {
    const regions = speechRegions(
      Array.from({ length: 600 }, (_, i) => ({ start: i * 3 + 1, end: i * 3 + 2 })),
      1800,
      0.2
    );
    expect(regions).toHaveLength(MAX_REGIONS);
    expect([regions[0].start, regions.at(-1)?.end]).toEqual([0, 1800]);
  });

  it('keeps leading, trailing and long pauses while accounting for clip padding exactly once', () => {
    const project = buildProject(
      [
        { start: 1, end: 3 },
        { start: 5, end: 8 },
        { start: 710, end: 713 },
      ],
      { ...structure, duration: 720 }
    );
    const total = planTrack(project).reduce(
      (sum, item) => sum + (item.kind === 'clip' ? item.end - item.start : item.kind === 'silence' ? item.seconds : 0),
      0
    );
    expect(total).toBeCloseTo(720, 2);
    expect(project.sections.every((section) => section.gapAfter <= 600)).toBe(true);
  });

  it('collapses complete identical transcripts into repeat plays and keeps the following gap', () => {
    const project = buildProject(
      [
        { start: 0, end: 5, text: line },
        { start: 9, end: 14, text: line },
        { start: 19, end: 20, text: '下一題。' },
      ],
      { ...structure, mode: 'speech' }
    );
    expect(project.sections.map((section) => [section.plays, section.gapBetweenPlays, section.gapAfter])).toEqual([
      [2, 4, 5],
      [1, 0, 0],
    ]);
  });

  it('does not collapse similar questions, short responses, partial transcripts or original clips', () => {
    for (const [first, second, mode] of [
      [line, line.replace('明天', '後天'), 'speech'],
      ['係。', '係。', 'speech'],
      [line, line, 'clip'],
    ] as const) {
      const project = buildProject(
        [
          { start: 0, end: 5, text: first },
          { start: 9, end: 14, text: second },
        ],
        { ...structure, duration: 14, mode }
      );
      expect(project.sections.map((section) => section.plays)).toEqual([1, 1]);
    }
    const partial = buildProject(
      [
        { start: 0, end: 2, text: line },
        { start: 3, end: 4 },
        { start: 8, end: 10, text: line },
      ],
      { ...structure, mode: 'speech', duration: 10 }
    );
    expect(partial.sections.map((section) => section.plays)).toEqual([1, 1]);
  });

  it('keeps long Unicode transcripts intact and within the speech size limit', () => {
    const text = '你好！' + '𠮷'.repeat(2100) + '。完畢。';
    const chunks = splitText(text);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 2000 && chunk.isWellFormed())).toBe(true);
    expect(splitText('   ')).toEqual([]);
  });

  it('falls back to source clips instead of exceeding the project segment limit', () => {
    const regions = Array.from({ length: 200 }, (_, i) => ({ start: i * 3, end: i * 3 + 1, text: '甲'.repeat(6000) }));
    const project = buildProject(regions, { ...structure, mode: 'speech', duration: 600 });
    expect(project.sections.flatMap((section) => section.segments).length).toBeLessThanOrEqual(500);
    expect(project.sections.flatMap((section) => section.segments).some((segment) => segment.type === 'clip')).toBe(
      true
    );
  });
});

describe('reference analysis bundle', () => {
  let root: string;
  let options: AnalysisOptions;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'reference-analysis-'));
    const workspace = path.join(root, 'workspace');
    const directory = path.join(root, 'private');
    await mkdir(workspace);
    await mkdir(directory);
    await writeFile(path.join(workspace, 'recording.wav'), 'original');
    options = {
      workspace,
      directory,
      audioPath: 'recording.wav',
      outputPath: 'audio/task',
      signal: new AbortController().signal,
      mode: 'speech',
      noiseDb: -35,
      mergeGap: 1,
      sectionGap: 3,
      progress: vi.fn(async () => {}),
      services: {
        probe: async () => 20,
        silences: async () => [{ start: 4, end: 8 }],
        cut: vi.fn(async (_source, target) => {
          await writeFile(target, 'chunk');
        }),
        transcribe: async () => line,
      },
    };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prepares a valid private bundle without modifying the workspace or exposing costs', async () => {
    const result = await analyzeReference(options);
    const project = listeningProjectSchema.parse(JSON.parse(await readFile(result.files[0], 'utf8')));
    expect(await readdir(options.workspace)).toEqual(['recording.wav']);
    expect(project.sections[0]).toMatchObject({ plays: 2 });
    expect(result).toMatchObject({
      projectPath: 'audio/task/reference.listening.json',
      warnings: ['AUDIO_APPROXIMATE_TIMESTAMPS'],
    });
  });

  it('uses the copied source and retains original audio when a transcript chunk fails', async () => {
    options.services.transcribe = vi.fn(async (file: string) => {
      if (file.includes('region-0-')) throw new Error('AUDIO_API_FAILED');
      return line;
    });
    const result = await analyzeReference(options);
    const project = listeningProjectSchema.parse(JSON.parse(await readFile(result.files[0], 'utf8')));
    expect(project.sections[0].segments[0]).toMatchObject({ type: 'clip', path: 'audio/task/reference.wav' });
    expect(result.warnings).toContain('AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE');
    expect(await readFile(result.files[2], 'utf8')).toBe('original');
  });

  it('puts every five-minute request in its own directory and retains all transcript parts', async () => {
    options.services.probe = async () => 610;
    options.services.silences = async () => [];
    const directories = new Set<string>();
    options.services.transcribe = async (_file, directory) => {
      await writeFile(path.join(directory, 'exclusive.json'), 'request', { flag: 'wx' });
      directories.add(directory);
      return line;
    };
    const result = await analyzeReference(options);
    const report = JSON.parse(await readFile(result.files[1], 'utf8')) as { regions: { text: string }[] };
    expect(directories.size).toBe(3);
    expect(report.regions[0].text).toBe([line, line, line].join('\n'));
  });

  it('retains text after a filtered middle chunk and records only that failed range with a clip target', async () => {
    options.mode = 'clip';
    options.services.probe = async () => 610;
    options.services.silences = async () => [];
    const calls: string[] = [];
    options.services.transcribe = async (_file, directory) => {
      calls.push(directory);
      if (directory.endsWith('region-0-1')) throw new Error('AUDIO_CONTENT_FILTERED');
      return directory.endsWith('region-0-0') ? '開始。' : '結束。';
    };
    const result = await analyzeReference(options);
    const report = JSON.parse(await readFile(result.files[1], 'utf8'));
    expect(calls).toHaveLength(3);
    expect(report.regions[0]).toMatchObject({ text: '開始。\n結束。', warnings: ['AUDIO_CONTENT_FILTERED'] });
    expect(result.issues).toEqual([
      { code: 'AUDIO_CONTENT_FILTERED', startSecond: 295, endSecond: 590, segmentId: 'part-1-c1' },
    ]);
  });

  it('distinguishes a valid empty transcription from malformed provider output', async () => {
    options.mode = 'clip';
    options.services.silences = async () => [];
    options.services.transcribe = async () => '';
    const result = await analyzeReference(options);
    expect(result.issues).toMatchObject([{ code: 'AUDIO_NO_SPEECH', startSecond: 0, endSecond: 20 }]);
  });

  it('creates clips without a key and reports that no transcript was produced', async () => {
    options.services.transcribe = undefined;
    options.mode = 'clip';
    const result = await analyzeReference(options);
    expect(result.warnings).toContain('AUDIO_ANALYSIS_NO_TRANSCRIPT');
    expect(options.services.cut).not.toHaveBeenCalled();
  });

  it('rejects all-silent audio, oversized audio and paths outside the workspace', async () => {
    options.services.silences = async () => [{ start: 0, end: 20 }];
    await expect(analyzeReference(options)).rejects.toThrow('AUDIO_NO_SPEECH');
    options.services.probe = async () => 5401;
    await expect(analyzeReference(options)).rejects.toThrow('AUDIO_TRACK_TOO_LONG');
    await expect(analyzeReference({ ...options, audioPath: '../outside.wav' })).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
  });

  it('joins both workers on cancellation before returning, with no project published', async () => {
    const controller = new AbortController();
    options.signal = controller.signal;
    let entered = 0;
    let finished = 0;
    options.services.transcribe = async (_file, _directory, signal) => {
      entered++;
      const result = new Promise<string>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            setTimeout(() => {
              finished++;
              reject(new Error('AUDIO_CANCELLED'));
            }, 5);
          },
          { once: true }
        )
      );
      if (entered === 2) controller.abort();
      return result;
    };
    await expect(analyzeReference(options)).rejects.toThrow('AUDIO_CANCELLED');
    expect(finished).toBe(2);
    expect(await readdir(options.workspace)).toEqual(['recording.wav']);
  });
});
