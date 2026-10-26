import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBrowserActivity } from '@/renderer/pages/conversation/Preview/browser/WebBrowserViewer/useBrowserActivity';

type State = { tabs: Array<{ id: string }> };
const stateMock = vi.hoisted(() => vi.fn<(id: string) => Promise<State>>());
vi.mock('@/renderer/pages/conversation/Preview/browser/WebBrowserViewer/api', () => ({
  browserApi: { state: stateMock },
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));

const state = (...ids: string[]): State => ({ tabs: ids.map((id) => ({ id })) });

function deferredState() {
  let resolve: (value: State) => void = () => {};
  const promise = new Promise<State>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('browser activity visibility', () => {
  let hidden: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    stateMock.mockReset().mockResolvedValue(state());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function setHidden(value: boolean) {
    hidden.mockReturnValue(value);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  it('makes no requests during five hidden minutes and refreshes once on return', async () => {
    hidden.mockReturnValue(true);
    renderHook(() => useBrowserActivity('conversation-1', true, vi.fn()));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(stateMock).not.toHaveBeenCalled();
    await setHidden(false);
    expect(stateMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stateMock).toHaveBeenCalledTimes(2);
  });

  it('cancels the scheduled read when a visible page becomes hidden', async () => {
    renderHook(() => useBrowserActivity('conversation-1', true, vi.fn()));
    await act(async () => {});
    await setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(stateMock).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a slow request when returning to the foreground', async () => {
    const pending = deferredState();
    const open = vi.fn();
    stateMock.mockReturnValueOnce(pending.promise).mockResolvedValue(state('fresh'));
    renderHook(() => useBrowserActivity('conversation-1', true, open));
    await setHidden(true);
    await setHidden(false);
    expect(stateMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(state('stale'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stateMock).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not reopen a manually collapsed preview for previously seen tabs', async () => {
    const open = vi.fn();
    stateMock.mockResolvedValue(state('tab-1'));
    renderHook(() => useBrowserActivity('conversation-1', true, open));
    await act(async () => {});
    await setHidden(true);
    await setHidden(false);
    expect(open).toHaveBeenCalledTimes(1);
    stateMock.mockResolvedValue(state('tab-1', 'tab-2'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('ignores the previous conversation response after switching', async () => {
    const pending = deferredState();
    const open = vi.fn();
    stateMock.mockReturnValueOnce(pending.promise).mockResolvedValue(state());
    const { rerender } = renderHook(({ id }) => useBrowserActivity(id, true, open), { initialProps: { id: 'old' } });
    rerender({ id: 'new' });
    await act(async () => {
      pending.resolve(state('old-tab'));
    });
    expect(open).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stateMock.mock.calls.map(([id]) => id)).toEqual(['old', 'new', 'new']);
  });

  it('retries a failed read without losing future tab detection', async () => {
    const open = vi.fn();
    stateMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(state('tab-1'));
    renderHook(() => useBrowserActivity('conversation-1', true, open));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stateMock).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does not apply results or restart polling after unmount', async () => {
    const pending = deferredState();
    const open = vi.fn();
    stateMock.mockReturnValueOnce(pending.promise);
    const { unmount } = renderHook(() => useBrowserActivity('conversation-1', true, open));
    unmount();
    await act(async () => {
      pending.resolve(state('tab-1'));
    });
    await setHidden(true);
    await setHidden(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(stateMock).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
