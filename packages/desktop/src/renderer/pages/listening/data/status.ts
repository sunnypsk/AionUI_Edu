import type { AudioCapabilities, AudioTaskView } from '@/common/types/platform/audioTools';
import type {
  ListeningProject,
  ListeningSection,
  ListeningSegment,
  ListeningSegmentState,
  ListeningState,
} from '@/common/types/platform/listeningProject';

type Clip = Extract<ListeningSegment, { type: 'clip' }>;
export type ClipTranscript = NonNullable<Clip['transcript']>;

export const isActive = (task: AudioTaskView): boolean => task.status === 'queued' || task.status === 'running';

/** Map a host error code to an i18n key; unknown codes fall back to a generic message. */
export const ERROR_KEYS: Record<string, string> = {
  AUDIO_LIMIT: 'messages.listening.errors.limit',
  AUDIO_PROJECT_INVALID: 'messages.listening.errors.invalid',
  AUDIO_FILE_NOT_FOUND: 'messages.listening.errors.fileNotFound',
  AUDIO_DEPENDENCY_UNAVAILABLE: 'messages.listening.errors.dependency',
  AUDIO_MEDIA_FAILED: 'messages.listening.errors.media',
  AUDIO_TRACK_TOO_LONG: 'messages.listening.errors.tooLong',
  AUDIO_HOST_RESTARTED: 'messages.listening.errors.restarted',
  AUDIO_MODEL_UNSUPPORTED: 'messages.listening.errors.model',
  AUDIO_KEY_REQUIRED: 'messages.listening.errors.keyRequired',
  AUDIO_UNAVAILABLE: 'messages.listening.errors.unavailable',
  AUDIO_CONTENT_FILTERED: 'messages.listening.errors.contentFiltered',
  AUDIO_OUTPUT_TRUNCATED: 'messages.listening.errors.truncated',
  AUDIO_PROJECT_CONFLICT: 'messages.listening.errors.conflict',
  AUDIO_PROJECT_NOT_FOUND: 'messages.studio.errors.projectNotFound',
  AUDIO_MEDIA_IN_USE: 'messages.studio.errors.mediaInUse',
  AUDIO_FORMAT_UNSUPPORTED: 'messages.studio.errors.formatUnsupported',
  AUDIO_FILE_TOO_LARGE: 'messages.studio.errors.fileTooLarge',
  AUDIO_FILE_EMPTY: 'messages.studio.errors.fileEmpty',
  AUDIO_UPLOAD_FAILED: 'messages.studio.errors.uploadFailed',
  AUDIO_TEXT_REQUIRED: 'messages.studio.errors.textRequired',
  AUDIO_TEXT_TOO_LARGE: 'messages.studio.errors.textTooLarge',
};
export const errorKey = (code?: string): string => (code && ERROR_KEYS[code]) || 'messages.listening.errors.generic';

/** Analysis warnings shown on clips; unknown codes still surface as a generic "check this" note. */
const WARNING_KEYS: Record<string, string> = {
  AUDIO_APPROXIMATE_TIMESTAMPS: 'messages.listening.warnings.approximate',
  AUDIO_ANALYSIS_TRANSCRIPT_INCOMPLETE: 'messages.listening.warnings.incomplete',
  AUDIO_CONTENT_FILTERED: 'messages.listening.warnings.contentFiltered',
  AUDIO_TRANSCRIPT_STALE: 'messages.listening.warnings.transcriptStale',
};
export const warningKey = (code: string): string => WARNING_KEYS[code] ?? 'messages.listening.warnings.generic';

/** Newest task of a kind; the host lists tasks newest first. */
export const latestTask = (tasks: AudioTaskView[], kind: AudioTaskView['kind']): AudioTaskView | undefined =>
  tasks.find((task) => task.kind === kind);

type Speech = Extract<ListeningSegment, { type: 'speech' }>;

/** Browser-side identity of the spoken content, matching the host's effective speech request. */
function speechIdentity(project: ListeningProject, segment: Speech): string {
  let text = segment.text.trim();
  for (const entry of project.lexicon.toSorted((a, b) => b.match.length - a.match.length)) {
    if (entry.match) text = text.replaceAll(entry.match, entry.speak);
  }
  return JSON.stringify([
    segment.voice ?? project.defaults.voice,
    segment.rate ?? project.defaults.rate,
    segment.volume ?? project.defaults.volume,
    segment.pitch ?? project.defaults.pitch,
    text,
  ]);
}

/** Invalidate stale speech audio and QA as soon as the working copy changes, before autosave. */
export function previewState(project: ListeningProject, state: ListeningState): ListeningState {
  if (!state.project || project === state.project) return state;
  const saved = new Map(
    state.project.sections.flatMap((section) => section.segments).map((segment) => [segment.id, segment])
  );
  const segments = { ...state.segments };
  for (const segment of project.sections.flatMap((section) => section.segments)) {
    if (segment.type !== 'speech') continue;
    const previous = saved.get(segment.id);
    if (previous?.type !== 'speech' || speechIdentity(project, segment) !== speechIdentity(state.project, previous))
      segments[segment.id] = { key: '', cached: false };
  }
  return { ...state, segments };
}

