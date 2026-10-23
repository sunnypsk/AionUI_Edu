import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Execute a fixed host-owned helper without a shell, bounding diagnostics and honoring cancellation. */
export async function runProcess(
  command: string,
  args: string[],
  signal: AbortSignal,
  input?: string,
  env = process.env
): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let output = '';
    let diagnostic = '';
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = (): void => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killTimer.unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 2 * 1024 * 1024) child.kill('SIGTERM');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-4096);
    });
    child.stdin.on('error', () => {});
    child.once('error', () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('AUDIO_DEPENDENCY_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort);
      clearTimeout(killTimer);
      if (signal.aborted) reject(new Error('AUDIO_CANCELLED'));
      else if (code !== 0 || output.length > 2 * 1024 * 1024)
        reject(
          new Error(diagnostic.includes('No module named') ? 'AUDIO_DEPENDENCY_UNAVAILABLE' : 'AUDIO_MEDIA_FAILED')
        );
      else resolve(output);
    });
    child.stdin.end(input);
  });
}

/** Resolve only regular files belonging to this conversation, including symlink checks. */
export async function workspaceFile(workspace: string, name: string): Promise<string> {
  if (path.isAbsolute(name) || /^[a-z][\w+.-]*:/i.test(name) || name.split(/[\\/]/).includes('..'))
    throw new Error('AUDIO_FILE_FORBIDDEN');
  const root = await realpath(workspace);
  let file: string;
  try {
    file = await realpath(path.resolve(root, name));
  } catch {
    throw new Error('AUDIO_FILE_NOT_FOUND');
  }
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('AUDIO_FILE_FORBIDDEN');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('AUDIO_FILE_FORBIDDEN');
  } finally {
    await handle.close();
  }
  return file;
}
export type MediaServices = {
  probe: (file: string, signal: AbortSignal) => Promise<number>;
  chunk: (file: string, destination: string, start: number, duration: number, signal: AbortSignal) => Promise<void>;
};
export const media: MediaServices = {
  async probe(file, signal) {
    const result = JSON.parse(
      await runProcess(
        process.env.AIONUI_FFPROBE ?? 'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-select_streams',
          'a:0',
          '-show_entries',
          'format=duration:stream=codec_type',
          '-of',
          'json',
          file,
        ],
        AbortSignal.any([signal, AbortSignal.timeout(30000)])
      )
    ) as { format?: { duration?: string }; streams?: { codec_type: string }[] };
    const duration = Number(result.format?.duration);
    if (!result.streams?.some((stream) => stream.codec_type === 'audio') || !Number.isFinite(duration) || duration <= 0)
      throw new Error('AUDIO_INVALID_FILE');
    return duration;
  },
  async chunk(file, destination, start, duration, signal) {
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
        '-ss',
        String(start),
        '-i',
        file,
        '-t',
        String(duration),
        '-map',
        '0:a:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '48k',
        destination,
      ],
      AbortSignal.any([signal, AbortSignal.timeout(180000)])
    );
    if ((await stat(destination)).size > 5 * 1024 * 1024) throw new Error('AUDIO_CHUNK_TOO_LARGE');
  },
};
