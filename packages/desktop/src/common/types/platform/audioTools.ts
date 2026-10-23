/** Browser-safe contracts for host-owned audio tools. */
export const DEFAULT_TRANSCRIPTION_MODEL = 'google/gemini-3.8-flash';
export const AUDIO_VOICES = ['HiuMaan', 'WanLung'] as const;
export type AudioVoice = (typeof AUDIO_VOICES)[number];
/** Edge TTS prosody offsets: signed percentages for rate/volume, signed Hz for pitch. */
export const PERCENT_OFFSET = /^[+-]\d{1,3}%$/;
export const HERTZ_OFFSET = /^[+-]\d{1,4}Hz$/;
export type AudioFormat = 'srt' | 'txt' | 'vtt' | 'json';
export type AudioSettings = { model: string; hasApiKey: boolean };
export type AudioSettingsInput = { model: string; apiKey?: string; clearApiKey?: boolean };
export type AudioModel = {
  id: string;
  name: string;
  audioInput: boolean;
  parameters: string[];
  reasoning: string[];
};
export type AudioModelCatalog = { models: AudioModel[]; fetchedAt: number };
export type AudioSegment = { text: string; startSecond: number; endSecond: number };
export type AudioUsage = {
  chunk: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  generationId?: string;
};
/** Task as shown to agents and teachers: usage and cost stay host-side. */
export type AudioTaskView = Omit<AudioTask, 'usage' | 'costUsd'>;
export type AudioTask = {
  id: string;
  kind: 'transcription' | 'speech' | 'track';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  model?: string;
  voice?: AudioVoice;
  completedChunks: number;
  totalChunks: number;
  durationSeconds?: number;
  summary?: string;
  /** Workspace-relative listening project rendered by a track task. */
  projectPath?: string;
  /** Section ids when a track task rendered only part of the project as a preview. */
  previewSections?: string[];
  /** `user` when the teacher started the task from the editor rather than the agent. */
  initiator?: 'user';
  files: { path: string; format: string }[];
  usage: AudioUsage[];
  costUsd?: number;
  /** Listening track segments whose re-transcription differs from the script. */
  qaIssues?: number;
  warnings: string[];
  error?: string;
  /** Field-level reasons when a listening project is rejected during rendering. */
  errorDetails?: string[];
};
