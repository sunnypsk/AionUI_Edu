import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import {
  SavedStateSession,
  getSavedStateSession,
  flushOpenUiDrafts,
} from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/useSavedState';
const api = vi.hoisted(() => ({ loadState: vi.fn(), saveState: vi.fn() }));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/api', () => api);
const initial = {
  state: {},
  revision: 0,
  program_hash: 'program-one',
  library_id: 'openui',
  library_version: '0.18.1',
};
beforeEach(() => {
  vi.useFakeTimers();
  api.loadState.mockReset().mockResolvedValue(initial);
  api.saveState
    .mockReset()
    .mockImplementation(async (_path, previous, state) => ({ ...previous, revision: previous.revision + 1, state }));
});
afterEach(() => vi.useRealTimers());
describe('saved OpenUI interaction state', () => {
  it('keeps a conflicting draft across conversation switches without sharing it with another account', async () => {
    const session = getSavedStateSession('switch-owner', '/switch-state', 'program');
    await session.reload();
    session.update({ title: 'Unsubmitted local draft' });
    api.saveState.mockRejectedValueOnce(
      new BackendHttpError({ method: 'PATCH', path: '/switch-state', status: 409, body: {} })
    );
    await expect(session.flush()).rejects.toBeDefined();
    const reopened = getSavedStateSession('switch-owner', '/switch-state', 'program');
    expect(reopened).toBe(session);
    expect(reopened.getSnapshot()).toMatchObject({ error: 'conflict', restored: { title: 'Unsubmitted local draft' } });
    const other = getSavedStateSession('another-owner', '/switch-state', 'program');
    expect(other.current()).toEqual({});
  });
  it('waits for the account draft save before allowing the new conversation to render', async () => {
    const session = getSavedStateSession('navigation-owner', '/navigation-state', 'program');
    await session.reload();
    let finish: (value: typeof initial) => void = vi.fn();
    api.saveState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    session.update({ topic: 'Poetry' });
    const ready = vi.fn();
    const flushing = flushOpenUiDrafts('navigation-owner').then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finish({ ...initial, state: { topic: 'Poetry' } });
    await flushing;
    expect(ready).toHaveBeenCalledOnce();
  });
  it('restores server state and debounces field edits', async () => {
    const session = new SavedStateSession('/one');
    await session.reload();
    session.update({ grade: 'F1' });
    session.update({ grade: 'F2' });
    await vi.advanceTimersByTimeAsync(300);
    expect(api.saveState).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().saved?.state).toEqual({ grade: 'F2' });
  });
  it('flushes pending edits when leaving a message', async () => {
    const session = new SavedStateSession('/one');
    await session.reload();
    session.update({ title: 'Draft' });
    session.dispose();
    await vi.runAllTimersAsync();
    expect(api.saveState).toHaveBeenCalledWith('/one', initial, { title: 'Draft' });
  });
  it('retains a conflicting draft until the user explicitly reapplies it', async () => {
    const session = new SavedStateSession('/one');
    await session.reload();
    api.saveState.mockRejectedValueOnce(
      new BackendHttpError({ method: 'PATCH', path: '/one', status: 409, body: { code: 'OPENUI_STATE_CONFLICT' } })
    );
    session.update({ title: 'Local' });
    await expect(session.flush()).rejects.toBeDefined();
    expect(session.getSnapshot().error).toBe('conflict');
    api.loadState.mockResolvedValueOnce({ ...initial, revision: 3, state: { title: 'Other device' } });
    await session.reapply();
    expect(session.getSnapshot().saved).toMatchObject({ revision: 4, state: { title: 'Local' } });
    expect(session.getSnapshot().restored).toEqual({ title: 'Local' });
  });
  it('does not apply a previous message write to a different message session', async () => {
    const one = new SavedStateSession('/one');
    const two = new SavedStateSession('/two');
    await one.reload();
    await two.reload();
    one.update({ title: 'One' });
    await one.flush();
    expect(two.getSnapshot().saved?.state).toEqual({});
  });
  it('keeps the latest values available while a save is in flight and does not reinitialize the renderer', async () => {
    const session = new SavedStateSession('/one');
    await session.reload();
    let finish: (value: typeof initial) => void = vi.fn();
    api.saveState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    session.update({ $topic: 'Draft' });
    const write = session.flush();
    expect(session.current()).toEqual({ $topic: 'Draft' });
    finish({ ...initial, state: { $topic: 'Draft' }, revision: 1 });
    await write;
    expect(session.getSnapshot().restored).toBe(initial.state);
  });
  it('reports failed loads and leaves interactions unavailable', async () => {
    api.loadState.mockRejectedValueOnce(new Error('offline'));
    const session = new SavedStateSession('/one');
    await session.reload();
    expect(session.getSnapshot()).toEqual({ saved: null, restored: undefined, error: 'load' });
  });
});
