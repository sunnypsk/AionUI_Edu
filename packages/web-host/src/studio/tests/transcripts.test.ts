import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioManager } from '../../audio/manager.js';
import { readProjectState } from '../../audio/track/editor.js';
import type { AudioOwner, AudioTask } from '../../audio/types.js';
import { importMedia } from '../importMedia.js';
import { StudioProjects } from '../projects.js';

/** Fake transcriber: two timed sentences, relative to the start of the cut it receives. */
const timed = [
  { text: '早晨。', startSecond: 0.5, endSecond: 2 },
  { text: '今日落雨。', startSecond: 3, endSecond: 5 },
];

describe('timed transcripts', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'studio-transcripts-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('stores import cues in source seconds', async () => {
    const projects = new StudioProjects(directory);
    const created = await projects.create('alice', 'Lesson');
    await writeFile(path.join(created.workspace, 'media', 'talk.wav'), 'fixture');
    await importMedia({
      workspace: created.workspace,
      mediaPath: 'media/talk.wav',
      directory: await mkdtemp(path.join(directory, 'work-')),
      signal: new AbortController().signal,
      services: {
        probe: async () => 30,
        silences: async () => [{ start: 9, end: 13 }],
        cut: async (_file, destination) => writeFile(destination, ''),
        transcribe: async () => timed,
      },
      progress: async () => {},
    });
    const { blocks } = await projects.blocks(created.workspace, 'media/talk.wav');
    expect(blocks[1]).toMatchObject({
      text: '早晨。今日落雨。',
      cues: [
        { text: '早晨。', startSecond: 13.5, endSecond: 15 },
        { text: '今日落雨。', startSecond: 16, endSecond: 18 },
      ],
    });
  });

  describe('re-transcribing clips', () => {
    let manager: AudioManager;
    let owner: AudioOwner;
    let revision: string;
    beforeEach(async () => {
      owner = { userId: 'alice', conversationId: 'studio-x', workspace: path.join(directory, 'workspace') };
      await mkdir(path.join(owner.workspace, 'media'), { recursive: true });
      await writeFile(path.join(owner.workspace, 'media', 'a.wav'), 'fixture');
      await writeFile(
        path.join(owner.workspace, 'project.listening.json'),
        JSON.stringify({
          version: 1,
          title: 'Lesson',
          sections: [
            {
              id: 'main',
              segments: [
                { id: 'c1', type: 'clip', path: 'media/a.wav', start: 0, end: 10 },
                { id: 'c2', type: 'clip', path: 'media/a.wav', start: 10, end: 20 },
                { id: 'p1', type: 'pause', seconds: 1 },
              ],
            },
          ],
        })
      );
      manager = new AudioManager(directory, {
        catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
        media: { probe: async () => 10, chunk: async (_file, destination) => writeFile(destination, '') },
        transcribe: async () => ({ segments: timed }),
      });
      await manager.ready;
      revision = (await readProjectState(owner.workspace, 'project.listening.json')).revision;
    });
    afterEach(async () => {
      await manager.close();
    });
    const finished = async (id: string): Promise<AudioTask> => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const task = (await manager.listTracks(owner, 'project.listening.json')).find((item) => item.id === id);
        if (task && task.status !== 'queued' && task.status !== 'running') return task;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('task did not finish');
    };
    const start = (segmentIds: string[]) =>
      manager.startEditorTask(owner, 'transcript', { project_path: 'project.listening.json', revision, segmentIds });

    it('requires a transcription key and only accepts recording clips', async () => {
      await expect(start(['c1'])).rejects.toThrow('AUDIO_KEY_REQUIRED');
      await manager.store.saveSettings('alice', { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
      await expect(start(['p1'])).rejects.toThrow('AUDIO_PROJECT_INVALID');
    });

    it('returns each clip’s text and cues without changing the project file', async () => {
      await manager.store.saveSettings('alice', { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
      const before = await readFile(path.join(owner.workspace, 'project.listening.json'), 'utf8');
      const task = await finished((await start(['c1', 'c2'])).id);
      expect(task).toMatchObject({ status: 'completed', kind: 'transcript', segmentIds: ['c1', 'c2'] });
      expect(task.transcripts).toEqual({
        c1: { path: 'media/a.wav', start: 0, end: 10, text: '早晨。今日落雨。', cues: timed },
        c2: {
          path: 'media/a.wav',
          start: 10,
          end: 20,
          text: '早晨。今日落雨。',
          cues: [
            { text: '早晨。', startSecond: 10.5, endSecond: 12 },
            { text: '今日落雨。', startSecond: 13, endSecond: 15 },
          ],
        },
      });
      expect(await readFile(path.join(owner.workspace, 'project.listening.json'), 'utf8')).toBe(before);
    });
  });
});
