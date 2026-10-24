import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectState, saveProject, setQaAccepted } from '../editor.js';
import { SEGMENT_CACHE } from '../render.js';

const project = (text: string) => ({
  version: 1,
  title: '單元二',
  sections: [{ id: 'a', segments: [{ id: 's', type: 'speech', text }] }],
});

describe('listening editor state', () => {
  let workspace: string;
  const file = 'listening/unit.listening.json';
  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'listening-editor-'));
    await mkdir(path.join(workspace, ...SEGMENT_CACHE.split('/')), { recursive: true });
    await writeFile(path.join(workspace, file), JSON.stringify(project('早晨。')));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const cache = (name: string, content: string) =>
    writeFile(path.join(workspace, ...SEGMENT_CACHE.split('/'), name), content);

  it('reports cache and QA state per speech segment', async () => {
    const first = await readProjectState(workspace, file);
    expect(first.project?.title).toBe('單元二');
    const { key } = first.segments.s;
    expect(first.segments.s).toEqual({ key, cached: false });
    await cache(`${key}.mp3`, 'audio');
    await cache(`${key}.qa.json`, JSON.stringify({ heard: '早神' }));
    expect((await readProjectState(workspace, file)).segments.s).toEqual({
      key,
      cached: true,
      qa: { heard: '早神', similarity: 0.5, accepted: false },
    });
  });

  it('reports generated line durations from metadata, falling back to subtitle boundaries', async () => {
    const { key } = (await readProjectState(workspace, file)).segments.s;
    await cache(`${key}.json`, JSON.stringify([{ text: '早晨。', startSecond: 0.1, endSecond: 2.7 }]));
    expect((await readProjectState(workspace, file)).segments.s.duration).toBeUndefined();
    await cache(`${key}.mp3`, 'audio');
    expect((await readProjectState(workspace, file)).segments.s.duration).toBe(2.7);
    await cache(`${key}.meta.json`, JSON.stringify({ duration: 3.2 }));
    expect((await readProjectState(workspace, file)).segments.s.duration).toBe(3.2);
  });

  it('returns validation details for an invalid file instead of failing', async () => {
    await writeFile(path.join(workspace, file), '{"version":1}');
    const state = await readProjectState(workspace, file);
    expect(state.project).toBeUndefined();
    expect(state.details).toEqual(expect.arrayContaining([expect.stringMatching(/^title: /)]));
  });

  it('saves only against the latest revision and refuses other files', async () => {
    const { revision } = await readProjectState(workspace, file);
    const saved = await saveProject(workspace, file, project('午安。'), revision);
    expect(saved.revision).not.toBe(revision);
    expect(JSON.parse(await readFile(path.join(workspace, file), 'utf8')).sections[0].segments[0].text).toBe('午安。');
    await expect(saveProject(workspace, file, project('晚安。'), revision)).rejects.toThrow('AUDIO_PROJECT_CONFLICT');
    await expect(saveProject(workspace, file, { version: 1 }, saved.revision)).rejects.toThrow('AUDIO_PROJECT_INVALID');
    await writeFile(path.join(workspace, 'notes.json'), '{}');
    await expect(readProjectState(workspace, 'notes.json')).rejects.toThrow('AUDIO_FILE_FORBIDDEN');
  });

  it('accepts a QA reading for the current text only', async () => {
    const { segments, revision } = await readProjectState(workspace, file);
    await expect(setQaAccepted(workspace, file, 's', true)).rejects.toThrow('AUDIO_QA_NOT_FOUND');
    await cache(`${segments.s.key}.qa.json`, JSON.stringify({ heard: '早神' }));
    expect((await setQaAccepted(workspace, file, 's', true)).segments.s.qa?.accepted).toBe(true);
    const edited = await saveProject(workspace, file, project('早晨啊。'), revision);
    expect(edited.segments.s.qa).toBeUndefined();
    await expect(setQaAccepted(workspace, file, 'missing', true)).rejects.toThrow('INVALID_REQUEST');
  });
});
