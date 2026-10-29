import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listeningProjectSchema } from '../../../../desktop/src/common/types/platform/listeningProject.ts';
import { planTrack } from '../../audio/track/project.js';
import { groupRegions } from '../../audio/track/structure.js';
import type { AnalysisServices } from '../../audio/track/analyze.js';
import { importMedia } from '../importMedia.js';
import { blocksPath, safeMediaName, STUDIO_PROJECT_FILE, StudioProjects } from '../projects.js';
import { textBlocks } from '../text.js';

const options = { minSeconds: 8, maxSeconds: 40, breakSeconds: 3 };
/** Regions of `length` seconds separated by the given pauses. */
const regionsWith = (length: number, pauses: number[]) => {
  let cursor = 0;
  return [0, ...pauses].map((pause) => {
    cursor += pause;
    cursor = Number(cursor.toFixed(3));
    const region = { start: cursor, end: cursor + length };
    cursor += length;
    return region;
  });
};

describe('groupRegions', () => {
  it('merges short phrases into one block when the run fits and has no paragraph pause', () => {
    expect(groupRegions(regionsWith(2, [0.6, 0.6, 0.6]), options)).toEqual([{ start: 0, end: 9.8 }]);
  });

  it('cuts long runs at their longest pause while keeping both sides above the minimum', () => {
    // 10 phrases of 4 s: 2.0 s pause after the fifth phrase, 0.5 s elsewhere.
    const pauses = [0.5, 0.5, 0.5, 0.5, 2, 0.5, 0.5, 0.5, 0.5];
    const blocks = groupRegions(regionsWith(4, pauses), options);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].end).toBe(22);
    for (const block of blocks) expect(block.end - block.start).toBeLessThanOrEqual(40);
  });

  it('splits at paragraph pauses even when the run is short, but never below the minimum', () => {
    expect(groupRegions(regionsWith(5, [0.5, 4, 0.5]), options)).toEqual([
      { start: 0, end: 10.5 },
      { start: 14.5, end: 25 },
    ]);
    // A 4 s pause after a single 2 s phrase would leave a too-short block, so it stays merged.
    expect(groupRegions(regionsWith(2, [4, 0.5, 0.5, 0.5]), options)).toHaveLength(1);
  });

  it('keeps a single region longer than the maximum and handles empty input', () => {
    expect(groupRegions([{ start: 0, end: 90 }], options)).toEqual([{ start: 0, end: 90 }]);
    expect(groupRegions([], options)).toEqual([]);
  });
});

describe('textBlocks', () => {
  it('uses paragraphs when the script has blank lines, joining wrapped lines', () => {
    expect(textBlocks('第一段\n繼續\n\n第二段\r\n\r\n\r\n第三段')).toEqual(['第一段 繼續', '第二段', '第三段']);
  });

  it('uses one block per line otherwise, and splits overlong paragraphs at sentences', () => {
    expect(textBlocks('甲：早晨。\n乙：你好。\n')).toEqual(['甲：早晨。', '乙：你好。']);
    const long = '這是一句很長的句子。'.repeat(300);
    const blocks = textBlocks(long);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(2000);
  });

  it('rejects empty and oversized scripts', () => {
    expect(() => textBlocks(' \n ')).toThrow('AUDIO_TEXT_REQUIRED');
    expect(() => textBlocks('a\n'.repeat(501))).toThrow('AUDIO_TEXT_TOO_LARGE');
  });
});

describe('safeMediaName', () => {
  it('keeps readable names in any script and strips paths and unsafe characters', () => {
    expect(safeMediaName('../../etc/課文 錄音 (1).MP3')).toBe('課文-錄音-1.mp3');
    expect(safeMediaName('C:\\Users\\x\\.hidden.wav')).toBe('hidden.wav');
    expect(safeMediaName('???.ogg')).toBe('audio.ogg');
  });
});

