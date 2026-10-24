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
});
