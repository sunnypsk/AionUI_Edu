import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../providers/media.js';

const python = process.platform === 'win32' ? 'python' : 'python3';
const available = spawnSync(python, ['--version'], { windowsHide: true }).status === 0;
describe('Edge helper process boundary', () => {
  it.runIf(available)('preserves UTF-8 Cantonese even when Python stdin uses a legacy encoding', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'audio-edge-'));
    try {
      await writeFile(
        path.join(directory, 'edge_tts.py'),
        [
          'class Communicate:',
          '    def __init__(self, text, voice, **kwargs): self.text = text',
          '    async def stream(self):',
          '        yield {"type": "audio", "data": b"ID3" + b"x" * 2000}',
          '        yield {"type": "SentenceBoundary", "offset": 0, "duration": 10000000, "text": self.text}',
        ].join('\n')
      );
      const text = '記得帶水同雨褸。';
      const metadata = path.join(directory, 'boundaries.json');
      await runProcess(
        python,
        [fileURLToPath(new URL('../providers/edgeWorker.py', import.meta.url))],
        AbortSignal.timeout(10000),
        JSON.stringify({
          text,
          voice: 'zh-HK-HiuMaanNeural',
          rate: '+0%',
          volume: '+0%',
          pitch: '+0Hz',
          boundary: 'SentenceBoundary',
          output: path.join(directory, 'speech.mp3'),
          metadata,
        }),
        { ...process.env, PYTHONPATH: directory, PYTHONIOENCODING: 'ascii' }
      );
      expect(JSON.parse(await readFile(metadata, 'utf8'))).toEqual([{ text, startSecond: 0, endSecond: 1 }]);
      expect((await readFile(path.join(directory, 'speech.mp3'))).length).toBe(2003);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('reports a missing dependency without exposing raw command errors', async () => {
    await expect(runProcess('aionui-audio-nonexistent-command', [], new AbortController().signal)).rejects.toThrow(
      'AUDIO_DEPENDENCY_UNAVAILABLE'
    );
  });
  it('cancels and reaps a running helper process', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'audio-cancel-'));
    try {
      const pidFile = path.join(directory, 'pid');
      const controller = new AbortController();
      const work = runProcess(
        process.execPath,
        [
          '-e',
          'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
          pidFile,
        ],
        controller.signal
      );
      const outcome = expect(work).rejects.toThrow('AUDIO_CANCELLED');
      let pid: number | undefined;
      for (let attempt = 0; attempt < 100 && !pid; attempt++) {
        pid = await readFile(pidFile, 'utf8')
          .then(Number)
          .catch(() => undefined);
        if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(pid).toBeGreaterThan(0);
      controller.abort();
      await outcome;
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
