import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { link, open, rm, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { StudioUpload } from '../../../desktop/src/common/types/platform/audioStudio.ts';
import type { AudioManager } from '../audio/manager.js';
import { workspaceFile } from '../audio/providers/media.js';
import { editProject, readProjectState } from '../audio/track/editor.js';
import { audioError } from '../audio/types.js';
import {
  blocksPath,
  safeMediaName,
  STUDIO_AUDIO,
  STUDIO_MEDIA_DIR,
  STUDIO_PROJECT_FILE,
  type StudioProjects,
} from './projects.js';
import { sendQuickSpeech, toWav } from './quickSpeech.js';
import { textBlocks } from './text.js';

export const STUDIO_ROOT = '/api/edu/audio/studio';
/** The only studio route that accepts a raw binary body instead of JSON. */
export const isStudioUpload = (req: IncomingMessage, url: URL): boolean =>
  req.method === 'POST' && /^\/api\/edu\/audio\/studio\/projects\/[\w-]+\/media$/.test(url.pathname);

export type StudioContext = {
  projects: StudioProjects;
  manager: AudioManager;
  userId: string;
  maxUploadBytes: () => Promise<number>;
  readJson: () => Promise<Record<string, unknown>>;
  send: (status: number, value: unknown) => void;
};

const DEFAULT_LANGUAGE = 'yue-Hant-HK';
const title = z.string().trim().min(1).max(200);
const mediaPath = z
  .string()
  .max(4096)
  .refine((value) => value.startsWith(`${STUDIO_MEDIA_DIR}/`) && !value.slice(6).includes('/'), 'not a media file');
const TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
  '.json': 'application/json',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

/**
 * Studio API for one authenticated user: project library, media import, text blocks, file streaming and
 * project-free quick text-to-speech.
 */
export async function handleStudio(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: StudioContext
): Promise<void> {
  const { projects, userId, send } = context;
  if (url.pathname === `${STUDIO_ROOT}/speech` && req.method === 'POST')
    return sendQuickSpeech(res, await context.readJson(), {
      userId,
      workRoot: path.resolve(context.manager.dataDir, 'audio/quick'),
      services: { speak: (options) => context.manager.speak(options), toWav },
    });
  const match =
    /^\/api\/edu\/audio\/studio\/projects(?:\/([\w-]+)(\/media(?:\/import|\/blocks)?|\/text|\/file)?)?$/.exec(
      url.pathname
    );
  if (!match) throw new Error('INVALID_REQUEST');
  const [, id, action = ''] = match;
  if (!id) {
    if (req.method === 'GET') return send(200, { data: await projects.list(userId) });
    if (req.method === 'POST') {
      const input = z.object({ title }).parse(await context.readJson());
      return send(200, { data: await projects.create(userId, input.title) });
    }
    throw new Error('INVALID_REQUEST');
  }
  const owner = await projects.owner(userId, id);
  const workspace = owner.workspace;
  if (action === '' && req.method === 'PATCH') {
    const input = z.object({ title }).parse(await context.readJson());
    const { revision } = await readProjectState(workspace, STUDIO_PROJECT_FILE);
    await editProject(workspace, STUDIO_PROJECT_FILE, revision, (project) => ({ ...project, title: input.title }));
    return send(200, { data: (await projects.list(userId)).find((project) => project.id === id) });
  }
  if (action === '' && req.method === 'DELETE') {
    await projects.remove(userId, id);
    return send(200, { data: { ok: true } });
  }
  if (action === '/media' && req.method === 'GET') return send(200, { data: await projects.media(userId, id) });
  if (action === '/media' && req.method === 'POST') {
    const name = safeMediaName(z.string().min(1).max(255).parse(url.searchParams.get('name')));
    if (!STUDIO_AUDIO.test(name)) throw new Error('AUDIO_FORMAT_UNSUPPORTED');
    const relative = await receiveUpload(req, workspace, name, await context.maxUploadBytes());
    const media = (await projects.media(userId, id)).find((item) => item.path === relative);
    if (!media) throw new Error('AUDIO_FILE_NOT_FOUND');
    const upload: StudioUpload = {
      media,
      taskId: (
        await context.manager.startImport(owner, {
          project_path: STUDIO_PROJECT_FILE,
          media_path: relative,
          transcribe: url.searchParams.get('transcribe') !== '0',
          language: z
            .string()
            .min(1)
            .max(100)
            .parse(url.searchParams.get('language') ?? DEFAULT_LANGUAGE),
        })
      ).id,
    };
    return send(200, { data: upload });
  }
  if (action === '/media/import' && req.method === 'POST') {
    const input = z
      .object({
        path: mediaPath,
        transcribe: z.boolean().default(true),
        language: z.string().min(1).max(100).default(DEFAULT_LANGUAGE),
      })
      .parse(await context.readJson());
    const task = await context.manager.startImport(owner, {
      project_path: STUDIO_PROJECT_FILE,
      media_path: input.path,
      transcribe: input.transcribe,
      language: input.language,
    });
    return send(200, { data: { taskId: task.id } });
  }
  if (action === '/media/blocks' && req.method === 'GET') {
    const relative = mediaPath.parse(url.searchParams.get('path'));
    return send(200, { data: await projects.blocks(workspace, relative) });
  }
  if (action === '/media' && req.method === 'DELETE') {
    const relative = mediaPath.parse(url.searchParams.get('path'));
    const { project } = await readProjectState(workspace, STUDIO_PROJECT_FILE);
    const used = project?.sections.some((section) =>
      section.segments.some(
        (segment) =>
          (segment.type === 'clip' && segment.path === relative) ||
          (segment.type === 'speech' && segment.replaces?.path === relative)
      )
    );
    if (used) throw new Error('AUDIO_MEDIA_IN_USE');
    await rm(await workspaceFile(workspace, relative));
    const sidecar = await workspaceFile(workspace, blocksPath(relative)).catch((): undefined => undefined);
    if (sidecar) await rm(sidecar, { force: true });
    return send(200, { data: { ok: true } });
  }
  if (action === '/text' && req.method === 'POST') {
    const input = z.object({ text: z.string().max(600_000) }).parse(await context.readJson());
    return send(200, { data: { blocks: textBlocks(input.text) } });
  }
  if (action === '/file' && req.method === 'GET')
    return streamFile(
      req,
      res,
      await workspaceFile(workspace, z.string().min(1).max(4096).parse(url.searchParams.get('path')))
    );
  throw new Error('INVALID_REQUEST');
}

/**
 * Stream an upload into `media/` under a fresh name. The body goes to a hidden temporary file first and is then
 * hard-linked into place without overwriting, so a half-written or clashing file never appears in the library.
 */
async function receiveUpload(req: IncomingMessage, workspace: string, name: string, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('AUDIO_FILE_TOO_LARGE');
  const folder = path.join(workspace, STUDIO_MEDIA_DIR);
  if (!(await stat(folder).catch((): undefined => undefined))?.isDirectory()) throw new Error('AUDIO_FILE_NOT_FOUND');
  const temporary = path.join(folder, `.upload-${randomUUID()}.part`);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new Error('AUDIO_FILE_TOO_LARGE') : null, chunk);
    },
  });
  try {
    await pipeline(req, limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (!bytes) throw new Error('AUDIO_FILE_EMPTY');
    const extension = path.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    for (let attempt = 1; attempt <= 100; attempt++) {
      const candidate = attempt === 1 ? name : `${stem}-${attempt}${extension}`;
      try {
        await link(temporary, path.join(folder, candidate));
        return `${STUDIO_MEDIA_DIR}/${candidate}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('AUDIO_LIMIT');
  } catch (error) {
    const code = audioError(error);
    throw new Error(code === 'AUDIO_FAILED' ? 'AUDIO_UPLOAD_FAILED' : code, { cause: error });
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Serve a workspace file with single-range support, so browser audio elements can seek. */
async function streamFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const size = (await handle.stat()).size;
    const extension = path.extname(file).toLowerCase();
    const type = TYPES[extension] ?? 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    let start = 0;
    let end = size - 1;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        res.end();
        return;
      }
    }
    const headers: Record<string, string | number> = {
      'content-type': type,
      'content-length': Math.max(0, end - start + 1),
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      'x-content-type-options': 'nosniff',
      ...(TYPES[extension] && extension !== '.zip'
        ? {}
        : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` }),
    };
    if (range && (range[1] || range[2])) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(range && (range[1] || range[2]) ? 206 : 200, headers);
    if (!size) {
      res.end();
      return;
    }
    await pipeline(handle.createReadStream({ start, end, autoClose: false }), res);
  } finally {
    await handle.close().catch(() => {});
  }
}
