import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  listeningProjectSchema,
  type ListeningProject,
} from '../../../desktop/src/common/types/platform/listeningProject.ts';
import type {
  StudioMedia,
  StudioMediaBlocks,
  StudioProject,
} from '../../../desktop/src/common/types/platform/audioStudio.ts';
import { ownerId, type AudioOwner } from '../audio/types.js';
import { workspaceFile } from '../audio/providers/media.js';

/** Every studio project folder holds exactly one editable project file at this workspace-relative path. */
export const STUDIO_PROJECT_FILE = 'project.listening.json';
/** Imported recordings, kept in their original format. */
export const STUDIO_MEDIA_DIR = 'media';
/** Hidden host-owned sidecars: one block list per imported recording. */
export const STUDIO_BLOCKS_DIR = '.studio/blocks';
export const STUDIO_AUDIO = /\.(?:mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i;
export const MAX_STUDIO_PROJECTS = 200;
const MAX_MEDIA = 200;

const projectId = z.string().uuid();
export const blocksSchema = z
  .object({
    version: z.literal(1),
    path: z.string().min(1).max(4096),
    durationSeconds: z.number().nonnegative(),
    blocks: z
      .array(
        z
          .object({
            start: z.number().min(0),
            end: z.number().positive(),
            text: z.string().max(50000).optional(),
            warnings: z.array(z.string().max(100)).max(100).optional(),
          })
          .strict()
      )
      .max(500),
    warnings: z.array(z.string().max(100)).max(100),
  })
  .strict();

/** Studio media sidecar name: a flat file per recording, so names never escape the blocks folder. */
export const blocksPath = (mediaPath: string): string => `${STUDIO_BLOCKS_DIR}/${path.posix.basename(mediaPath)}.json`;

/** Keep letters (any script), digits, dot, dash and underscore; collapse the rest so names stay readable. */
export function safeMediaName(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  const extension = path.extname(base).toLowerCase();
  const stem = base
    .slice(0, base.length - extension.length)
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[.-]+|-+$/g, '')
    .slice(0, 80);
  return `${stem || 'audio'}${extension}`;
}

const newProject = (title: string): ListeningProject =>
  listeningProjectSchema.parse({
    version: 1,
    title,
    sections: [{ id: 'main', plays: 1, gapBetweenPlays: 0, gapAfter: 0, segments: [] }],
  });

/**
 * Standalone audio projects under `<dataDir>/audio-projects/<userId>/<projectId>/`. Each folder is a regular
 * audio workspace, so the listening editor, renders and agent tools work on it unchanged.
 */
