import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspaceFile } from '../providers/media.js';
import type { TrackMedia } from './ffmpeg.js';

export const PEAKS_CACHE = 'listening/.peaks';
export const PEAK_BUCKET_MS = 10;
export const RANGE_MAX_SECONDS = 30;
/** Decoding services the editor previews need; the host's track media in production. */
export type PreviewMedia = Pick<TrackMedia, 'probe' | 'decode'>;

const AUDIO_EXTENSION = /\.(?:mp3|wav|m4a|aac|ogg|flac|webm)$/i;
/** Samples per bucket in the shared 24 kHz PCM format. */
const BUCKET_SAMPLES = (24000 * PEAK_BUCKET_MS) / 1000;
const HEADER_BYTES = 16;

/** Resolve a workspace audio file the editor may preview. */
async function audioSource(workspace: string, sourcePath: string): Promise<string> {
  if (!AUDIO_EXTENSION.test(sourcePath)) throw new Error('AUDIO_FILE_FORBIDDEN');
  return workspaceFile(workspace, sourcePath);
}

/** Decode into a private temporary WAV, hand it to `use`, then remove it. */
async function withDecoded<T>(
  media: PreviewMedia,
  source: string,
  signal: AbortSignal,
  window: { start: number; end: number } | undefined,
  use: (file: string) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'listening-preview-'));
  try {
    const file = path.join(directory, 'decoded.wav');
    await media.decode(source, file, signal, window);
    return await use(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Stream 16-bit mono PCM samples from a WAV file into min/max pairs per bucket, scaled to int8. */
async function computePeaks(file: string, signal: AbortSignal): Promise<Buffer> {
  const pairs: number[] = [];
  let header = Buffer.alloc(0);
  let inData = false;
  let carry: Buffer | undefined;
  let count = 0;
  let low = 0;
  let high = 0;
  const flush = (): void => {
    pairs.push(
      Math.max(-128, Math.min(127, Math.round(low / 256))),
      Math.max(-128, Math.min(127, Math.round(high / 256)))
    );
    count = 0;
    low = 0;
    high = 0;
  };
  for await (const chunk of createReadStream(file, { signal }) as AsyncIterable<Buffer>) {
    let data = chunk;
    if (!inData) {
      header = Buffer.concat([header, chunk]);
      // Walk RIFF chunks after the 12-byte RIFF/WAVE preamble until `data`.
      let offset = 12;
      while (offset + 8 <= header.length && header.toString('latin1', offset, offset + 4) !== 'data')
        offset += 8 + header.readUInt32LE(offset + 4);
      if (offset + 8 > header.length) continue;
      inData = true;
      data = header.subarray(offset + 8);
    }
    if (carry) data = Buffer.concat([carry, data]);
    const usable = data.length - (data.length % 2);
    carry = usable < data.length ? data.subarray(usable) : undefined;
    for (let index = 0; index < usable; index += 2) {
      const sample = data.readInt16LE(index);
      if (count === 0 || sample < low) low = sample;
      if (count === 0 || sample > high) high = sample;
      if (++count === BUCKET_SAMPLES) flush();
    }
  }
  if (count) flush();
  const output = Buffer.alloc(HEADER_BYTES + pairs.length);
  output.write('LPK1', 0, 'latin1');
  output.writeUInt32LE(PEAK_BUCKET_MS, 4);
  output.writeUInt32LE(pairs.length / 2, 8);
  output.writeUInt32LE(0, 12);
  pairs.forEach((value, index) => output.writeInt8(value, HEADER_BYTES + index));
  return output;
}

/**
 * Waveform peaks for a workspace recording, cached by path, size and modification time so a replaced
 * upload is re-analysed. Format: 'LPK1', uint32le bucket ms, uint32le bucket count, uint32le 0, then int8 min/max pairs.
 */
export async function sourcePeaks(
  workspace: string,
  sourcePath: string,
  media: PreviewMedia,
  signal: AbortSignal
): Promise<Buffer> {
  const source = await audioSource(workspace, sourcePath);
  const info = await stat(source);
  const root = await realpath(workspace);
  const directory = path.join(root, ...PEAKS_CACHE.split('/'));
  await mkdir(directory, { recursive: true });
  if ((await realpath(directory)) !== directory) throw new Error('AUDIO_FILE_FORBIDDEN');
  const name = `${createHash('sha256').update(sourcePath).digest('hex').slice(0, 16)}-${info.size}-${Math.floor(info.mtimeMs)}.bin`;
  const cached = path.join(directory, name);
  const existing = await readFile(cached).catch((): undefined => undefined);
  if (existing) return existing;
  const peaks = await withDecoded(media, source, signal, undefined, (file) => computePeaks(file, signal));
  const temporary = `${cached}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, peaks, { flag: 'wx' });
    await rename(temporary, cached);
  } finally {
    await rm(temporary, { force: true });
  }
  return peaks;
}

/** A decoded 24 kHz mono WAV window of a workspace recording, at most 30 seconds long. */
export async function sourceRange(
  workspace: string,
  sourcePath: string,
  start: number,
  end: number,
  media: PreviewMedia,
  signal: AbortSignal
): Promise<Buffer> {
  const source = await audioSource(workspace, sourcePath);
  if (!(start >= 0 && end > start && end - start <= RANGE_MAX_SECONDS)) throw new Error('AUDIO_RANGE_INVALID');
  if (end > (await media.probe(source, signal)) + 0.05) throw new Error('AUDIO_RANGE_INVALID');
  return withDecoded(media, source, signal, { start, end }, (file) => readFile(file));
}
