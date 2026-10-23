import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../manager.js';
import { AudioStore } from '../store.js';
import type { AudioOwner, AudioTask } from '../types.js';

describe('host-owned audio tasks', () => {
  let directory: string;
  let owner: AudioOwner;
  let manager: AudioManager;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'audio-manager-'));
    owner = { userId: 'alice', conversationId: 'lesson', workspace: path.join(directory, 'workspace') };
    await mkdir(owner.workspace);
    await writeFile(path.join(owner.workspace, 'recording.mp3'), 'fixture');
    manager = new AudioManager(directory, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      media: { probe: async () => 19.8, chunk: vi.fn() },
      transcribe: async (options) => {
        await options.progress(1, 1, { chunk: 1, costUsd: 0.001 });
        return { segments: [{ text: '喺學校集合。', startSecond: 0.2, endSecond: 19.8 }] };
      },
      speak: async (options) => {
        await writeFile(options.output, 'fixture-audio');
        return { segments: [{ text: options.text!, startSecond: 0.2, endSecond: 19.8 }] };
      },
    });
    await manager.ready;
    await manager.parentStart(owner, 'event-1', 'thread');
    await manager.parentBound(owner, 'event-1', 'turn-1');
  });
  afterEach(async () => {
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (
    manager: AudioManager,
    owner: AudioOwner,
    name: 'transcribe_audio' | 'synthesize_speech',
    args: Record<string, unknown>
  ) => manager.command(owner, name, args, new AbortController().signal);
  const done = (
    manager: AudioManager,
    owner: AudioOwner,
    name: 'transcribe_audio' | 'synthesize_speech',
    task: AudioTask
  ) => call(manager, owner, name, { action: 'wait', task_id: task.id, wait_sec: 5 });
  it('requires a private key for transcription but not for Edge TTS', async () => {
    await expect(call(manager, owner, 'transcribe_audio', { audio_path: 'recording.mp3' })).rejects.toThrow(
      'AUDIO_KEY_REQUIRED'
    );
    const task = await done(
      manager,
      owner,
      'synthesize_speech',
      await call(manager, owner, 'synthesize_speech', { text: '請留意。', voice: 'WanLung', subtitles: true })
    );
    expect(task).toMatchObject({ status: 'completed', voice: 'WanLung' });
    expect(task.files.map((file) => file.format)).toEqual(['mp3', 'srt']);
  });
  it('returns SRT by default and status polling does not regenerate or reveal credentials', async () => {
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    const task = await done(
      manager,
      owner,
      'transcribe_audio',
      await call(manager, owner, 'transcribe_audio', { audio_path: 'recording.mp3' })
    );
    const again = await call(manager, owner, 'transcribe_audio', { action: 'status', task_id: task.id });
    expect(again).toMatchObject({ status: 'completed', completedChunks: 1, costUsd: 0.001 });
    expect(await readFile(path.join(owner.workspace, task.files[0].path), 'utf8')).toContain(
      '00:00:00,200 --> 00:00:19,800'
    );
    expect(JSON.stringify(task)).not.toContain('fixture-secret');
    expect(JSON.stringify(await manager.store.loadTasks())).not.toContain('fixture-secret');
  });
  it('isolates keys, output files and task IDs by owner and conversation', async () => {
    await manager.store.saveSettings('alice', { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    expect(await manager.store.settings('bob')).toEqual({ model: 'google/gemini-3.8-flash', hasApiKey: false });
    const task = await call(manager, owner, 'synthesize_speech', { text: '請留意。' });
    await expect(
      call(manager, { ...owner, userId: 'bob' }, 'synthesize_speech', { action: 'status', task_id: task.id })
    ).rejects.toThrow('AUDIO_TASK_NOT_FOUND');
    await expect(call(manager, owner, 'synthesize_speech', { text_path: '../outside.txt' })).rejects.toThrow(
      'AUDIO_FILE_FORBIDDEN'
    );
  });
  it('stops admission after parent Stop and ignores foreign-thread Stop', async () => {
    await manager.parentStop(owner, 'foreign-thread', 'turn-1');
    const first = await call(manager, owner, 'synthesize_speech', { text: '第一段。' });
    await done(manager, owner, 'synthesize_speech', first);
    await manager.parentStop(owner, 'thread', 'turn-1');
    await expect(call(manager, owner, 'synthesize_speech', { text: '第二段。' })).rejects.toThrow(
      'AUDIO_PARENT_STOPPED'
    );
    await manager.parentStart(owner, 'event-2', 'thread');
    expect((await call(manager, owner, 'synthesize_speech', { text: '第三段。' })).id).not.toBe(first.id);
  });
  it('marks persisted unfinished work as interrupted after restart', async () => {
    const task = await done(
      manager,
      owner,
      'synthesize_speech',
      await call(manager, owner, 'synthesize_speech', { text: '請留意。' })
    );
    const store = new AudioStore(directory);
    const [stored] = await store.loadTasks();
    stored.status = 'running';
    stored.files = [];
    await store.saveTask(stored);
    const restarted = new AudioManager(directory);
    await restarted.ready;
    expect(await call(restarted, owner, 'synthesize_speech', { action: 'status', task_id: task.id })).toMatchObject({
      status: 'interrupted',
      error: 'AUDIO_HOST_RESTARTED',
    });
    await restarted.close();
  });
  it('keeps the selected model and key fixed when settings change during execution', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: { model: string; key: string }[] = [];
    await manager.close();
    manager = new AudioManager(directory, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      media: { probe: async () => 20, chunk: vi.fn() },
      transcribe: async (options) => {
        entered();
        await barrier;
        seen.push({ model: options.model.id, key: options.apiKey });
        return { segments: [{ text: '請留意。', startSecond: 0, endSecond: 10 }] };
      },
    });
    await manager.parentStart(owner, 'snapshot-event', 'thread');
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'first-key' });
    const first = await call(manager, owner, 'transcribe_audio', { audio_path: 'recording.mp3' });
    await started;
    await manager.store.saveSettings(owner.userId, { model: 'other/multimodal', apiKey: 'second-key' });
    release();
    expect((await done(manager, owner, 'transcribe_audio', first)).model).toBe('google/gemini-3.8-flash');
    await done(
      manager,
      owner,
      'transcribe_audio',
      await call(manager, owner, 'transcribe_audio', { audio_path: 'recording.mp3' })
    );
    expect(seen).toEqual([
      { model: 'google/gemini-3.8-flash', key: 'first-key' },
      { model: 'other/multimodal', key: 'second-key' },
    ]);
  });
  it('aborts work after parent Stop without publishing files or allowing another request', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const aborted = vi.fn();
    await manager.close();
    manager = new AudioManager(directory, {
      speak: async (options) => {
        entered();
        await new Promise<void>((_resolve, reject) =>
          options.signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('AUDIO_CANCELLED'));
            },
            { once: true }
          )
        );
        return { segments: [] };
      },
    });
    await manager.parentStart(owner, 'stop-event', 'thread');
    await manager.parentBound(owner, 'stop-event', 'turn');
    const task = await call(manager, owner, 'synthesize_speech', { text: '請留意。' });
    await started;
    await manager.parentStop(owner, 'thread', 'turn');
    await manager.close();
    expect(await call(manager, owner, 'synthesize_speech', { action: 'status', task_id: task.id })).toMatchObject({
      status: 'cancelled',
      files: [],
    });
    expect(aborted).toHaveBeenCalledOnce();
    expect(await readdir(path.join(directory, 'audio/work'))).toEqual([]);
  });
  it('retains usage for a failed transcription and delivers no partial subtitle', async () => {
    await manager.close();
    manager = new AudioManager(directory, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      media: { probe: async () => 601, chunk: vi.fn() },
      transcribe: async (options) => {
        await options.progress(1, 3, { chunk: 1, costUsd: 0.002 });
        throw new Error('AUDIO_API_FAILED');
      },
    });
    await manager.parentStart(owner, 'failure-event', 'thread');
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    const task = await done(
      manager,
      owner,
      'transcribe_audio',
      await call(manager, owner, 'transcribe_audio', { audio_path: 'recording.mp3' })
    );
    expect(task).toMatchObject({
      status: 'failed',
      files: [],
      completedChunks: 1,
      totalChunks: 3,
      costUsd: 0.002,
      warnings: ['AUDIO_COST_INCOMPLETE'],
    });
  });
  it('rejects an output directory symlink escaping the conversation workspace', async () => {
    const outside = path.join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(owner.workspace, 'audio'), process.platform === 'win32' ? 'junction' : 'dir');
    const task = await done(
      manager,
      owner,
      'synthesize_speech',
      await call(manager, owner, 'synthesize_speech', { text: '請留意。' })
    );
    expect(task).toMatchObject({ status: 'failed', error: 'AUDIO_FILE_FORBIDDEN', files: [] });
    expect(await readdir(outside)).toEqual([]);
  });
  it('does not restore a cleared key when a concurrent settings write keeps the model', async () => {
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    await Promise.all([
      manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', clearApiKey: true }),
      manager.store.saveSettings(owner.userId, { model: 'other/multimodal' }),
    ]);
    expect(await manager.store.settings(owner.userId)).toEqual({ model: 'other/multimodal', hasApiKey: false });
  });
});

