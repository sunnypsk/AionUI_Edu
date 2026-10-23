/** Browser-safe contracts for host-owned audio tools. */
export const DEFAULT_TRANSCRIPTION_MODEL = 'google/gemini-3.8-flash';
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
export type AudioTask = {
  id: string;
  kind: 'transcription' | 'speech';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  model?: string;
  voice?: 'HiuMaan' | 'WanLung';
  completedChunks: number;
  totalChunks: number;
  durationSeconds?: number;
  summary?: string;
  files: { path: string; format: string }[];
  usage: AudioUsage[];
  costUsd?: number;
  warnings: string[];
  error?: string;
};
