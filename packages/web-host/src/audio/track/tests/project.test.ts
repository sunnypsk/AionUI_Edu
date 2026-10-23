import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listeningProjectSchema } from '../../../../../desktop/src/common/types/platform/listeningProject.ts';
import {
  AudioProjectError,
  applyLexicon,
  formatScript,
  loadProject,
  planTrack,
  restoreLexicon,
  speechKey,
} from '../project.js';
import { similarity, speechSimilarity } from '../verify.js';

const project = (sections: unknown[], extra: Record<string, unknown> = {}) =>
  listeningProjectSchema.parse({ version: 1, title: '聆聽練習', sections, ...extra });

describe('listening project', () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'listening-project-'));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('reports field paths for invalid or duplicate entries', async () => {
    await writeFile(
      path.join(workspace, 'bad.json'),
      JSON.stringify({
        version: 1,
        title: 'x',
        sections: [{ id: 'a', segments: [{ id: 'a', type: 'pause', seconds: 0 }] }],
      })
    );
    const error = await loadProject(workspace, 'bad.json').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AudioProjectError);
    expect((error as AudioProjectError).details).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^sections\.0\.segments\.0\.seconds: /),
        'sections.0.segments.0.id: duplicate id a',
      ])
    );
    await writeFile(path.join(workspace, 'broken.json'), '{');
    await expect(loadProject(workspace, 'broken.json')).rejects.toMatchObject({
      message: 'AUDIO_PROJECT_INVALID',
      details: [expect.stringMatching(/^invalid JSON/)],
    });
    await expect(loadProject(workspace, '../outside.json')).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
  });

  it('applies pronunciation fixes to TTS text only and restores them for subtitles', () => {
    const lexicon = [
      { match: '重', speak: '眾' },
      { match: '重新', speak: '蟲新' },
    ];
    expect(applyLexicon('請重新再聽', lexicon)).toBe('請蟲新再聽');
    expect(restoreLexicon('請蟲新再聽', lexicon)).toBe('請重新再聽');
    const [speech] = planTrack(
      project([{ id: 'a', segments: [{ id: 's', type: 'speech', text: '重新' }] }], { lexicon })
    );
    expect(speech).toMatchObject({ kind: 'speech', original: '重新', request: { text: '蟲新', voice: 'HiuMaan' } });
  });

  it('keys speech by voice settings and spoken text', () => {
    const base = { text: '你好', voice: 'HiuMaan' as const, rate: '+0%', volume: '+0%', pitch: '+0Hz' };
    expect(speechKey(base)).toBe(speechKey({ ...base }));
    expect(speechKey(base)).not.toBe(speechKey({ ...base, voice: 'WanLung' }));
    expect(speechKey(base)).not.toBe(speechKey({ ...base, rate: '-10%' }));
  });

  it('plans repeated plays with gaps and drops the trailing section gap', () => {
    const plan = planTrack(
      project([
        { id: 'one', plays: 2, gapBetweenPlays: 4, gapAfter: 6, segments: [{ id: 'q', type: 'chime' }] },
        { id: 'two', gapAfter: 9, segments: [{ id: 'p', type: 'pause', seconds: 1 }] },
      ])
    );
    expect(
      plan.map((item) => [item.kind, item.segmentId ?? null, item.play, 'seconds' in item ? item.seconds : null])
    ).toEqual([
      ['tone', 'q', 1, null],
      ['silence', null, 2, 4],
      ['tone', 'q', 2, null],
      ['silence', null, 2, 6],
      ['silence', 'p', 1, 1],
    ]);
    expect(() => planTrack(project([{ id: 'one', segments: [{ id: 'q', type: 'chime' }] }]), ['missing'])).toThrow(
      AudioProjectError
    );
  });

  it('prints a script with headings, speakers, pauses and repeat counts', () => {
    const script = formatScript(
      project([
        {
          id: 'a',
          label: '第一部分',
          plays: 2,
          segments: [
            { id: 's', type: 'speech', speaker: '陳先生', text: '早晨。' },
            { id: 'p', type: 'pause', seconds: 10, note: '作答' },
          ],
        },
      ])
    );
    expect(script).toBe('聆聽練習\n\n【第一部分】 ×2\n陳先生：早晨。\n（10s 作答）\n');
  });

  it('scores transcripts ignoring punctuation and width', () => {
    expect(similarity('你好，世界！', '你好世界')).toBe(1);
    expect(similarity('ＡＢＣ', 'abc')).toBeLessThan(1);
    expect(similarity('ABC', 'ＡＢＣ')).toBe(1);
    expect(similarity('一二三四', '一二三五')).toBe(0.75);
    expect(speechSimilarity('重新', '蟲新', '蟲新')).toBe(1);
  });
});
