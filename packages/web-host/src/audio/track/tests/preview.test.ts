import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEAKS_CACHE, sourcePeaks, sourceRange, type PreviewMedia } from '../preview.js';
import { wav } from './wav.js';

describe('listening preview media', () => {
  let workspace: string;
  let media: PreviewMedia & { decode: ReturnType<typeof vi.fn> };
  const signal = new AbortController().signal;
  // One second: 50 buckets of loud square wave, then 50 buckets of silence.
  const samples = Array.from({ length: 24000 }, (_, index) => (index < 12000 ? (index % 2 ? 32767 : -32768) : 0));
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'listening-preview-'));
    await mkdir(path.join(workspace, 'audio'));
    await writeFile(path.join(workspace, 'audio', 'source.mp3'), 'mp3');
    await writeFile(path.join(workspace, 'notes.txt'), 'text');
    media = {
      probe: vi.fn(async () => 60),
      decode: vi.fn(
        async (_source: string, destination: string, _signal: AbortSignal, window?: { start: number; end: number }) =>
          writeFile(
            destination,
            wav(window ? new Array(Math.round((window.end - window.start) * 24000)).fill(5) : samples)
          )
      ),
    };
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('encodes min/max peaks per 10 ms bucket behind a small header', async () => {
    const peaks = await sourcePeaks(workspace, 'audio/source.mp3', media, signal);
    expect(peaks.toString('latin1', 0, 4)).toBe('LPK1');
    expect(peaks.readUInt32LE(4)).toBe(10);
    expect(peaks.readUInt32LE(8)).toBe(100);
    expect(peaks.readUInt32LE(12)).toBe(0);
    expect(peaks.length).toBe(16 + 200);
    expect([peaks.readInt8(16), peaks.readInt8(17)]).toEqual([-128, 127]);
    expect([peaks.readInt8(16 + 198), peaks.readInt8(16 + 199)]).toEqual([0, 0]);
  });

  it('reuses cached peaks until the source size or modification time changes', async () => {
    await sourcePeaks(workspace, 'audio/source.mp3', media, signal);
    await sourcePeaks(workspace, 'audio/source.mp3', media, signal);
    expect(media.decode).toHaveBeenCalledTimes(1);
    expect(await readdir(path.join(workspace, ...PEAKS_CACHE.split('/')))).toHaveLength(1);
    const later = new Date(Date.now() + 60000);
    await utimes(path.join(workspace, 'audio', 'source.mp3'), later, later);
    await sourcePeaks(workspace, 'audio/source.mp3', media, signal);
    expect(media.decode).toHaveBeenCalledTimes(2);
  });

  it('refuses non-audio files and paths outside the workspace', async () => {
    await expect(sourcePeaks(workspace, 'notes.txt', media, signal)).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
    await expect(sourcePeaks(workspace, '../source.mp3', media, signal)).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
    await expect(sourceRange(workspace, 'notes.txt', 0, 1, media, signal)).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
  });

  it('returns a decoded WAV window of at most 30 seconds inside the source', async () => {
    const range = await sourceRange(workspace, 'audio/source.mp3', 10, 12, media, signal);
    expect(range.toString('latin1', 0, 4)).toBe('RIFF');
    expect(media.decode.mock.calls[0][3]).toEqual({ start: 10, end: 12 });
    for (const [start, end] of [
      [0, 31],
      [59, 60.1],
      [5, 5],
      [-1, 2],
    ])
      await expect(sourceRange(workspace, 'audio/source.mp3', start, end, media, signal)).rejects.toThrow(
        'AUDIO_RANGE_INVALID'
      );
    await expect(sourceRange(workspace, 'audio/source.mp3', 59.99, 60.04, media, signal)).resolves.toBeInstanceOf(
      Buffer
    );
  });
});
