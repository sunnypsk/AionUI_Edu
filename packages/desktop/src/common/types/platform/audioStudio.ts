/** Browser-safe contracts for standalone audio studio projects, shared by the web host and the renderer. */
import type { AudioSegment, AudioVoice } from './audioTools.ts';

/** Longest text, in characters, accepted by the studio's quick text-to-speech. */
export const QUICK_SPEECH_MAX_CHARS = 1000;
export const QUICK_SPEECH_FORMATS = ['mp3', 'wav'] as const;
export type QuickSpeechFormat = (typeof QUICK_SPEECH_FORMATS)[number];
/** Quick text-to-speech request: Edge TTS prosody offsets as in listening projects. */
export type QuickSpeechInput = {
  text: string;
  voice: AudioVoice;
  rate: string;
  volume: string;
  pitch: string;
  format: QuickSpeechFormat;
};

/** One studio project; `workspace` is its absolute host folder, used as the chat workspace for "Open in chat". */
export type StudioProject = {
  id: string;
  title: string;
  workspace: string;
  /** Workspace-relative project file opened by the listening editor. */
  projectPath: string;
  segments: number;
  createdAt: number;
  updatedAt: number;
};

/** An imported recording; duration and block counts appear once its import task has split it. */
export type StudioMedia = {
  path: string;
  name: string;
  bytes: number;
  addedAt: number;
  durationSeconds?: number;
  blocks?: number;
  transcribed?: boolean;
};

/** One editing block of a recording, in source seconds; `text` is the automatic transcript when available. */
export type StudioMediaBlock = {
  start: number;
  end: number;
  text?: string;
  /** Timed pieces of `text`, in source seconds. */
  cues?: AudioSegment[];
  warnings?: string[];
};

/** A recording split at silences into contiguous blocks that cover every source sample. */
export type StudioMediaBlocks = {
  version: 1;
  path: string;
  durationSeconds: number;
  blocks: StudioMediaBlock[];
  warnings: string[];
};

/** Upload result: the stored recording and the background import task splitting it into blocks. */
export type StudioUpload = { media: StudioMedia; taskId: string };
