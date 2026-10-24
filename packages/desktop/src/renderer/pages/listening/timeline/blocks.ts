/** Authored-order timeline geometry: each segment once, plus a summary of repeated plays. */
import type { ListeningProject, ListeningSegment, ListeningState } from '@/common/types/platform/listeningProject';
import {
  CHIME_SECONDS,
  estimateSpeechSeconds,
  type DurationLookup,
  type LaidOutEntry,
} from '@/common/types/platform/listeningTimeline';

export type TimelineBlock =
  | { kind: 'segment'; sectionId: string; segment: ListeningSegment; x: number; width: number; estimated: boolean }
  /** Plays 2..N of a section and the gaps before them, drawn as one translucent block. */
  | { kind: 'repeat'; sectionId: string; plays: number; gap: number; x: number; width: number }
  /** The silence after a section, before the next one. */
  | { kind: 'gap'; sectionId: string; x: number; width: number };

function seconds(project: ListeningProject, segment: ListeningSegment, duration: DurationLookup): [number, boolean] {
  const measured = duration(segment);
  if (measured !== undefined) return [measured, false];
  if (segment.type === 'speech') return [estimateSpeechSeconds(project, segment), true];
  if (segment.type === 'pause') return [segment.seconds, false];
  if (segment.type === 'chime') return [CHIME_SECONDS, false];
  return [segment.end - segment.start, false];
}

export function authoredBlocks(project: ListeningProject, duration: DurationLookup, pxPerSec: number): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let x = 0;
  project.sections.forEach((section, index) => {
    let firstPlay = 0;
    for (const segment of section.segments) {
      const [length, estimated] = seconds(project, segment, duration);
      blocks.push({ kind: 'segment', sectionId: section.id, segment, x, width: length * pxPerSec, estimated });
      x += length * pxPerSec;
      firstPlay += length;
    }
    if (section.plays > 1) {
      const width = (section.plays - 1) * (section.gapBetweenPlays + firstPlay) * pxPerSec;
      blocks.push({
        kind: 'repeat',
        sectionId: section.id,
        plays: section.plays,
        gap: section.gapBetweenPlays,
        x,
        width,
      });
      x += width;
    }
    if (index < project.sections.length - 1 && section.gapAfter > 0) {
      blocks.push({ kind: 'gap', sectionId: section.id, x, width: section.gapAfter * pxPerSec });
      x += section.gapAfter * pxPerSec;
    }
  });
  return blocks;
}

/** A gap entry is the after-section gap when it is the last entry of its section. */
const isAfterGap = (entries: LaidOutEntry[], index: number): boolean =>
  entries[index].type === 'gap' && entries[index + 1]?.sectionId !== entries[index].sectionId;

/** Where the playhead sits for a rendered track time: repeats fold back onto the first play. */
export function timeToAuthored(
  time: number,
  entries: LaidOutEntry[],
  blocks: TimelineBlock[],
  pxPerSec: number
): { x: number; play: number; sectionId: string } | undefined {
  if (!entries.length) return undefined;
  let index = entries.findIndex((entry) => time >= entry.start && time < entry.end);
  if (index < 0) index = time < entries[0].start ? 0 : entries.length - 1;
  const entry = entries[index];
  const offset = Math.max(0, Math.min(time, entry.end) - entry.start) * pxPerSec;
  const result = (x: number) => ({ x, play: entry.play, sectionId: entry.sectionId });
  if (entry.type === 'gap') {
    if (isAfterGap(entries, index)) {
      const gap = blocks.find((block) => block.kind === 'gap' && block.sectionId === entry.sectionId);
      return result(gap ? gap.x + Math.min(offset, gap.width) : 0);
    }
    const first = blocks.find((block) => block.sectionId === entry.sectionId);
    return result(first?.x ?? 0);
  }
  const block = blocks.find((item) => item.kind === 'segment' && item.segment.id === entry.segmentId);
  return result(block ? block.x + Math.min(offset, block.width) : 0);
}

/** The rendered track time for a click at authored position `x`. */
export function authoredToTime(x: number, entries: LaidOutEntry[], blocks: TimelineBlock[], pxPerSec: number): number {
  const block = blocks.find((item) => x >= item.x && x < item.x + item.width) ?? blocks[blocks.length - 1];
  if (!block) return 0;
  const offset = (x - block.x) / pxPerSec;
  let entry: LaidOutEntry | undefined;
  if (block.kind === 'segment') entry = entries.find((item) => item.segmentId === block.segment.id && item.play === 1);
  else if (block.kind === 'repeat')
    entry = entries.find((item) => item.sectionId === block.sectionId && item.play === 2);
  else entry = entries.find((item, index) => item.sectionId === block.sectionId && isAfterGap(entries, index));
  return entry ? entry.start + offset : 0;
}

/** Generated line lengths from the editor state; everything else uses its own length or an estimate. */
export const stateDurations =
  (state: ListeningState): DurationLookup =>
  (segment) =>
    segment.type === 'speech' ? state.segments[segment.id]?.duration : undefined;