describe('listening track tasks', () => {
  let directory: string;
  let owner: AudioOwner;
  let manager: AudioManager;
  const transcribe = vi.fn(async (_options: { source: string }) => ({
    segments: [{ text: '請排隊', startSecond: 0, endSecond: 1 }],
  }));
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'audio-track-'));
    owner = { userId: 'alice', conversationId: 'lesson', workspace: path.join(directory, 'workspace') };
    await mkdir(path.join(owner.workspace, 'listening'), { recursive: true });
    transcribe.mockClear();
    manager = new AudioManager(directory, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      media: { probe: async () => 2, chunk: vi.fn() },
      transcribe: async (options) => {
        await options.progress(1, 1, { chunk: 1, costUsd: 0.003 });
        return transcribe(options);
      },
      speak: async (options) => {
        await writeFile(options.output, options.text!);
        return { segments: [{ text: options.text!, startSecond: 0, endSecond: 2 }] };
      },
      trackMedia: {
        probe: async () => 2,
        silence: async (file) => writeFile(file, 'silence'),
        tone: async (file) => writeFile(file, 'tone'),
        decode: async (_source, file) => writeFile(file, 'pcm'),
        assemble: async (_pieces, file) => writeFile(file, 'track'),
      },
    });
    await manager.ready;
    await manager.parentStart(owner, 'event-1', 'thread');
  });
  afterEach(async () => {
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const render = async (args: Record<string, unknown>) => {
    const task = await manager.command(owner, 'render_listening_track', args, new AbortController().signal);
    return manager.command(
      owner,
      'render_listening_track',
      { action: 'wait', task_id: task.id, wait_sec: 5 },
      new AbortController().signal
    );
  };
  const writeProject = (sections: unknown[]) =>
    writeFile(
      path.join(owner.workspace, 'listening', 'unit.listening.json'),
      JSON.stringify({ version: 1, title: '單元二', sections })
    );

  it('publishes the track bundle and skips QA without a key', async () => {
    await writeProject([{ id: 'a', segments: [{ id: 's', type: 'speech', text: '請排隊。' }] }]);
    const task = await render({ project_path: 'listening/unit.listening.json' });
    expect(task).toMatchObject({
      kind: 'track',
      status: 'completed',
      summary: '單元二',
      warnings: ['AUDIO_QA_SKIPPED'],
    });
    expect(task).not.toHaveProperty('qaIssues');
    expect(task.files.map((file) => file.path)).toEqual(
      ['track.mp3', 'track.srt', 'timeline.json', 'script.txt'].map((name) => `audio/${task.id}/${name}`)
    );
    expect(await readFile(path.join(owner.workspace, task.files[0].path), 'utf8')).toBe('track');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('runs QA with a configured key and records usage host-side only', async () => {
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    await writeProject([{ id: 'a', segments: [{ id: 's', type: 'speech', text: '請排隊。' }] }]);
    const task = await render({ project_path: 'listening/unit.listening.json' });
    expect(task).toMatchObject({ status: 'completed', qaIssues: 0, warnings: [] });
    expect(task.files.map((file) => path.basename(file.path))).toContain('qa.json');
    expect(task.usage).toEqual([{ chunk: 1, costUsd: 0.003 }]);
    expect(transcribe.mock.calls[0][0].source).not.toContain(owner.workspace);
  });

  it('rejects invalid projects with actionable details', async () => {
    await expect(manager.command(owner, 'render_listening_track', {}, new AbortController().signal)).rejects.toThrow(
      'INVALID_REQUEST'
    );
    await writeProject([{ id: 'a', segments: [] }]);
    await expect(
      manager.command(
        owner,
        'render_listening_track',
        { project_path: 'listening/unit.listening.json' },
        new AbortController().signal
      )
    ).rejects.toMatchObject({
      message: 'AUDIO_PROJECT_INVALID',
      details: [expect.stringMatching(/^sections\.0\.segments: /)],
    });
    await writeProject([{ id: 'a', segments: [{ id: 'k', type: 'clip', path: 'missing.mp3', start: 0, end: 1 }] }]);
    expect(await render({ project_path: 'listening/unit.listening.json' })).toMatchObject({
      status: 'failed',
      error: 'AUDIO_PROJECT_INVALID',
      errorDetails: ['k.path: AUDIO_FILE_NOT_FOUND'],
    });
  });
});