/** Missing speech, de-duplicated by synthesis key so identical lines are generated only once. */
export function ungeneratedIds(project: ListeningProject, state: ListeningState): string[] {
  const keys = new Set<string>();
  return project.sections
    .flatMap((section) => section.segments)
    .flatMap((segment) => {
      if (segment.type !== 'speech' || state.segments[segment.id]?.cached || !segment.text.trim()) return [];
      const key = speechIdentity(project, segment);
      if (keys.has(key)) return [];
      keys.add(key);
      return [segment.id];
    });
}

/** Current generation state per line; old revisions and successfully cached lines never show failures. */
export function generationStatus(state: ListeningState): Map<string, 'running' | 'failed'> {
  const status = new Map<string, 'running' | 'failed'>();
  const tasks = state.tasks
    .filter((task) => task.kind === 'segments' && task.projectRevision === state.revision)
    .toSorted((a, b) => a.createdAt - b.createdAt);
  for (const task of tasks) {
    for (const id of task.segmentIds ?? []) {
      if (state.segments[id]?.cached || state.segments[id]?.key === '') continue;
      if (isActive(task)) status.set(id, 'running');
      else if (task.status === 'failed') status.set(id, 'failed');
      else status.delete(id);
    }
  }
  return status;
}

/**
 * The full-length track for exactly what is saved now. Section previews, older revisions and any
 * unsaved edits never count, so a stale MP3 is never offered as the finished result.
 */
export function currentTrack(state: ListeningState, dirty: boolean): AudioTaskView | undefined {
  if (dirty) return undefined;
  return state.tasks.find(
    (task) =>
      task.kind === 'track' &&
      task.status === 'completed' &&
      !task.previewSections?.length &&
      !!task.projectRevision &&
      task.projectRevision === state.revision
  );
}

export const trackFile = (task?: AudioTaskView): string | undefined =>
  task?.files.find((file) => file.path.endsWith('.mp3'))?.path;

/** The analysis transcript of a clip, from the project or (for older drafts) the editor state. */
export const clipTranscript = (segment: Clip, state?: ListeningSegmentState): ClipTranscript | undefined =>
  segment.transcript ?? state?.transcript;

export const clipWarnings = (segment: Clip, state?: ListeningSegmentState): string[] =>
  segment.warnings ?? state?.warnings ?? [];

export type ProjectSummary = {
  /** Clips that play the original recording untouched. */
  sourceClips: number;
  /** Clips whose automatic transcript nobody has confirmed, or which have no transcript at all. */
  unverified: number;
  verified: number;
  /** Synthesized lines that stand in for a range of the original recording. */
  replacements: number;
  warnings: number;
};

export function summarize(project: ListeningProject, state: ListeningState): ProjectSummary {
  const summary: ProjectSummary = { sourceClips: 0, unverified: 0, verified: 0, replacements: 0, warnings: 0 };
  for (const segment of project.sections.flatMap((section) => section.segments)) {
    if (segment.type === 'speech' && segment.replaces) summary.replacements++;
    if (segment.type !== 'clip') continue;
    const segmentState = state.segments[segment.id];
    summary.sourceClips++;
    if (clipTranscript(segment, segmentState)?.verified) summary.verified++;
    else summary.unverified++;
    if (clipWarnings(segment, segmentState).length) summary.warnings++;
  }
  return summary;
}

/** Span of the original recording used by a section's clips, or undefined when it has none. */
export function sectionRange(section: ListeningSection): { start: number; end: number } | undefined {
  const clips = section.segments.filter((segment): segment is Clip => segment.type === 'clip');
  if (!clips.length) return undefined;
  return { start: Math.min(...clips.map((clip) => clip.start)), end: Math.max(...clips.map((clip) => clip.end)) };
}

/** Clips in a section still awaiting a teacher's confirmation. */
export const sectionUnverified = (section: ListeningSection, state: ListeningState): number =>
  section.segments.filter(
    (segment) => segment.type === 'clip' && !clipTranscript(segment, state.segments[segment.id])?.verified
  ).length;

/** Format seconds as `m:ss.s` (or `h:mm:ss.s`) so teachers can place cuts to a tenth of a second. */
export function formatTimestamp(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Round to hundredths of a second, avoiding float drift from repeated nudges. */
export const roundTime = (seconds: number): number => Math.round(seconds * 100) / 100;

const ready = (value: unknown): boolean =>
  !!value && typeof value === 'object' && typeof (value as { available?: unknown }).available === 'boolean';

/** Accept a capabilities report only when complete; an older host or a failed request shows no banner. */
export function readCapabilities(value: unknown): AudioCapabilities | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const report = value as Partial<AudioCapabilities>;
  return ready(report.tools) && ready(report.transcription) && ready(report.tts) && ready(report.render)
    ? (report as AudioCapabilities)
    : undefined;
}
