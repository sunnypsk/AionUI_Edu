/** Keeping clip transcripts truthful while clips are split, trimmed and re-transcribed. */
import type { AudioSegment, ClipTranscriptResult } from '@/common/types/platform/audioTools';
import type { ListeningProject, ListeningSegment } from '@/common/types/platform/listeningProject';

type Clip = Extract<ListeningSegment, { type: 'clip' }>;
type Transcript = NonNullable<Clip['transcript']>;

/** Warning on a clip whose range changed after transcription, so its old text no longer describes it. */
export const TRANSCRIPT_STALE = 'AUDIO_TRANSCRIPT_STALE';
/** Edge moves up to this many seconds keep a transcript without timings; such trims rarely cut words. */
export const EDGE_TOLERANCE_SECONDS = 0.25;
const SAME_RANGE = 1e-6;

const wordChar = /[\p{L}\p{N}]/u;
const latin = /[A-Za-z0-9]/;

/** Join cue texts; Latin words get a space between them, CJK text does not. */
export function joinCues(cues: AudioSegment[]): string {
  return cues.reduce((text, cue) => {
    const next = cue.text.trim();
    if (!text) return next;
    const gap = latin.test(text.at(-1) ?? '') && latin.test(next[0] ?? '') && wordChar.test(next[0] ?? '');
    return `${text}${gap ? ' ' : ''}${next}`;
  }, '');
}

/**
 * Transcript fields for a piece `[start, end)` cut from `clip`. Timed transcripts keep the cues whose midpoint
 * falls inside the piece; untimed ones survive only small edge trims and otherwise become stale.
 */
export function pieceTranscript(clip: Clip, start: number, end: number): Pick<Clip, 'transcript' | 'warnings'> {
  const transcript = clip.transcript;
  if (!transcript) return {};
  const whole =
    Math.abs(start - clip.start) <= EDGE_TOLERANCE_SECONDS && Math.abs(end - clip.end) <= EDGE_TOLERANCE_SECONDS;
  if (transcript.cues?.length) {
    const cues = transcript.cues.filter((cue) => {
      const middle = (cue.startSecond + cue.endSecond) / 2;
      return middle >= start && middle < end;
    });
    if (whole && cues.length === transcript.cues.length) return { transcript };
    return { transcript: { text: joinCues(cues), cues, source: 'auto', verified: false } };
  }
  if (whole) return { transcript };
  return { warnings: [TRANSCRIPT_STALE] };
}

/** Words a reader sees for a segment: speech text, a clip's transcript, and any note. */
export function segmentText(segment: ListeningSegment): string {
  if (segment.type === 'speech') return segment.text;
  if (segment.type === 'clip') return [segment.transcript?.text, segment.note].filter(Boolean).join(' ');
  if (segment.type === 'pause') return segment.note ?? '';
  return '';
}

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

/** Segments whose text contains `query` (case- and width-insensitive), in project order. */
export function findSegments(project: ListeningProject, query: string): { sectionId: string; segmentId: string }[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  return project.sections.flatMap((section) =>
    section.segments
      .filter((segment) => normalize(segmentText(segment)).includes(needle))
      .map((segment) => ({ sectionId: section.id, segmentId: segment.id }))
  );
}

/** True when a clip has no usable transcript: never transcribed, empty, or stale after an edit. */
export function needsTranscript(clip: Clip): boolean {
  return !clip.transcript?.text.trim() || !!clip.warnings?.includes(TRANSCRIPT_STALE);
}

/** Text typed by the user replaces the automatic transcript; its cues no longer match, so they are dropped. */
export function editedTranscript(clip: Clip, text: string): Clip {
  const { warnings, ...rest } = clip;
  const kept = warnings?.filter((code) => code !== TRANSCRIPT_STALE);
  const transcript: Transcript = { text, source: 'teacher', verified: clip.transcript?.verified ?? false };
  return { ...rest, transcript, ...(kept?.length ? { warnings: kept } : {}) };
}

/**
 * Apply fresh transcripts to clips that still cover exactly the transcribed range. Returns the same project
 * when nothing changes, so applying an old result again does not mark the draft dirty.
 */
export function applyTranscripts(
  project: ListeningProject,
  results: Record<string, ClipTranscriptResult>
): ListeningProject {
  let changed = false;
  const sections = project.sections.map((section) => {
    let touched = false;
    const segments = section.segments.map((segment) => {
      const result = segment.type === 'clip' ? results[segment.id] : undefined;
      if (
        segment.type !== 'clip' ||
        !result ||
        result.path !== segment.path ||
        Math.abs(result.start - segment.start) > SAME_RANGE ||
        Math.abs(result.end - segment.end) > SAME_RANGE
      )
        return segment;
      const { warnings, ...rest } = segment;
      const kept = warnings?.filter((code) => code !== TRANSCRIPT_STALE);
      const next: Clip = {
        ...rest,
        transcript: {
          text: result.text,
          source: 'auto',
          verified: false,
          ...(result.cues.length ? { cues: result.cues } : {}),
        },
        ...(kept?.length ? { warnings: kept } : {}),
      };
      if (JSON.stringify(next) === JSON.stringify(segment)) return segment;
      touched = true;
      return next;
    });
    if (!touched) return section;
    changed = true;
    return { ...section, segments };
  });
  return changed ? { ...project, sections } : project;
}
