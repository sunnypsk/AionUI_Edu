import { describe, expect, it } from 'vitest';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { blockSegments, textSegments } from '@/renderer/pages/studio/data/segments';
import { studioProjectPath } from '@/renderer/pages/studio/route';

const project: ListeningProject = {
  version: 1,
  title: 'Lesson',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [{ id: 'main', plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments: [] }],
};

describe('studio segments', () => {
  it('turns recording blocks into clips that carry their automatic transcript', () => {
    const segments = blockSegments(project, {
      version: 1,
      path: 'media/talk.mp3',
      durationSeconds: 30,
      warnings: [],
      blocks: [
        { start: 0, end: 11, text: '第一段' },
        { start: 11, end: 30, warnings: ['AUDIO_NO_SPEECH'] },
      ],
    });
    expect(segments).toEqual([
      {
        id: expect.stringMatching(/^clip-/),
        type: 'clip',
        path: 'media/talk.mp3',
        start: 0,
        end: 11,
        transcript: { text: '第一段', source: 'auto', verified: false },
      },
      {
        id: expect.stringMatching(/^clip-/),
        type: 'clip',
        path: 'media/talk.mp3',
        start: 11,
        end: 30,
        warnings: ['AUDIO_NO_SPEECH'],
      },
    ]);
    expect(new Set(segments.map((segment) => segment.id)).size).toBe(2);
  });

  it('turns script blocks into speech lines with unique ids', () => {
    const segments = textSegments(project, ['早晨', '你好']);
    expect(segments.map((segment) => (segment.type === 'speech' ? segment.text : ''))).toEqual(['早晨', '你好']);
    expect(new Set(segments.map((segment) => segment.id)).size).toBe(2);
  });

  it('encodes project ids in editor paths', () => {
    expect(studioProjectPath('a/b')).toBe('/audio/a%2Fb');
  });
});