export class StudioProjects {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, 'audio-projects');
  }
  private userRoot(userId: string): string {
    return path.join(this.root, ownerId.parse(userId));
  }
  /** Absolute folder of an existing project, after confirming it is a real directory inside the user root. */
  async directory(userId: string, id: string): Promise<string> {
    const folder = path.join(this.userRoot(userId), projectId.parse(id));
    let real: string;
    try {
      real = await realpath(folder);
    } catch {
      throw new Error('AUDIO_PROJECT_NOT_FOUND');
    }
    if (real !== folder || !(await stat(real)).isDirectory()) throw new Error('AUDIO_FILE_FORBIDDEN');
    return real;
  }
  /** Audio owner for editor and import requests; the synthetic conversation id keeps task gates separate. */
  async owner(userId: string, id: string): Promise<AudioOwner> {
    return { userId, conversationId: `studio-${projectId.parse(id)}`, workspace: await this.directory(userId, id) };
  }
  private async summary(userId: string, id: string): Promise<StudioProject | undefined> {
    const workspace = await this.directory(userId, id).catch((): undefined => undefined);
    if (!workspace) return undefined;
    const file = path.join(workspace, STUDIO_PROJECT_FILE);
    const info = await stat(file).catch((): undefined => undefined);
    if (!info?.isFile()) return undefined;
    let title = '';
    let segments = 0;
    try {
      const value = JSON.parse(await readFile(file, 'utf8')) as Partial<ListeningProject>;
      title = typeof value.title === 'string' ? value.title : '';
      segments = Array.isArray(value.sections)
        ? value.sections.reduce(
            (sum, section) => sum + (Array.isArray(section.segments) ? section.segments.length : 0),
            0
          )
        : 0;
    } catch {
      // An unreadable project still lists, so the user can open it and see the validation details.
    }
    const created = await stat(workspace);
    return {
      id,
      title,
      workspace,
      projectPath: STUDIO_PROJECT_FILE,
      segments,
      createdAt: Math.round(created.birthtimeMs || created.ctimeMs),
      updatedAt: Math.round(info.mtimeMs),
    };
  }
  /** The user's projects, most recently edited first. */
  async list(userId: string): Promise<StudioProject[]> {
    const names = await readdir(this.userRoot(userId)).catch((): string[] => []);
    const projects = await Promise.all(
      names.filter((name) => projectId.safeParse(name).success).map((name) => this.summary(userId, name))
    );
    return projects
      .filter((project): project is StudioProject => !!project)
      .toSorted((a, b) => b.updatedAt - a.updatedAt);
  }
  async create(userId: string, title: string): Promise<StudioProject> {
    if ((await this.list(userId)).length >= MAX_STUDIO_PROJECTS) throw new Error('AUDIO_LIMIT');
    const id = randomUUID();
    const folder = path.join(this.userRoot(userId), id);
    await mkdir(this.userRoot(userId), { recursive: true, mode: 0o700 });
    await mkdir(folder, { mode: 0o700 });
    await mkdir(path.join(folder, STUDIO_MEDIA_DIR), { mode: 0o700 });
    await writeFile(path.join(folder, STUDIO_PROJECT_FILE), JSON.stringify(newProject(title), null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return (await this.summary(userId, id))!;
  }
  /** Delete by moving aside first, so a half-removed folder never lists as a broken project. */
  async remove(userId: string, id: string): Promise<void> {
    const folder = await this.directory(userId, id);
    const trash = path.join(this.root, '.trash', `${id}-${randomUUID()}`);
    await mkdir(path.dirname(trash), { recursive: true, mode: 0o700 });
    await rename(folder, trash);
    await rm(trash, { recursive: true, force: true });
  }
  /** Imported recordings with their block sidecars; files are listed even before an import finishes. */
  async media(userId: string, id: string): Promise<StudioMedia[]> {
    const workspace = await this.directory(userId, id);
    const names = await readdir(path.join(workspace, STUDIO_MEDIA_DIR)).catch((): string[] => []);
    const items = await Promise.all(
      names
        .filter((name) => !name.startsWith('.') && STUDIO_AUDIO.test(name))
        .slice(0, MAX_MEDIA)
        .map(async (name): Promise<StudioMedia | undefined> => {
          const relative = `${STUDIO_MEDIA_DIR}/${name}`;
          const file = await workspaceFile(workspace, relative).catch((): undefined => undefined);
          if (!file) return undefined;
          const info = await stat(file);
          const blocks = await this.blocks(workspace, relative).catch((): undefined => undefined);
          return {
            path: relative,
            name,
            bytes: info.size,
            addedAt: Math.round(info.mtimeMs),
            ...(blocks
              ? {
                  durationSeconds: blocks.durationSeconds,
                  blocks: blocks.blocks.length,
                  transcribed: blocks.blocks.some((block) => !!block.text),
                }
              : {}),
          };
        })
    );
    return items.filter((item): item is StudioMedia => !!item).toSorted((a, b) => a.addedAt - b.addedAt);
  }
  /** The block sidecar of one recording, or `AUDIO_FILE_NOT_FOUND` while it has not been imported yet. */
  async blocks(workspace: string, mediaPath: string): Promise<StudioMediaBlocks> {
    const file = await workspaceFile(workspace, blocksPath(mediaPath));
    const parsed = blocksSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed.success || parsed.data.path !== mediaPath) throw new Error('AUDIO_FILE_NOT_FOUND');
    return parsed.data;
  }
}
