import { httpRequest, isBackendHttpError } from '@/common/adapter/httpBridge';
import type { AudioCapabilities, AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';

export type ListeningTarget = { conversation_id: string; path: string };
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
  capabilities: (conversationId: string): Promise<AudioCapabilities> =>
    httpRequest(
      'GET',
      `/api/edu/audio/capabilities?${new URLSearchParams({ conversation_id: conversationId }).toString()}`,
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
