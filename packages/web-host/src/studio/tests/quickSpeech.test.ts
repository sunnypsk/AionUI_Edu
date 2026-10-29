import http from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechOptions } from '../../audio/providers/edge.js';
import { sendQuickSpeech, type QuickSpeechServices } from '../quickSpeech.js';

describe('quick speech', () => {
  let directory: string;
  let server: http.Server;
  let url: string;
  let services: QuickSpeechServices;
  let requests: Promise<void>[];
  let release: (() => void) | undefined;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'quick-speech-'));
    requests = [];
    release = undefined;
    services = {
      speak: vi.fn(async (options: SpeechOptions) => {
        if (options.text === 'slow') await new Promise<void>((resolve) => (release = resolve));
        if (options.text === 'broken') throw new Error('AUDIO_MEDIA_FAILED');
        await writeFile(options.output, `mp3:${options.text}`);
        return { segments: [] };
      }),
      toWav: vi.fn(async (source: string, destination: string) => {
        await writeFile(destination, `wav:${path.basename(source)}`);
      }),
    };
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const user = req.headers['x-user'] as string;
        requests.push(
          sendQuickSpeech(res, JSON.parse(Buffer.concat(chunks).toString()), {
            userId: user,
            workRoot: path.join(directory, 'quick'),
            services,
          }).catch((error: Error) => {
            if (!res.headersSent) res.writeHead(409, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { code: error.name === 'ZodError' ? 'INVALID_REQUEST' : error.message } }));
          })
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    release?.();
    server.closeAllConnections();
    await Promise.allSettled(requests);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  const post = (body: unknown, user = 'alice') =>
    fetch(url, { method: 'POST', headers: { 'x-user': user }, body: JSON.stringify(body) });
  /** Cleanup runs after the last byte is sent, so the client may finish reading first. */
  const expectNoScratch = () =>
    vi.waitFor(async () => expect(await readdir(path.join(directory, 'quick')).catch((): string[] => [])).toEqual([]));

  it('streams MP3 with the chosen voice settings and keeps nothing on disk', async () => {
    const response = await post({ text: '  你好  ', voice: 'WanLung', rate: '-10%', volume: '+5%', pitch: '-2Hz' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="speech.mp3"');
    expect(await response.text()).toBe('mp3:你好');
    expect(services.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: '你好', voice: 'WanLung', rate: '-10%', volume: '+5%', pitch: '-2Hz' })
    );
    expect(services.toWav).not.toHaveBeenCalled();
    await expectNoScratch();
  });

  it('converts to WAV on request', async () => {
    const response = await post({ text: '你好', format: 'wav' });
    expect(response.headers.get('content-type')).toBe('audio/wav');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="speech.wav"');
    expect(await response.text()).toBe('wav:speech.mp3');
    await expectNoScratch();
  });

  it('rejects empty, too long and malformed requests before synthesizing', async () => {
    const code = async (body: unknown) => ((await (await post(body)).json()) as { error: { code: string } }).error.code;
    expect(await code({ text: ' \n ' })).toBe('AUDIO_TEXT_REQUIRED');
    expect(await code({ text: '字'.repeat(1001) })).toBe('AUDIO_TEXT_TOO_LARGE');
    expect(await code({ text: '你好', voice: 'Someone' })).toBe('INVALID_REQUEST');
    expect(await code({ text: '你好', rate: 'fast' })).toBe('INVALID_REQUEST');
    expect(await code({ text: '你好', format: 'ogg' })).toBe('INVALID_REQUEST');
    expect(services.speak).not.toHaveBeenCalled();
    expect((await post({ text: '字'.repeat(1000) })).status).toBe(200);
  });

  it('allows one synthesis per user at a time and cleans up after failures', async () => {
    const slow = post({ text: 'slow' });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = (await (await post({ text: '你好' })).json()) as { error: { code: string } };
    expect(second.error.code).toBe('AUDIO_LIMIT');
    expect((await post({ text: '你好' }, 'bob')).status).toBe(200);
    release!();
    expect(await (await slow).text()).toBe('mp3:slow');
    // The client can finish reading before the handler releases its per-user lock.
    await Promise.all(requests);
    const broken = (await (await post({ text: 'broken' })).json()) as { error: { code: string } };
    expect(broken.error.code).toBe('AUDIO_MEDIA_FAILED');
    expect((await post({ text: '你好' })).status).toBe(200);
    await expectNoScratch();
  });
});
