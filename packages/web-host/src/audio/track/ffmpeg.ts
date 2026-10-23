import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { media, runProcess } from '../providers/media.js';

/** Every intermediate piece shares one PCM format so the concat demuxer joins them sample-accurately. */
const PCM = ['-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le'];
const HEAD = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n'];
const ffmpeg = (args: string[], signal: AbortSignal, timeout = 180000): Promise<string> =>
  runProcess(
    process.env.AIONUI_FFMPEG ?? 'ffmpeg',
    [...HEAD, ...args],
    AbortSignal.any([signal, AbortSignal.timeout(timeout)])
  );

/** One faded sine beep delayed by `offset` ms; fades avoid clicks at the edges. */
const beep = (frequency: number, offset: number): string =>
  `sine=frequency=${frequency}:sample_rate=24000:duration=0.35,afade=t=in:d=0.02,afade=t=out:st=0.25:d=0.1,volume=0.4,adelay=${offset}`;

/**
 * Silent intervals in seconds, from FFmpeg's silencedetect metadata printed on stdout. A trailing silence
 * that runs to the end of the file has no end marker and is closed at `duration`.
 */
export async function detectSilences(
  file: string,
  options: { noiseDb: number; minSeconds: number; duration: number },
  signal: AbortSignal
): Promise<{ start: number; end: number }[]> {
  const output = await ffmpeg(
    [
      '-protocol_whitelist',
      'file,pipe',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-af',
      `aformat=channel_layouts=mono,silencedetect=noise=${options.noiseDb}dB:d=${options.minSeconds},ametadata=mode=print:file=-`,
      '-f',
      'null',
      '-',
    ],
    signal,
    600000
  );
  const silences: { start: number; end: number }[] = [];
  let open: number | undefined;
  for (const match of output.matchAll(/lavfi\.silence_(start|end)=(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)) {
    const value = Math.min(options.duration, Math.max(0, Number(match[2])));
    if (match[1] === 'start') open = value;
    else if (open !== undefined) {
      if (value > open) silences.push({ start: open, end: value });
      open = undefined;
    }
  }
  if (open !== undefined && options.duration > open) silences.push({ start: open, end: options.duration });
  return silences;
}

export type TrackMedia = {
  probe: (file: string, signal: AbortSignal) => Promise<number>;
  silence: (destination: string, seconds: number, signal: AbortSignal) => Promise<void>;
  tone: (destination: string, preset: 'start' | 'end', signal: AbortSignal) => Promise<void>;
  /** Decode a whole file, or the `[start, end)` window of it, into the shared PCM format. */
  decode: (
    source: string,
    destination: string,
    signal: AbortSignal,
    window?: { start: number; end: number }
  ) => Promise<void>;
  /** Concatenate PCM pieces, normalize loudness and encode the final MP3. */
  assemble: (pieces: string[], destination: string, signal: AbortSignal) => Promise<void>;
};

export const trackMedia: TrackMedia = {
  probe: media.probe,
  async silence(destination, seconds, signal) {
    await ffmpeg(
      ['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', seconds.toFixed(3), ...PCM, destination],
      signal
    );
  },
  async tone(destination, preset, signal) {
    // Two short rising (start) or falling (end) beeps.
    const [first, second] = preset === 'start' ? [660, 880] : [880, 660];
    await ffmpeg(
      [
        '-f',
        'lavfi',
        '-i',
        beep(first, 0),
        '-f',
        'lavfi',
        '-i',
        beep(second, 450),
        '-filter_complex',
        '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0',
        ...PCM,
        destination,
      ],
      signal
    );
  },
  async decode(source, destination, signal, window) {
    await ffmpeg(
      [
        '-protocol_whitelist',
        'file,pipe',
        ...(window ? ['-ss', String(window.start), '-t', String(window.end - window.start)] : []),
        '-i',
        source,
        '-map',
        '0:a:0',
        '-vn',
        ...PCM,
        destination,
      ],
      signal
    );
  },
  async assemble(pieces, destination, signal) {
    const list = path.join(path.dirname(destination), 'pieces.txt');
    // Paths are host-generated inside the private work directory; quote them for the concat demuxer anyway.
    await writeFile(list, pieces.map((piece) => `file '${piece.replaceAll("'", "'\\''")}'`).join('\n') + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await ffmpeg(
      [
        '-protocol_whitelist',
        'file,pipe',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
        destination,
      ],
      signal,
      1200000
    );
  },
};