describe('studio projects and import', () => {
  let directory: string;
  let projects: StudioProjects;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'audio-studio-'));
    projects = new StudioProjects(directory);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates an empty but valid project that cannot be rendered yet', async () => {
    const created = await projects.create('alice', '第一課');
    expect(created).toMatchObject({ title: '第一課', projectPath: STUDIO_PROJECT_FILE, segments: 0 });
    expect(created.workspace).toBe(path.join(directory, 'audio-projects', 'alice', created.id));
    const project = listeningProjectSchema.parse(
      JSON.parse(await readFile(path.join(created.workspace, STUDIO_PROJECT_FILE), 'utf8'))
    );
    expect(() => planTrack(project)).toThrow('AUDIO_PROJECT_INVALID');
    expect((await projects.list('alice')).map((item) => item.id)).toEqual([created.id]);
    expect(await projects.list('bob')).toEqual([]);
  });

  it('scopes projects per user and removes them completely', async () => {
    const created = await projects.create('alice', 'Lesson');
    await expect(projects.owner('bob', created.id)).rejects.toThrow('AUDIO_PROJECT_NOT_FOUND');
    await expect(projects.owner('alice', '../alice')).rejects.toThrow();
    expect(await projects.owner('alice', created.id)).toEqual({
      userId: 'alice',
      conversationId: `studio-${created.id}`,
      workspace: created.workspace,
    });
    await projects.remove('alice', created.id);
    expect(await projects.list('alice')).toEqual([]);
  });

  it('splits a recording into contiguous transcribed blocks with cuts inside pauses', async () => {
    const created = await projects.create('alice', 'Lesson');
    await writeFile(path.join(created.workspace, 'media', 'talk.wav'), 'fixture');
    const services: AnalysisServices = {
      probe: async () => 30,
      // Speech 0–9, 13–21 and 21.6–30: one paragraph pause (4 s) and one short pause.
      silences: async () => [
        { start: 9, end: 13 },
        { start: 21, end: 21.6 },
      ],
      cut: async (_file, destination, start) => writeFile(destination, String(start)),
      transcribe: async (file) => `從${await readFile(file, 'utf8')}秒開始`,
    };
    const progress: number[] = [];
    const result = await importMedia({
      workspace: created.workspace,
      mediaPath: 'media/talk.wav',
      directory: await mkdtemp(path.join(directory, 'work-')),
      signal: new AbortController().signal,
      services,
      progress: async (completed) => {
        progress.push(completed);
      },
    });
    expect(result).toMatchObject({ durationSeconds: 30, blocks: 2, warnings: [], issues: [] });
    expect(progress.at(-1)).toBe(3);
    const stored = await projects.blocks(created.workspace, 'media/talk.wav');
    expect(stored.blocks).toEqual([
      { start: 0, end: 11, text: '從0秒開始' },
      { start: 11, end: 30, text: '從13秒開始' },
    ]);
    expect(await projects.media('alice', created.id)).toEqual([
      expect.objectContaining({ path: 'media/talk.wav', durationSeconds: 30, blocks: 2, transcribed: true }),
    ]);
    expect(blocksPath('media/talk.wav')).toBe('.studio/blocks/talk.wav.json');
  });

  it('splits without transcripts when no transcriber is available', async () => {
    const created = await projects.create('alice', 'Lesson');
    await writeFile(path.join(created.workspace, 'media', 'quiet.mp3'), 'fixture');
    const result = await importMedia({
      workspace: created.workspace,
      mediaPath: 'media/quiet.mp3',
      directory,
      signal: new AbortController().signal,
      services: { probe: async () => 12, silences: async () => [{ start: 0, end: 12 }], cut: async () => {} },
      progress: async () => {},
    });
    expect(result.warnings).toEqual(['AUDIO_ANALYSIS_NO_TRANSCRIPT']);
    expect((await projects.blocks(created.workspace, 'media/quiet.mp3')).blocks).toEqual([{ start: 0, end: 12 }]);
  });
});
