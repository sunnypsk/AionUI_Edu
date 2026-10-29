/** Browser-safe track ordering and timing shared by the host render, the timeline editor and preview playback. */
import type { ListeningProject, ListeningSegment, ListeningTimelineEntry } from './listeningProject.ts';

/** Rough Cantonese TTS pace at +0% rate, used to size lines that have not been generated yet. */
export const SPEECH_SECONDS_PER_CHAR = 0.22;
/** Length of the host chime: two 0.35 s beeps, the second starting at 0.45 s. */
export const CHIME_SECONDS = 0.8;

export type SequenceItem =
  | { kind: 'segment'; sectionId: string; play: number; segment: ListeningSegment }
  | { kind: 'gap'; sectionId: string; play: number; seconds: number; reason: 'between' | 'after' };

/** Seconds for one segment, when known (a generated line, or a probed piece during a render). */
export type DurationLookup = (segment: ListeningSegment) => number | undefined;

export type LaidOutEntry = ListeningTimelineEntry & { estimated: boolean };

/** Flatten sections into playback order: repeated plays, gaps between plays, and gaps between sections. */
export function sequenceTrack(project: ListeningProject, onlySections?: string[]): SequenceItem[] {
  // Empty sections (a new studio project, or one emptied while editing) contribute no audio and no gaps.
  const sections = (
    onlySections?.length ? project.sections.filter((section) => onlySections.includes(section.id)) : project.sections
  ).filter((section) => section.segments.length);
  const items: SequenceItem[] = [];
  sections.forEach((section, index) => {
    for (let play = 1; play <= section.plays; play++) {
      if (play > 1 && section.gapBetweenPlays > 0)
        items.push({ kind: 'gap', sectionId: section.id, play, seconds: section.gapBetweenPlays, reason: 'between' });
      for (const segment of section.segments) items.push({ kind: 'segment', sectionId: section.id, play, segment });
    }
    if (index < sections.length - 1 && section.gapAfter > 0)
      items.push({
        kind: 'gap',
        sectionId: section.id,
        play: section.plays,
        seconds: section.gapAfter,
        reason: 'after',
      });
  });
  return items;
}

/** Estimated length of an ungenerated line from its character count and effective rate. */
export function estimateSpeechSeconds(
  project: ListeningProject,
  segment: Extract<ListeningSegment, { type: 'speech' }>
): number {
  const rate = Number.parseInt(segment.rate ?? project.defaults.rate, 10) || 0;
  return ([...segment.text].length * SPEECH_SECONDS_PER_CHAR) / (1 + rate / 100);
}

function fallbackSeconds(project: ListeningProject, segment: ListeningSegment): number {
  if (segment.type === 'speech') return estimateSpeechSeconds(project, segment);
  if (segment.type === 'pause') return segment.seconds;
  if (segment.type === 'chime') return CHIME_SECONDS;
  return segment.end - segment.start;
}

const round = (value: number): number => Number(value.toFixed(3));

/** Start and end of every sequenced item, using measured durations where known. */
export function layoutTimeline(
  sequence: SequenceItem[],
  project: ListeningProject,
  duration: DurationLookup
): { durationSeconds: number; entries: LaidOutEntry[] } {
  const entries: LaidOutEntry[] = [];
  let offset = 0;
  for (const item of sequence) {
    let length: number;
    let estimated = false;
    if (item.kind === 'gap') length = item.seconds;
    else {
      const measured = duration(item.segment);
      estimated = measured === undefined && item.segment.type === 'speech';
      length = measured ?? fallbackSeconds(project, item.segment);
    }
    entries.push({
      sectionId: item.sectionId,
      ...(item.kind === 'segment' ? { segmentId: item.segment.id } : {}),
      type: item.kind === 'gap' ? 'gap' : item.segment.type,
      play: item.play,
      start: round(offset),
      end: round(offset + length),
      estimated,
    });
    offset += length;
  }
  return { durationSeconds: round(offset), entries };
}
