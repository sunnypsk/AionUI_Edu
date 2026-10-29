import { LISTENING_LIMITS } from '../../../desktop/src/common/types/platform/listeningProject.ts';
import { splitText } from '../audio/track/structure.js';

/** Largest pasted or uploaded script accepted for text-to-speech blocks. */
export const MAX_TEXT_BYTES = 600_000;

/**
 * Split a script into speech blocks: paragraphs separated by blank lines, or one block per line when the text
 * has no blank lines. Paragraphs longer than the TTS limit are split at sentence ends.
 */
export function textBlocks(text: string): string[] {
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error('AUDIO_TEXT_TOO_LARGE');
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('AUDIO_TEXT_REQUIRED');
  const paragraphs = /\n[^\S\n]*\n/.test(normalized) ? normalized.split(/\n[^\S\n]*\n+/) : normalized.split('\n');
  const blocks = paragraphs
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .flatMap((paragraph) => (paragraph.length > LISTENING_LIMITS.SPEECH_CHARS ? splitText(paragraph) : [paragraph]));
  if (blocks.length > LISTENING_LIMITS.SEGMENTS) throw new Error('AUDIO_TEXT_TOO_LARGE');
  return blocks;
}
