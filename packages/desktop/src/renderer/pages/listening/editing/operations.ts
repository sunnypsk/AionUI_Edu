/** Pure timeline edits on a listening project. Times are seconds in the clip's source recording. */
import type { ListeningProject, ListeningSection, ListeningSegment } from '@/common/types/platform/listeningProject';
import { newId } from '@/renderer/pages/listening/editing/draft';
import { pieceTranscript } from '@/renderer/pages/listening/editing/transcripts';

type Clip = Extract<ListeningSegment, { type: 'clip' }>;

/** Shorter pieces are dropped rather than kept as near-silent slivers. */
export const MIN_CLIP_SECONDS = 0.05;
const PAUSE_RANGE = { MIN: 0.1, MAX: 600 } as const;

const ms = (value: number): number => Math.round(value * 1000) / 1000;

function locate(project: ListeningProject, segmentId: string): { section: number; index: number } | undefined {
  for (let section = 0; section < project.sections.length; section++) {
    const index = project.sections[section].segments.findIndex((segment) => segment.id === segmentId);
    if (index >= 0) return { section, index };
  }
  return undefined;
}

function withSection(
  project: ListeningProject,
  position: number,
  change: (section: ListeningSection) => ListeningSection
): ListeningProject {
  return {
    ...project,
    sections: project.sections.map((section, index) => (index === position ? change(section) : section)),
  };
}

/**
 * Replace one clip with `pieces` (source ranges). Each piece keeps the transcript words of its own range when
 * the transcript is timed; otherwise it is marked stale rather than showing text it may no longer contain.
 */
function replaceClip(
  project: ListeningProject,
  clipId: string,
  pieces: { start: number; end: number }[],
  freshIds: boolean
): ListeningProject {
  const found = locate(project, clipId);
  const segment = found && project.sections[found.section].segments[found.index];
  if (!found || segment?.type !== 'clip') return project;
  const kept = pieces.filter((piece) => piece.end - piece.start >= MIN_CLIP_SECONDS - 1e-9);
  if (!kept.length && project.sections[found.section].segments.length === 1) return project;
  const { transcript: _transcript, warnings: _warnings, ...base } = segment;
  let next = project;
  const replacements: Clip[] = kept.map((piece) => {
    const id = freshIds || kept.length > 1 ? newId(next, 'clip') : segment.id;
    const created: Clip = {
      ...base,
      id,
      start: ms(piece.start),
      end: ms(piece.end),
      ...pieceTranscript(segment, piece.start, piece.end),
    };
    // Reserve the id so the next piece cannot draw the same one.
    next = withSection(next, found.section, (section) => ({ ...section, segments: [...section.segments, created] }));
    return created;
  });
  return withSection(project, found.section, (section) => ({
    ...section,
    segments: [...section.segments.slice(0, found.index), ...replacements, ...section.segments.slice(found.index + 1)],
  }));
}

function clipOf(project: ListeningProject, clipId: string): Clip | undefined {
  const found = locate(project, clipId);
  const segment = found && project.sections[found.section].segments[found.index];
  return segment?.type === 'clip' ? segment : undefined;
}

/** Split a clip at a source time; a cut within MIN_CLIP_SECONDS of an edge is ignored. */
export function splitClip(project: ListeningProject, clipId: string, at: number): ListeningProject {
  const clip = clipOf(project, clipId);
  if (!clip || at - clip.start < MIN_CLIP_SECONDS || clip.end - at < MIN_CLIP_SECONDS) return project;
  return replaceClip(
    project,
    clipId,
    [
      { start: clip.start, end: at },
      { start: at, end: clip.end },
    ],
    true
  );
}

/** Remove `[start, end)` from a clip, keeping the audio on either side. */
export function deleteClipRange(
  project: ListeningProject,
  clipId: string,
  start: number,
  end: number
): ListeningProject {
  const clip = clipOf(project, clipId);
  if (!clip) return project;
  const from = Math.max(clip.start, Math.min(start, end));
  const to = Math.min(clip.end, Math.max(start, end));
  if (to <= from) return project;
  return replaceClip(
    project,
    clipId,
    [
      { start: clip.start, end: from },
      { start: to, end: clip.end },
    ],
    false
  );
}

/** Move one edge of a clip, clamped to the source and to MIN_CLIP_SECONDS. */
export function trimClip(
  project: ListeningProject,
  clipId: string,
  edge: 'start' | 'end',
  value: number,
  sourceDuration: number
): ListeningProject {
  const clip = clipOf(project, clipId);
  if (!clip) return project;
  const range =
    edge === 'start'
      ? { start: Math.min(Math.max(0, value), clip.end - MIN_CLIP_SECONDS), end: clip.end }
      : { start: clip.start, end: Math.max(Math.min(sourceDuration, value), clip.start + MIN_CLIP_SECONDS) };
  return replaceClip(project, clipId, [range], false);
}

export function resizePause(project: ListeningProject, pauseId: string, seconds: number): ListeningProject {
  const found = locate(project, pauseId);
  if (!found || project.sections[found.section].segments[found.index].type !== 'pause') return project;
  const value = ms(Math.min(PAUSE_RANGE.MAX, Math.max(PAUSE_RANGE.MIN, seconds)));
  return withSection(project, found.section, (section) => ({
    ...section,
    segments: section.segments.map((segment) =>
      segment.id === pauseId && segment.type === 'pause' ? { ...segment, seconds: value } : segment
    ),
  }));
}

export function insertSegment(
  project: ListeningProject,
  sectionId: string,
  index: number,
  segment: ListeningSegment
): ListeningProject {
  const position = project.sections.findIndex((section) => section.id === sectionId);
  if (position < 0) return project;
  return withSection(project, position, (section) => {
    const at = Math.max(0, Math.min(index, section.segments.length));
    return { ...section, segments: [...section.segments.slice(0, at), segment, ...section.segments.slice(at)] };
  });
}

/** Move a segment to `toIndex` of a section; the index counts positions after the segment is taken out. */
export function moveSegment(
  project: ListeningProject,
  segmentId: string,
  toSectionId: string,
  toIndex: number
): ListeningProject {
  const found = locate(project, segmentId);
  if (!found || !project.sections.some((section) => section.id === toSectionId)) return project;
  const from = project.sections[found.section];
  if (from.id !== toSectionId && from.segments.length === 1) return project;
  const segment = from.segments[found.index];
  const removed = withSection(project, found.section, (section) => ({
    ...section,
    segments: section.segments.filter((item) => item.id !== segmentId),
  }));
  return insertSegment(removed, toSectionId, toIndex, segment);
}

export function moveSectionTo(project: ListeningProject, sectionId: string, toIndex: number): ListeningProject {
  const section = project.sections.find((item) => item.id === sectionId);
  if (!section) return project;
  const rest = project.sections.filter((item) => item.id !== sectionId);
  const at = Math.max(0, Math.min(toIndex, rest.length));
  return { ...project, sections: [...rest.slice(0, at), section, ...rest.slice(at)] };
}

/** Remove segments by id; a removal that would leave a section empty is refused as a whole. */
export function removeSegments(project: ListeningProject, segmentIds: string[]): ListeningProject {
  const remove = new Set(segmentIds);
  if (project.sections.some((section) => section.segments.every((segment) => remove.has(segment.id)))) return project;
  return {
    ...project,
    sections: project.sections.map((section) => ({
      ...section,
      segments: section.segments.filter((segment) => !remove.has(segment.id)),
    })),
  };
}
