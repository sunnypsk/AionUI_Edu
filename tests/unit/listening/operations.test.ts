import { describe, expect, it } from 'vitest';
import type { ListeningProject, ListeningSegment } from '@/common/types/platform/listeningProject';
import { listeningProjectSchema } from '@/common/types/platform/listeningProject';
import {
  deleteClipRange,
  insertSegment,
  moveSectionTo,
  moveSegment,
  removeSegments,
  resizePause,
  splitClip,
  trimClip,
} from '@/renderer/pages/listening/editing/operations';
import { HISTORY_LIMIT, record, redo, undo, type History } from '@/renderer/pages/listening/editing/history';
import {
  applyTranscripts,
  editedTranscript,
  findSegments,
  joinCues,
  needsTranscript,
  TRANSCRIPT_STALE,
} from '@/renderer/pages/listening/editing/transcripts';

const clip = (overrides: Partial<Extract<ListeningSegment, { type: 'clip' }>> = {}): ListeningSegment => ({
  id: 'k',
  type: 'clip',
  path: 'audio/source.mp3',
  start: 0,
  end: 10,
  note: '原錄音',
  transcript: { text: '全段', verified: true, source: 'teacher' },
  ...overrides,
});
const project = (segments: ListeningSegment[] = [clip()]): ListeningProject =>
  listeningProjectSchema.parse({
    version: 1,
    title: 'Unit',
    sections: [
      { id: 's1', segments },
      { id: 's2', segments: [{ id: 'q', type: 'pause', seconds: 2 }] },
    ],
  });
const ranges = (value: ListeningProject, section = 0) =>
  value.sections[section].segments.map((segment) =>
    segment.type === 'clip' ? [segment.start, segment.end] : segment.type
  );

describe('clip editing operations', () => {
  it('splits a clip at a source time into two clips with fresh ids, marking an untimed transcript stale', () => {
    const result = splitClip(project([{ id: 'a', type: 'pause', seconds: 1 }, clip()]), 'k', 4);
    expect(ranges(result)).toEqual(['pause', [0, 4], [4, 10]]);
    const [first, second] = result.sections[0].segments.slice(1);
    expect(new Set([first.id, second.id, 'k', 'a', 'q', 's1', 's2']).size).toBe(7);
    expect(first).not.toHaveProperty('transcript');
    expect(first).toMatchObject({ note: '原錄音', path: 'audio/source.mp3', warnings: [TRANSCRIPT_STALE] });
    expect(listeningProjectSchema.safeParse(result).success).toBe(true);
  });

  it('keeps each piece’s own words when the transcript is timed', () => {
    const cues = [
      { text: '早晨。', startSecond: 0.2, endSecond: 2 },
      { text: '今日', startSecond: 3, endSecond: 4.4 },
      { text: '落雨。', startSecond: 4.6, endSecond: 6 },
    ];
    const timed = clip({ transcript: { text: '早晨。今日落雨。', verified: true, source: 'auto', cues } });
    const [first, second] = splitClip(project([timed]), 'k', 4.5).sections[0].segments;
    expect(first).toMatchObject({ transcript: { text: '早晨。今日', cues: cues.slice(0, 2), verified: false } });
    expect(second).toMatchObject({ transcript: { text: '落雨。', cues: cues.slice(2) } });
    expect(second).not.toHaveProperty('warnings');
    // Deleting the middle words leaves the outer ones on each side.
    const [left, right] = deleteClipRange(project([timed]), 'k', 2.5, 4.5).sections[0].segments;
    expect([left, right].map((piece) => piece.type === 'clip' && piece.transcript?.text)).toEqual(['早晨。', '落雨。']);
  });

  it('keeps an untimed transcript through a small edge trim only', () => {
    const [trimmed] = trimClip(project(), 'k', 'end', 9.9, 10).sections[0].segments;
    expect(trimmed).toMatchObject({ end: 9.9, transcript: { text: '全段' } });
    const [cut] = trimClip(project(), 'k', 'end', 6, 10).sections[0].segments;
    expect(cut).not.toHaveProperty('transcript');
    expect(cut).toMatchObject({ warnings: [TRANSCRIPT_STALE] });
  });

  it('ignores a split outside or too close to the clip edges', () => {
    const value = project();
    expect(splitClip(value, 'k', 10)).toBe(value);
    expect(splitClip(value, 'k', 0.02)).toBe(value);
  });

  it('deletes a middle range by keeping the audio on both sides', () => {
    expect(ranges(deleteClipRange(project(), 'k', 3, 5))).toEqual([
      [0, 3],
      [5, 10],
    ]);
  });

  it('removes the clip when the range covers it, keeping the section valid', () => {
    const value = project([clip(), { id: 'b', type: 'pause', seconds: 1 }]);
    expect(ranges(deleteClipRange(value, 'k', 0, 10))).toEqual(['pause']);
    // The only segment of a section cannot be removed (sections need at least one segment).
    const only = project();
    expect(deleteClipRange(only, 'k', 0, 10)).toBe(only);
  });

  it('trims instead of leaving slivers when the range touches an edge', () => {
    expect(ranges(deleteClipRange(project(), 'k', 0, 3))).toEqual([[3, 10]]);
    expect(ranges(deleteClipRange(project(), 'k', 6, 9.98))).toEqual([[0, 6]]);
  });

  it('clamps trims to the source and to a minimum length', () => {
    expect(ranges(trimClip(project(), 'k', 'start', -2, 60))).toEqual([[0, 10]]);
    expect(ranges(trimClip(project(), 'k', 'end', 80, 60))).toEqual([[0, 60]]);
    expect(ranges(trimClip(project(), 'k', 'start', 9.99, 60))).toEqual([[9.95, 10]]);
    expect(ranges(trimClip(project(), 'k', 'end', 0, 60))).toEqual([[0, 0.05]]);
  });

  it('clamps pause lengths to the schema range', () => {
    const value = project([{ id: 'p', type: 'pause', seconds: 3 }]);
    const seconds = (next: ListeningProject) => (next.sections[0].segments[0] as { seconds: number }).seconds;
    expect(seconds(resizePause(value, 'p', 0))).toBe(0.1);
    expect(seconds(resizePause(value, 'p', 900))).toBe(600);
    expect(seconds(resizePause(value, 'p', 4.5))).toBe(4.5);
  });
});

