import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import {
  QUICK_SPEECH_FORMATS,
  QUICK_SPEECH_MAX_CHARS,
  type QuickSpeechFormat,
} from '../../../desktop/src/common/types/platform/audioStudio.ts';
import { AUDIO_VOICES, HERTZ_OFFSET, PERCENT_OFFSET } from '../../../desktop/src/common/types/platform/audioTools.ts';
import type { SpeechOptions } from '../audio/providers/edge.js';
import { runProcess } from '../audio/providers/media.js';
import type { AudioSegment } from '../audio/types.js';

export type QuickSpeechServices = {
  speak: (options: SpeechOptions) => Promise<{ segments: AudioSegment[] }>;
  toWav: (source: string, destination: string, signal: AbortSignal) => Promise<void>;
};

const settings = z
  .object({
    text: z.string(),
    voice: z.enum(AUDIO_VOICES).default('HiuMaan'),
    rate: z.string().regex(PERCENT_OFFSET).default('+0%'),
    volume: z.string().regex(PERCENT_OFFSET).default('+0%'),
    pitch: z.string().regex(HERTZ_OFFSET).default('+0Hz'),
    format: z.enum(QUICK_SPEECH_FORMATS).default('mp3'),
  })
  .strict();
const CONTENT_TYPES: Record<QuickSpeechFormat, string> = { mp3: 'audio/mpeg', wav: 'audio/wav' };
/** Users with a synthesis in flight; each may run one at a time so a held-down button cannot queue many. */
const busy = new Set<string>();

/** Decode Edge TTS MP3 output to 16-bit mono PCM WAV at the synthesis sample rate. */
export async function toWav(source: string, destination: string, signal: AbortSignal): Promise<void> {
  await runProcess(
    process.env.AIONUI_FFMPEG ?? 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-n',
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      source,
      '-map',
      '0:a:0',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'pcm_s16le',
      destination,
    ],
    AbortSignal.any([signal, AbortSignal.timeout(120000)])
  );
}

/**
 * Synthesize short text in a private scratch folder and stream the audio back as a download.
 * Nothing is kept on the host; the folder is removed whether the request succeeds, fails or is abandoned.
 */
export async function sendQuickSpeech(
  res: ServerResponse,
  body: unknown,
  options: { userId: string; workRoot: string; services: QuickSpeechServices }
): Promise<void> {
  const input = settings.parse(body);
  const text = input.text.trim();
  if (!text) throw new Error('AUDIO_TEXT_REQUIRED');
  if ([...text].length > QUICK_SPEECH_MAX_CHARS) throw new Error('AUDIO_TEXT_TOO_LARGE');
  if (busy.has(options.userId)) throw new Error('AUDIO_LIMIT');
  busy.add(options.userId);
  const abort = new AbortController();
  const abandoned = (): void => {
    if (!res.writableFinished) abort.abort();
  };
  res.once('close', abandoned);
  const directory = path.join(options.workRoot, randomUUID());
  try {
    await mkdir(options.workRoot, { recursive: true, mode: 0o700 });
    await mkdir(directory, { mode: 0o700 });
    const mp3 = path.join(directory, 'speech.mp3');
    await options.services.speak({
      action: 'start',
      wait_sec: 0,
      subtitles: false,
      boundary: 'SentenceBoundary',
      text,
      voice: input.voice,
      rate: input.rate,
      volume: input.volume,
      pitch: input.pitch,
      output: mp3,
      directory,
      signal: abort.signal,
    });
    let file = mp3;
    if (input.format === 'wav') {
      file = path.join(directory, 'speech.wav');
      await options.services.toWav(mp3, file, abort.signal);
    }
    abort.signal.throwIfAborted();
    const handle = await open(file, 'r');
    try {
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[input.format],
        'content-length': (await handle.stat()).size,
        'content-disposition': `attachment; filename="speech.${input.format}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      await pipeline(handle.createReadStream({ autoClose: false }), res);
    } finally {
      await handle.close().catch(() => {});
    }
  } finally {
    res.off('close', abandoned);
    busy.delete(options.userId);
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
