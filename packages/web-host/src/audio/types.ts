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
  AudioTaskView,
  AudioVoice,
} from '../../../desktop/src/common/types/platform/audioTools.js';
import type {
  AudioTask,
  AudioTaskView,
  AudioReplacementInput,
} from '../../../desktop/src/common/types/platform/audioTools.js';
import { AUDIO_VOICES, HERTZ_OFFSET, PERCENT_OFFSET } from '../../../desktop/src/common/types/platform/audioTools.ts';

export const ownerId = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export type AudioOwner = { userId: string; conversationId: string; workspace: string };
export type StoredAudioTask = AudioTask & {
  owner: AudioOwner;
  epoch: number;
  replacementInput?: AudioReplacementInput;
};
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
      voice: z.enum(AUDIO_VOICES).default('HiuMaan'),
      rate: z.string().regex(PERCENT_OFFSET).default('+0%'),
      volume: z.string().regex(PERCENT_OFFSET).default('+0%'),
      pitch: z.string().regex(HERTZ_OFFSET).default('+0Hz'),
      subtitles: z.boolean().default(false),
      boundary: z.enum(['SentenceBoundary', 'WordBoundary']).default('SentenceBoundary'),
    })
    .strict(),
  render_listening_track: z
    .object({
      ...common,
      project_path: z.string().min(1).max(4096).optional(),
      verify: z.boolean().default(true),
      only_sections: z
        .array(z.string().regex(/^[\w-]{1,64}$/))
        .max(100)
        .optional(),
    })
    .strict(),
  analyze_reference_audio: z
    .object({
      ...common,
      audio_path: z.string().min(1).max(4096).optional(),
      mode: z.enum(['speech', 'clip']).optional(),
      transcribe: z.boolean().default(true),
      title: z.string().trim().min(1).max(200).optional(),
      noise_db: z.number().min(-80).max(-10).default(-35),
      merge_gap: z.number().min(0.2).max(10).default(1),
      section_gap: z.number().min(1).max(60).default(3),
      language: z.string().min(1).max(100).default('yue-Hant-HK'),
      instructions: z.string().max(8000).optional(),
    })
    .strict(),
};
export const TOOL_KINDS = {
  transcribe_audio: 'transcription',
  synthesize_speech: 'speech',
  render_listening_track: 'track',
  analyze_reference_audio: 'analysis',
} as const satisfies Record<keyof typeof toolSchemas, AudioTask['kind']>;
export type AudioToolName = keyof typeof toolSchemas;
export type TranscribeInput = z.infer<typeof toolSchemas.transcribe_audio>;
export type SpeechInput = z.infer<typeof toolSchemas.synthesize_speech>;
export type TrackInput = z.infer<typeof toolSchemas.render_listening_track>;
export type AnalysisInput = z.infer<typeof toolSchemas.analyze_reference_audio>;
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
  const { owner: _owner, epoch: _epoch, replacementInput: _replacementInput, ...value } = task;
  return structuredClone(value);
}
/** Agent-facing task view: usage and cost stay host-side so they never reach teachers through chat. */
export function agentTask(task: AudioTask): AudioTaskView {
  const { usage: _usage, costUsd: _costUsd, ...value } = task;
  return { ...value, warnings: value.warnings.filter((warning) => warning !== 'AUDIO_COST_INCOMPLETE') };
}
