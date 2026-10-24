import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { AUTOSAVE_MS, useProjectDraft } from '@/renderer/pages/listening/editing/useProjectDraft';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));

const project: ListeningProject = {
  version: 1,
  title: 'Unit',
  defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
  lexicon: [],
  sections: [
    { id: 's1', plays: 1, gapBetweenPlays: 5, gapAfter: 3, segments: [{ id: 'a', type: 'speech', text: '早晨' }] },
  ],
};
const state = (revision: string, value: ListeningProject = project) => ({
  path: 'listening/unit.listening.json',
  revision,
  project: value,
  qaThreshold: 0.9,
  segments: {},
  tasks: [],
});
const target = { conversation_id: 'c1', path: 'listening/unit.listening.json' };
const saves = () => transport.request.mock.calls.filter(([method]) => method === 'PUT');
/** Let pending promises and zero-delay timers run under fake timers. */
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const retitle = (title: string) => (current: ListeningProject) => ({ ...current, title });

describe('useProjectDraft', () => {
  let revision = 1;
  beforeEach(() => {
    vi.useFakeTimers();
    revision = 1;
    transport.request
      .mockReset()
      .mockImplementation(async (method: string, _path: string, body?: { project: ListeningProject }) => {
        if (method === 'PUT') return state(`r${++revision}`, body!.project);
        return state(`r${revision}`);
      });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const mount = async () => {
    const onError = vi.fn();
    const hook = renderHook(() => useProjectDraft(target, onError));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await settle();
    expect(hook.result.current.draft?.title).toBe('Unit');
    return hook;
  };

  it('autosaves once after edits settle for 1.5 seconds', async () => {
    const { result } = await mount();
    act(() => result.current.edit(retitle('A')));
    expect(result.current.saveState).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    act(() => result.current.edit(retitle('AB')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1);
    });
    expect(saves()).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(saves()).toHaveLength(1);
    expect(saves()[0][2]).toMatchObject({ revision: 'r1', project: { title: 'AB' } });
    await settle();
    expect(result.current.saveState).toBe('saved');
  });

  it('undoes and redoes edits, including after an autosave', async () => {
    const { result } = await mount();
    act(() => result.current.edit(retitle('A')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    await settle();
    expect(result.current.saveState).toBe('saved');
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draft?.title).toBe('Unit');
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.draft?.title).toBe('A');
  });

  it('does not save a draft with a blank line and reports it', async () => {
    const { result } = await mount();
    act(() =>
      result.current.edit((current) => ({
        ...current,
        sections: [{ ...current.sections[0], segments: [{ id: 'a', type: 'speech', text: ' ' }] }],
      }))
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    expect(saves()).toHaveLength(0);
    expect(result.current.saveState).toBe('error');
  });

  it('stops autosaving after a conflict and clears undo history on reload', async () => {
    const { result } = await mount();
    transport.request.mockImplementation(async (method: string, path: string) => {
      if (method === 'PUT')
        throw new BackendHttpError({ method, path, status: 409, body: { error: { code: 'AUDIO_PROJECT_CONFLICT' } } });
      return state('r9', { ...project, title: 'Agent' });
    });
    act(() => result.current.edit(retitle('A')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    await settle();
    expect(result.current.saveState).toBe('conflict');
    act(() => result.current.edit(retitle('AB')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    });
    expect(saves()).toHaveLength(1);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.draft?.title).toBe('Agent');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.saveState).toBe('saved');
  });

  it('saves immediately on flush', async () => {
    const { result } = await mount();
    act(() => result.current.edit(retitle('A')));
    let flushed = false;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(saves()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 2);
    });
    expect(saves()).toHaveLength(1);
  });

  it('keeps the draft base revision when a background poll finds an external edit', async () => {
    const { result } = await mount();
    act(() => result.current.edit(retitle('')));
    transport.request.mockImplementation(async (method: string, path: string, body?: { revision: string }) => {
      if (method === 'PUT') {
        if (body?.revision === 'r1')
          throw new BackendHttpError({
            method,
            path,
            status: 409,
            body: { error: { code: 'AUDIO_PROJECT_CONFLICT' } },
          });
        return state('r10', { ...project, title: 'Teacher' });
      }
      return state('r9', { ...project, title: 'Agent' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    act(() => result.current.edit(retitle('Teacher')));
    await act(async () => {
      await result.current.flush();
    });
    expect(saves()[0][2]).toMatchObject({ revision: 'r1' });
    expect(result.current.conflict).toBe(true);
    expect(result.current.draft?.title).toBe('Teacher');
  });

  it('waits for an in-flight autosave before generating the saved revision', async () => {
    const { result } = await mount();
    const submitted = { ...project, title: 'Teacher' };
    let release: () => void = () => {};
    transport.request.mockImplementation(async (method: string, path: string) => {
      if (method === 'PUT')
        return new Promise((resolve) => {
          release = () => resolve(state('r2', submitted));
        });
      if (String(path).endsWith('/segments/generate')) return { taskId: 'g1', state: state('r2', submitted) };
      return state('r1');
    });
    act(() => result.current.edit(retitle('Teacher')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_MS);
    });
    let generation: Promise<string | undefined>;
    act(() => {
      generation = result.current.generate(['a']);
    });
    expect(saves()).toHaveLength(1);
    await act(async () => {
      release();
      await generation;
    });
    expect(
      transport.request.mock.calls.find(([, path]) => String(path).endsWith('/segments/generate'))?.[2]
    ).toMatchObject({ revision: 'r2', segment_ids: ['a'] });
  });
});
