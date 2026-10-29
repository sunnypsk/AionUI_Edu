import { getBaseUrl, httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import type { AudioCapabilities, AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';

/** A project file in a conversation workspace, or a standalone studio project (whose file path is fixed). */
export type ListeningTarget = { conversation_id: string; path: string } | { project_id: string };
/** Stable identity of a target, for caches and effects that must reset when the project changes. */
export const targetKey = (target: ListeningTarget): string =>
  'project_id' in target ? `studio\0${target.project_id}` : `${target.conversation_id}\0${target.path}`;
/** Host audio error: a machine code plus optional field-level validation messages. */
export type ListeningError = { code: string; details: string[] };
/** A source-audio range to replace with synthesized speech; times are seconds in the original file. */
export type ReplacementRequest = { clipId: string; start: number; end: number; text: string; voice: AudioVoice };
/** A background task started by the host, plus the state that already lists it. */
export type ListeningTaskStart = { taskId: string; state: ListeningState };

const ROOT = '/api/edu/audio/listening';
const SENSITIVE = { sensitive: true };

/** Teacher-side listening editor API. Script text is classroom content, so request bodies are not logged. */
export const listeningApi = {
  load: (target: ListeningTarget): Promise<ListeningState> =>
    httpRequest('GET', `${ROOT}?${new URLSearchParams(target).toString()}`, undefined, { sensitive: true }),
  save: (target: ListeningTarget, project: ListeningProject, revision: string): Promise<ListeningState> =>
    httpRequest('PUT', ROOT, { ...target, project, revision }, { sensitive: true }),
  render: (target: ListeningTarget, onlySections?: string[]): Promise<ListeningState> =>
    httpRequest(
      'POST',
      `${ROOT}/render`,
      { ...target, ...(onlySections ? { only_sections: onlySections } : {}) },
      {
        sensitive: true,
      }
    ),
  cancel: (target: ListeningTarget, taskId: string): Promise<ListeningState> =>
    httpRequest('POST', `${ROOT}/cancel`, { ...target, task_id: taskId }, { sensitive: true }),
  acceptQa: (target: ListeningTarget, segmentId: string, accepted: boolean): Promise<ListeningState> =>
    httpRequest('POST', `${ROOT}/qa`, { ...target, segment_id: segmentId, accepted }, { sensitive: true }),
  previewReplacement: (
    target: ListeningTarget,
    revision: string,
    request: ReplacementRequest
  ): Promise<ListeningTaskStart> =>
    httpRequest('POST', `${ROOT}/replacements/preview`, { ...target, revision, ...request }, SENSITIVE),
  applyReplacement: (target: ListeningTarget, revision: string, previewId: string): Promise<ListeningState> =>
    httpRequest('POST', `${ROOT}/replacements/apply`, { ...target, revision, previewId }, SENSITIVE),
  bundle: (target: ListeningTarget, revision: string): Promise<ListeningTaskStart> =>
    httpRequest('POST', `${ROOT}/bundle`, { ...target, revision }, SENSITIVE),
  /** Start generating the given speech lines into the cache, against the saved revision. */
  generate: (target: ListeningTarget, revision: string, segmentIds: string[]): Promise<ListeningTaskStart> =>
    httpRequest('POST', `${ROOT}/segments/generate`, { ...target, revision, segment_ids: segmentIds }, SENSITIVE),
  /** Binary waveform peaks of a workspace recording (GET, cookie-authenticated). */
  peaksUrl: (target: ListeningTarget, source: string): string =>
    `${getBaseUrl()}${ROOT}/peaks?${new URLSearchParams({ ...target, source }).toString()}`,
  /** A decoded WAV window of at most 30 seconds of a workspace recording. */
  rangeUrl: (target: ListeningTarget, source: string, start: number, end: number): string =>
    `${getBaseUrl()}${ROOT}/range?${new URLSearchParams({ ...target, source, start: String(start), end: String(end) }).toString()}`,
  /** Readiness of TTS, transcription and rendering; agent tool readiness only when a conversation is given. */
  capabilities: (conversationId?: string): Promise<AudioCapabilities> =>
    httpRequest(
      'GET',
      conversationId
        ? `/api/edu/audio/capabilities?${new URLSearchParams({ conversation_id: conversationId }).toString()}`
        : '/api/edu/audio/capabilities',
      undefined,
      SENSITIVE
    ),
};

/** Extract `{ error: { code, details } }` from a failed host response. */
export function listeningError(error: unknown): ListeningError {
  if (isBackendHttpError(error) && error.body && typeof error.body === 'object') {
    const inner = (error.body as { error?: { code?: unknown; details?: unknown } }).error;
    if (inner && typeof inner.code === 'string')
      return {
        code: inner.code,
        details: Array.isArray(inner.details) ? inner.details.filter((item) => typeof item === 'string') : [],
      };
  }
  return { code: 'AUDIO_FAILED', details: [] };
}
