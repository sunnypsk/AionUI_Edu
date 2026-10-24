import { describe, expect, it } from 'vitest';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import {
  CHIME_SECONDS,
  estimateSpeechSeconds,
  layoutTimeline,
  sequenceTrack,
} from '@/common/types/platform/listeningTimeline';

const project = (): ListeningProject => ({
  version: 1,
  title: 'Unit',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    {
      id: 's1',
      plays: 2,
      gapBetweenPlays: 5,
      gapAfter: 3,
      segments: [
        { id: 'a', type: 'speech', text: '你好' },
        { id: 'b', type: 'speech', text: '早晨' },
      ],
    },
    {
      id: 's2',
      plays: 1,
      gapBetweenPlays: 5,
      gapAfter: 3,
      segments: [
        { id: 'c', type: 'pause', seconds: 4 },
        { id: 'd', type: 'chime', preset: 'start' },
        { id: 'e', type: 'clip', path: 'audio/source.mp3', start: 10, end: 12.5 },
      ],
    },
  ],
});

const label = (item: ReturnType<typeof sequenceTrack>[number]): string =>
  item.kind === 'gap' ? `gap-${item.reason}-${item.play}-${item.seconds}` : `${item.segment.id}-${item.play}`;

describe('sequenceTrack', () => {
  it('repeats plays with gaps between them and drops the trailing section gap', () => {
    expect(sequenceTrack(project()).map(label)).toEqual([
      'a-1',
      'b-1',
      'gap-between-2-5',
      'a-2',
      'b-2',
      'gap-after-2-3',
      'c-1',
      'd-1',
      'e-1',
    ]);
  });

  it('keeps only the requested sections', () => {
    expect(sequenceTrack(project(), ['s2']).map(label)).toEqual(['c-1', 'd-1', 'e-1']);
  });
});

describe('layoutTimeline', () => {
  it('accumulates real durations across plays, gaps, pauses, chimes and clips', () => {
    const value = project();
    const durations: Record<string, number> = { a: 2, b: 1.5 };
    const { entries, durationSeconds } = layoutTimeline(
      sequenceTrack(value),
      value,
      (segment) => durations[segment.id]
    );
    const at = (segmentId: string, play: number) =>
      entries.find((entry) => entry.segmentId === segmentId && entry.play === play)!;
    expect(at('a', 2)).toMatchObject({ start: 8.5, end: 10.5, estimated: false });
    expect(at('c', 1)).toMatchObject({ start: 15, end: 19, type: 'pause' });
    expect(at('d', 1).end - at('d', 1).start).toBeCloseTo(CHIME_SECONDS);
    expect(at('e', 1).end - at('e', 1).start).toBeCloseTo(2.5);
    expect(entries.filter((entry) => entry.type === 'gap').map((entry) => entry.end - entry.start)).toEqual([5, 3]);
    expect(durationSeconds).toBe(entries.at(-1)!.end);
  });

  it('estimates ungenerated speech from its length and rate', () => {
    const value = project();
    const speech = { id: 'x', type: 'speech' as const, text: '一二三四五六七八九十', rate: '+10%' };
    value.sections[0].segments = [speech];
    expect(estimateSpeechSeconds(value, speech)).toBeCloseTo(2);
    const { entries } = layoutTimeline(sequenceTrack(value), value, () => undefined);
    expect(entries[0]).toMatchObject({ start: 0, end: 2, estimated: true });
  });

  it('prefers measured durations for any segment so host renders can pass probed lengths', () => {
    const value = project();
    const { entries } = layoutTimeline(sequenceTrack(value, ['s2']), value, (segment) =>
      segment.id === 'e' ? 2.49 : undefined
    );
    const length = (id: string) => {
      const entry = entries.find((item) => item.segmentId === id)!;
      return entry.end - entry.start;
    };
    expect(length('e')).toBeCloseTo(2.49);
    expect(length('c')).toBe(4);
  });
});