describe('arranging operations', () => {
  it('inserts a segment at an index in a section', () => {
    const result = insertSegment(project(), 's1', 0, { id: 'n', type: 'chime', preset: 'start' });
    expect(ranges(result)).toEqual(['chime', [0, 10]]);
  });

  it('moves a segment into another section at an index', () => {
    const value = project([clip(), { id: 'b', type: 'pause', seconds: 1 }]);
    const result = moveSegment(value, 'k', 's2', 1);
    expect(ranges(result)).toEqual(['pause']);
    expect(result.sections[1].segments.map((segment) => segment.id)).toEqual(['q', 'k']);
  });

  it('reorders within a section, counting the target index after removal', () => {
    const value = project([clip(), { id: 'b', type: 'pause', seconds: 1 }, { id: 'c', type: 'chime', preset: 'end' }]);
    expect(moveSegment(value, 'k', 's1', 2).sections[0].segments.map((segment) => segment.id)).toEqual(['b', 'c', 'k']);
  });

  it('refuses to move the only segment out of a section', () => {
    const value = project();
    expect(moveSegment(value, 'k', 's2', 0)).toBe(value);
  });

  it('removes selected segments but never empties a section', () => {
    const value = project([clip(), { id: 'b', type: 'pause', seconds: 1 }, { id: 'c', type: 'chime', preset: 'end' }]);
    expect(ranges(removeSegments(value, ['k', 'c']))).toEqual(['pause']);
    expect(removeSegments(value, ['k', 'b', 'c'])).toBe(value);
  });

  it('moves a section to a new position', () => {
    expect(moveSectionTo(project(), 's2', 0).sections.map((section) => section.id)).toEqual(['s2', 's1']);
  });
});

describe('undo history', () => {
  it('keeps at most the last 100 states and clears redo on a new edit', () => {
    let history: History<number> = { past: [], present: 0, future: [] };
    for (let value = 1; value <= HISTORY_LIMIT + 1; value++) history = record(history, value);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(1);
    history = undo(undo(history));
    expect(history.present).toBe(HISTORY_LIMIT - 1);
    history = redo(history);
    expect(history.present).toBe(HISTORY_LIMIT);
    history = record(history, -1);
    expect(history.future).toEqual([]);
    expect(redo(history)).toBe(history);
  });

  it('does nothing when there is nothing to undo', () => {
    const history: History<number> = { past: [], present: 3, future: [] };
    expect(undo(history)).toBe(history);
  });
});

describe('clip transcripts', () => {
  type Clip = Extract<ListeningSegment, { type: 'clip' }>;
  const result = { path: 'audio/source.mp3', start: 0, end: 10, text: '新文字', cues: [] };

  it('joins cues without spaces for CJK and with spaces between Latin words', () => {
    expect(
      joinCues([
        { text: '早晨', startSecond: 0, endSecond: 1 },
        { text: '。好', startSecond: 1, endSecond: 2 },
      ])
    ).toBe('早晨。好');
    expect(
      joinCues([
        { text: 'Good', startSecond: 0, endSecond: 1 },
        { text: 'morning', startSecond: 1, endSecond: 2 },
      ])
    ).toBe('Good morning');
  });

  it('applies a fresh transcript only while the clip covers the transcribed range', () => {
    const stale = clip({ transcript: undefined, warnings: [TRANSCRIPT_STALE, 'AUDIO_NO_SPEECH'] });
    const applied = applyTranscripts(project([stale]), { k: result });
    expect(applied.sections[0].segments[0]).toMatchObject({
      transcript: { text: '新文字', source: 'auto', verified: false },
      warnings: ['AUDIO_NO_SPEECH'],
    });
    // Applying the same result again, or to a clip that was trimmed since, changes nothing.
    expect(applyTranscripts(applied, { k: result })).toBe(applied);
    const moved = project([clip({ end: 8 })]);
    expect(applyTranscripts(moved, { k: result })).toBe(moved);
  });

  it('treats typed text as the user’s transcript and finds it by search', () => {
    const edited = editedTranscript(
      clip({ warnings: [TRANSCRIPT_STALE], transcript: undefined }) as Clip,
      '請到禮堂集合'
    );
    expect(edited).toMatchObject({ transcript: { text: '請到禮堂集合', source: 'teacher', verified: false } });
    expect(edited).not.toHaveProperty('warnings');
    expect(needsTranscript(edited)).toBe(false);
    expect(needsTranscript(clip({ transcript: { text: ' ', verified: false, source: 'auto' } }) as Clip)).toBe(true);
    const value = project([{ id: 'line', type: 'speech', text: 'Ｈello 禮堂' }, edited]);
    expect(findSegments(value, '禮堂').map((match) => match.segmentId)).toEqual(['line', 'k']);
    expect(findSegments(value, 'HELLO').map((match) => match.segmentId)).toEqual(['line']);
    expect(findSegments(value, '  ')).toEqual([]);
  });
});
