import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from '../manager.js';
import { agentTask, type AudioOwner, type AudioTask } from '../types.js';
import { loadProject } from '../track/project.js';
import type { TranscriptionOptions } from '../providers/gemini.js';

describe('reference analysis tasks', () => {
  let root: string;
  let owner: AudioOwner;
  let manager: AudioManager;
  const silences = vi.fn(async () => [{ start: 3, end: 7 }]);
  const transcribe = vi.fn(async (options: TranscriptionOptions) => {
    await options.progress(1, 1, { chunk: 1, costUsd: 0.003 });
    return { segments: [{ text: '同學請留意下一題。', startSecond: 0, endSecond: 3 }] };
  });
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'reference-tasks-'));
    owner = { userId: 'teacher', conversationId: 'lesson', workspace: path.join(root, 'workspace') };
    await mkdir(owner.workspace);
    await writeFile(path.join(owner.workspace, 'recording.wav'), 'original');
    silences.mockReset().mockResolvedValue([{ start: 3, end: 7 }]);
    transcribe.mockClear();
    manager = new AudioManager(root, {
      catalog: { resolve: async (id) => ({ id, name: id, audioInput: true, parameters: [], reasoning: [] }) },
      media: {
        probe: async () => 12,
        chunk: async (_file, destination) => {
          await writeFile(destination, 'chunk');
        },
      },
      silences,
      transcribe,
    });
    await manager.ready;
    await manager.parentStart(owner, 'event', 'thread');
    await manager.parentBound(owner, 'event', 'turn');
  });
  afterEach(async () => {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  });
  const call = (args: Record<string, unknown>) =>
    manager.command(owner, 'analyze_reference_audio', args, new AbortController().signal);
  const wait = (task: AudioTask) => call({ action: 'wait', task_id: task.id, wait_sec: 5 });

  it('publishes a reusable draft, source snapshot and analysis with no key or overwrite', async () => {
    const first = await wait(await call({ audio_path: 'recording.wav' }));
    const second = await wait(await call({ audio_path: 'recording.wav' }));
    const project = await loadProject(owner.workspace, first.projectPath!);
    expect(first).toMatchObject({
      kind: 'analysis',
      status: 'completed',
      completedChunks: 3,
      totalChunks: 3,
      files: [
        { path: 'audio/' + first.id + '/reference.listening.json', format: 'json' },
        { path: 'audio/' + first.id + '/analysis.json', format: 'json' },
        { path: 'audio/' + first.id + '/reference.wav', format: 'wav' },
      ],
    });
    expect(project.sections[0].segments[0]).toMatchObject({ type: 'clip', path: first.files[2].path });
    expect(second.projectPath).not.toBe(first.projectPath);
  });

  it('uses configured transcription for speech drafts without exposing credentials or costs', async () => {
    await manager.store.saveSettings(owner.userId, { model: 'google/gemini-3.8-flash', apiKey: 'fixture-secret' });
    const task = await wait(await call({ audio_path: 'recording.wav', language: 'yue-Hant-HK' }));
    const project = await loadProject(owner.workspace, task.projectPath!);
    expect(project.sections[0].segments[0]).toMatchObject({ type: 'speech', text: '同學請留意下一題。' });
    expect(task.usage).toHaveLength(2);
    expect(JSON.stringify(agentTask(task))).not.toMatch(/fixture-secret|costUsd|usage/);
  });

  it('rejects missing input, explicit speech without a key and cross-owner access', async () => {
    await expect(call({})).rejects.toThrow('INVALID_REQUEST');
    await expect(call({ audio_path: 'recording.wav', mode: 'speech' })).rejects.toThrow('AUDIO_KEY_REQUIRED');
    const task = await wait(await call({ audio_path: 'recording.wav' }));
    await expect(
      manager.command(
        { ...owner, userId: 'other' },
        'analyze_reference_audio',
        { action: 'status', task_id: task.id },
        new AbortController().signal
      )
    ).rejects.toThrow('AUDIO_TASK_NOT_FOUND');
  });

  it('cancels analysis on parent Stop and publishes no draft or copied source', async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    silences.mockImplementation(async (_file?: unknown, _options?: unknown, signal?: AbortSignal) => {
      entered();
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('AUDIO_CANCELLED')), { once: true })
      );
      return [];
    });
    const task = await call({ audio_path: 'recording.wav' });
    await started;
    await manager.parentStop(owner, 'thread', 'turn');
    await manager.close();
    expect(await call({ action: 'status', task_id: task.id })).toMatchObject({ status: 'cancelled', files: [] });
    expect(await readdir(owner.workspace)).toEqual(['recording.wav']);
    expect(await readdir(path.join(root, 'audio', 'work'))).toEqual([]);
  });

  it('fails cleanly for silence and leaves existing files untouched', async () => {
    silences.mockResolvedValue([{ start: 0, end: 12 }]);
    const task = await wait(await call({ audio_path: 'recording.wav' }));
    expect(task).toMatchObject({ status: 'failed', error: 'AUDIO_NO_SPEECH', files: [] });
    expect(await readFile(path.join(owner.workspace, 'recording.wav'), 'utf8')).toBe('original');
  });
});
