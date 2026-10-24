import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../../manager.js';
import { publicTask, type AudioOwner, type AudioTask } from '../../types.js';
import { readProjectState, saveProject } from '../editor.js';
import { replaceRange } from '../editing/index.js';
import type { TrackMedia } from '../ffmpeg.js';
import { runProcess } from '../../providers/media.js';

const media: TrackMedia = {
  probe: async (file) => Number((await readFile(file, 'utf8')).split(':')[0]),
  silence: async (file, seconds) => writeFile(file, `${seconds}:silence`),
  tone: async (file) => writeFile(file, '1:tone'),
  decode: async (source, destination, _signal, window) =>
    writeFile(
      destination,
      window ? `${window.end - window.start}:source-${window.start}-${window.end}` : await readFile(source, 'utf8')
    ),
  assemble: async (pieces, destination) => {
    const texts = await Promise.all(pieces.map((piece) => readFile(piece, 'utf8')));
    await writeFile(
      destination,
      texts.reduce((sum, text) => sum + Number(text.split(':')[0]), 0) + ':' + texts.join('|')
    );
  },
};
describe('revision-bound source replacements', () => {
  let root: string;
  let owner: AudioOwner;
  let manager: AudioManager;
  const projectPath = 'original.listening.json';
  const speak = vi.fn(async (options: { output: string; text?: string }) => {
    await writeFile(options.output, '3:' + options.text);
    return { segments: [{ text: options.text!, startSecond: 0, endSecond: 3 }] };
  });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'audio-replacement-'));
    owner = { userId: 'teacher', conversationId: 'lesson', workspace: path.join(root, 'workspace') };
    await mkdir(owner.workspace);
    await writeFile(path.join(owner.workspace, 'source.mp3'), '10:original');
    await writeFile(
      path.join(owner.workspace, projectPath),
      JSON.stringify({
        version: 1,
        title: '2026',
        sourceAudio: 'source.mp3',
        sections: [
          {
            id: 'a',
            plays: 1,
            gapAfter: 0,
            segments: [{ id: 'clip', type: 'clip', path: 'source.mp3', start: 0, end: 10 }],
          },
        ],
      })
    );
    speak.mockClear();
    manager = new AudioManager(root, {
      trackMedia: media,
      speak,
      catalog: {
        resolve: async () => {
          throw new Error('AUDIO_MODEL_UNSUPPORTED');
        },
      },
    });
    await manager.ready;
  });
  afterEach(async () => {
    await manager.close();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  const input = (revision: string) => ({
    revision,
    clipId: 'clip',
    start: 2,
    end: 4,
    text: '二零二六年',
    voice: 'HiuMaan' as const,
  });
  const wait = async (id: string): Promise<AudioTask> => {
    for (let i = 0; i < 500; i++) {
      const task = (await manager.listTracks(owner, projectPath)).find((item) => item.id === id)!;
      if (!['queued', 'running'].includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('task did not finish');
  };
  it('previews without edits, applies complementary ranges, and reuses the exact synthesis in the final track', async () => {
    const original = await readProjectState(owner.workspace, projectPath);
    const task = await wait(
      (
        await manager.startEditorTask(owner, 'replacement', {
          project_path: projectPath,
          revision: original.revision,
          replacement: input(original.revision),
        })
      ).id
    );
    expect(task).toMatchObject({
      kind: 'replacement',
      status: 'completed',
      projectRevision: original.revision,
      preview: { originalSeconds: 2, replacementSeconds: 3, deltaSeconds: 1 },
    });
    expect((await readProjectState(owner.workspace, projectPath)).revision).toBe(original.revision);
    await expect(
      manager.applyReplacement({ ...owner, userId: 'other' }, projectPath, original.revision, task.id)
    ).rejects.toThrow('AUDIO_TASK_NOT_FOUND');
    await manager.applyReplacement(owner, projectPath, original.revision, task.id);
    const changed = await readProjectState(owner.workspace, projectPath);
    expect(changed.project!.sections[0].segments.map((segment) => segment.type)).toEqual(['clip', 'speech', 'clip']);
    expect(changed.project!.sections[0].segments[2]).toMatchObject({ start: 4, end: 10 });
    await expect(manager.applyReplacement(owner, projectPath, original.revision, task.id)).rejects.toThrow(
      'AUDIO_PROJECT_CONFLICT'
    );
    const rendered = await wait((await manager.startUserTrack(owner, { project_path: projectPath })).id);
    expect(rendered).toMatchObject({ status: 'completed', projectRevision: changed.revision, durationSeconds: 11 });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(await readFile(path.join(owner.workspace, 'source.mp3'), 'utf8')).toBe('10:original');
  });
  it('rejects invalid ranges and prevents two simultaneous saves from overwriting one revision', async () => {
    const original = await readProjectState(owner.workspace, projectPath);
    expect(() => replaceRange(original.project!, { ...input(original.revision), start: 8, end: 4 })).toThrow(
      'AUDIO_REPLACEMENT_INVALID'
    );
    const results = await Promise.allSettled(
      ['A', 'B'].map((title) =>
        saveProject(owner.workspace, projectPath, { ...original.project!, title }, original.revision)
      )
    );
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
  it('exports a portable bundle whose source references load in an unrelated workspace', async () => {
    vi.stubEnv('AIONUI_AUDIO_PYTHON', 'python3');
    const state = await readProjectState(owner.workspace, projectPath);
    const task = await wait(
      (await manager.startEditorTask(owner, 'export', { project_path: projectPath, revision: state.revision })).id
    );
    expect(task).toMatchObject({ status: 'completed', kind: 'export' });
    const moved = path.join(root, 'moved');
    await runProcess(
      'python3',
      ['-m', 'zipfile', '-e', path.join(owner.workspace, task.files[0].path), moved],
      AbortSignal.timeout(10000)
    );
    const portable = await readProjectState(moved, 'project.listening.json');
    const source = portable.project!.sourceAudio!;
    expect(source).toMatch(/^assets\//);
    expect(await readFile(path.join(moved, source), 'utf8')).toBe('10:original');
    expect(await readdir(path.join(moved, 'assets'))).toHaveLength(1);
    expect(await readFile(path.join(moved, 'project.listening.json'), 'utf8')).not.toContain(owner.workspace);
  });
  it('keeps optional QA/catalog failure from blocking a teacher-started render', async () => {
    await manager.store.saveSettings(owner.userId, { model: 'fixture/model', apiKey: 'private-fixture' });
    const rendered = await wait((await manager.startUserTrack(owner, { project_path: projectPath })).id);
    expect(rendered).toMatchObject({ status: 'completed' });
    expect(rendered.warnings).toContain('AUDIO_QA_INCOMPLETE');
    expect(JSON.stringify(publicTask((await manager.store.loadTasks())[0]))).not.toContain('private-fixture');
  });
  it('cleans an interrupted preview and never replays it after a host restart', async () => {
    await manager.close();
    let entered!: () => void;
    const speaking = new Promise<void>((resolve) => {
      entered = resolve;
    });
    manager = new AudioManager(root, {
      trackMedia: media,
      speak: async (options) => {
        entered();
        await new Promise<void>((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(new Error('AUDIO_CANCELLED')), { once: true })
        );
        return { segments: [] };
      },
    });
    const state = await readProjectState(owner.workspace, projectPath);
    const preview = await manager.startEditorTask(owner, 'replacement', {
      project_path: projectPath,
      revision: state.revision,
      replacement: input(state.revision),
    });
    await speaking;
    await manager.close();
    expect((await manager.listTracks(owner, projectPath)).find((task) => task.id === preview.id)).toMatchObject({
      status: 'interrupted',
      files: [],
    });
    expect(await readdir(path.join(root, 'audio/work'))).toEqual([]);
    manager = new AudioManager(root, {
      speak: async () => {
        throw new Error('must not replay');
      },
    });
    await manager.ready;
    expect((await manager.listTracks(owner, projectPath)).find((task) => task.id === preview.id)).toMatchObject({
      status: 'interrupted',
    });
    expect((await readProjectState(owner.workspace, projectPath)).revision).toBe(state.revision);
  });
});
