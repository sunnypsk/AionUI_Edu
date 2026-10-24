import { describe, expect, it } from 'vitest';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { previewState, ungeneratedIds } from '@/renderer/pages/listening/data/status';
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

describe('working-copy speech cache', () => {
  const saved = (): ListeningState => ({
    path: 'listening/unit.listening.json',
    revision: 'r1',
    project: project(),
    qaThreshold: 0.9,
    tasks: [],
    segments: {
      a: { key: 'ka', cached: true, duration: 2, qa: { heard: '你好', similarity: 1, accepted: true } },
      b: { key: 'kb', cached: true, duration: 1 },
    },
  });

  it('drops cached duration and QA only for a line whose speech changed', () => {
    const state = saved();
    const draft = structuredClone(state.project!);
    const line = draft.sections[0].segments[0];
    if (line.type === 'speech') line.text = '再見';
    const next = previewState(draft, state);
    expect(next.segments.a).toEqual({ key: '', cached: false });
    expect(next.segments.b).toBe(state.segments.b);
  });

  it('invalidates effective prosody changes but retains audio for metadata edits', () => {
    const state = saved();
    const metadata = { ...state.project!, title: 'New title' };
    expect(previewState(metadata, state).segments.a.cached).toBe(true);
    const draft = { ...metadata, defaults: { ...metadata.defaults, rate: '+10%' } };
    expect(previewState(draft, state).segments.a.cached).toBe(false);
  });

  it('invalidates only lines affected by a pronunciation fix', () => {
    const state = saved();
    const draft = { ...state.project!, lexicon: [{ match: '你好', speak: '您好' }] };
    const next = previewState(draft, state);
    expect(next.segments.a.cached).toBe(false);
    expect(next.segments.b.cached).toBe(true);
  });

  it('generates identical missing speech only once, leaving cached lines alone', () => {
    const state = saved();
    const draft = structuredClone(state.project!);
    draft.sections[0].segments.push(
      { id: 'c', type: 'speech', text: '再見' },
      { id: 'd', type: 'speech', text: '再見' }
    );
    expect(ungeneratedIds(draft, previewState(draft, state))).toEqual(['c']);
  });
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

describe('authored timeline blocks', () => {
  it('lays out one first play per section, a repeat summary and the gap after', async () => {
    const { authoredBlocks } = await import('@/renderer/pages/listening/timeline/blocks');
    const value = project();
    // Section 1: a = 2 s, b = 1 s, plays 2 with a 5 s gap; section 2: pause 4, chime, clip 2.5.
    const blocks = authoredBlocks(value, (segment) => ({ a: 2, b: 1 })[segment.id as 'a' | 'b'], 10);
    const summary = blocks.map((block) =>
      block.kind === 'segment'
        ? `${block.segment.id}:${block.x}+${block.width}`
        : `${block.kind}:${block.x}+${block.width}`
    );
    expect(summary).toEqual(['a:0+20', 'b:20+10', 'repeat:30+80', 'gap:110+30', 'c:140+40', 'd:180+8', 'e:188+25']);
  });

  it('maps rendered track time to authored positions and back, folding repeats onto the first play', async () => {
    const { authoredBlocks, timeToAuthored, authoredToTime } =
      await import('@/renderer/pages/listening/timeline/blocks');
    const value = project();
    const lookup = (segment: { id: string }) => ({ a: 2, b: 1 })[segment.id as 'a' | 'b'];
    const blocks = authoredBlocks(value, lookup, 10);
    const { entries } = layoutTimeline(sequenceTrack(value), value, lookup);
    // 0.5 s into the first play of `a`.
    expect(timeToAuthored(0.5, entries, blocks, 10)).toEqual({ x: 5, play: 1, sectionId: 's1' });
    // Second play of `b` starts at 2 + 1 + 5 + 2 = 10 s.
    expect(timeToAuthored(10.5, entries, blocks, 10)).toEqual({ x: 25, play: 2, sectionId: 's1' });
    // During the gap between plays the playhead waits at the section start.
    expect(timeToAuthored(4, entries, blocks, 10)).toEqual({ x: 0, play: 2, sectionId: 's1' });
    expect(authoredToTime(25, entries, blocks, 10)).toBeCloseTo(2.5);
    // Clicking the pause in section 2 seeks into its only play.
    expect(authoredToTime(150, entries, blocks, 10)).toBeCloseTo(at(entries, 'c').start + 1);
  });
});

const at = (entries: { segmentId?: string; play: number; start: number }[], id: string) =>
  entries.find((entry) => entry.segmentId === id && entry.play === 1)!;
