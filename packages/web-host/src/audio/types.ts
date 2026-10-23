import { z } from 'zod';
export { DEFAULT_TRANSCRIPTION_MODEL } from '../../../desktop/src/common/types/platform/audioTools.ts';
export type {
  AudioFormat,
  AudioSettings,
  AudioSettingsInput,
  AudioModel,
  AudioModelCatalog,
  AudioSegment,
  AudioUsage,
  AudioTask,
} from '../../../desktop/src/common/types/platform/audioTools.js';
import type { AudioTask } from '../../../desktop/src/common/types/platform/audioTools.js';

export const ownerId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export type AudioOwner = { userId: string; conversationId: string; workspace: string };
export type StoredAudioTask = AudioTask & { owner: AudioOwner; epoch: number };
const common = {
  action: z.enum(['start', 'status', 'wait', 'cancel']).default('start'),
  task_id: z.string().uuid().optional(),
  wait_sec: z.number().int().min(0).max(50).default(50),
};
export const toolSchemas = {
  transcribe_audio: z
    .object({
      ...common,
      audio_path: z.string().min(1).max(4096).optional(),
      format: z.enum(['srt', 'txt', 'vtt', 'json']).default('srt'),
      language: z.string().min(1).max(100).default('yue-Hant-HK'),
      instructions: z.string().max(8000).optional(),
    })
    .strict(),
  synthesize_speech: z
    .object({
      ...common,
      text: z.string().min(1).max(200000).optional(),
      text_path: z.string().min(1).max(4096).optional(),
      voice: z.enum(['HiuMaan', 'WanLung']).default('HiuMaan'),
      rate: z
        .string()
        .regex(/^[+-]\d{1,3}%$/)
        .default('+0%'),
      volume: z
        .string()
        .regex(/^[+-]\d{1,3}%$/)
        .default('+0%'),
      pitch: z
        .string()
        .regex(/^[+-]\d{1,4}Hz$/)
        .default('+0Hz'),
      subtitles: z.boolean().default(false),
      boundary: z.enum(['SentenceBoundary', 'WordBoundary']).default('SentenceBoundary'),
    })
    .strict(),
};
export type AudioToolName = keyof typeof toolSchemas;
export type TranscribeInput = z.infer<typeof toolSchemas.transcribe_audio>;
export type SpeechInput = z.infer<typeof toolSchemas.synthesize_speech>;
export const settingsSchema = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[\w.-]+\/[\w./:-]+$/),
    apiKey: z.string().trim().min(1).max(4096).optional(),
    clearApiKey: z.boolean().optional(),
  })
  .strict();
export const active = (task: AudioTask): boolean => task.status === 'queued' || task.status === 'running';
/** Never expose raw provider errors, command arguments, or credentials to a tool consumer. */
export const audioError = (error: unknown): string =>
  error instanceof Error && /^(?:AUDIO_[A-Z_]+|UNAUTHORIZED|CSRF_INVALID|INVALID_REQUEST)$/.test(error.message)
    ? error.message
    : 'AUDIO_FAILED';
export function publicTask(task: StoredAudioTask): AudioTask {
  const { owner: _owner, epoch: _epoch, ...value } = task;
  return structuredClone(value);
}
