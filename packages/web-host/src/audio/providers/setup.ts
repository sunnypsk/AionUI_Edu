import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { audioPython, audioResource } from './edge.js';
import { runProcess } from './media.js';

/** Install pinned dependencies into the project-managed venv during local development only. */
export async function ensureAudioTools(): Promise<void> {
  if (process.env.AIONUI_CONTAINER === '1' || process.env.NODE_ENV === 'production' || process.env.AIONUI_AUDIO_PYTHON)
    return;
  const requirements = audioResource('requirements.txt');
  const hash = createHash('sha256')
    .update(await readFile(requirements))
    .digest('hex');
  const python = audioPython();
  const directory = path.dirname(path.dirname(python));
  const marker = path.join(directory, '.requirements-sha256');
  if ((await readFile(marker, 'utf8').catch(() => '')) === hash) return;
  await mkdir(path.dirname(directory), { recursive: true });
  try {
    await access(python);
  } catch {
    await runProcess('python3', ['-m', 'venv', directory], AbortSignal.timeout(120000));
  }
  await runProcess(
    python,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements],
    AbortSignal.timeout(300000)
  );
  await runProcess(python, ['-c', 'import edge_tts'], AbortSignal.timeout(10000));
  await writeFile(marker, hash);
}
