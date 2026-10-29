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
export type AudioReadiness = { available: boolean; reason?: string };
export type AudioCapabilities = {
  uploadMaxBytes: number;
  tools: AudioReadiness;
  transcription: AudioReadiness & { hasKey: boolean };
  tts: AudioReadiness;
  render: AudioReadiness;
};
export type AudioIssue = { code: string; startSecond: number; endSecond: number; segmentId?: string };
export type AudioReplacementInput = {
  revision: string;
  clipId: string;
  start: number;
  end: number;
  text: string;
  voice: AudioVoice;
};
export type AudioReplacementPreview = {
  beforePath: string;
  afterPath: string;
  originalSeconds: number;
  replacementSeconds: number;
  deltaSeconds: number;
};
export type AudioModel = {
  id: string;
  name: string;
  audioInput: boolean;
  parameters: string[];
  reasoning: string[];
};
export type AudioModelCatalog = { models: AudioModel[]; fetchedAt: number };
export type AudioSegment = { text: string; startSecond: number; endSecond: number };
/** A fresh transcript of one clip's source range; cue times are seconds in the source recording. */
export type ClipTranscriptResult = { path: string; start: number; end: number; text: string; cues: AudioSegment[] };
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
  kind:
    | 'transcription'
    | 'speech'
    | 'track'
    | 'analysis'
    | 'replacement'
    | 'export'
    | 'segments'
    | 'import'
    | 'transcript';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  model?: string;
  voice?: AudioVoice;
  completedChunks: number;
  totalChunks: number;
  durationSeconds?: number;
  summary?: string;
  /** Workspace-relative listening project rendered by a track task, or drafted by an analysis task. */
  projectPath?: string;
  /** Revision of the project snapshot used by this task; previews never count as complete tracks. */
  projectRevision?: string;
  issues?: AudioIssue[];
  preview?: AudioReplacementPreview;
  /** Section ids when a track task rendered only part of the project as a preview. */
  previewSections?: string[];
  /** Workspace-relative recording an `import` task splits into studio blocks. */
  sourcePath?: string;
  /**
   * Clip transcripts produced by a `transcript` task, keyed by segment id. Each records the source range it
   * transcribed, so the editor applies it only while the clip still covers exactly that range.
   */
  transcripts?: Record<string, ClipTranscriptResult>;
  /** Speech lines a `segments` task generates into the shared cache. */
  segmentIds?: string[];
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
