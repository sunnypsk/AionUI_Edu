import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpecialists } from '@/renderer/pages/conversation/platforms/acp/SpecialistTasks/useSpecialists';
import type { SpecialistTask } from '@/common/types/platform/specialists';

const fixture = vi.hoisted(() => ({
  mutate: vi.fn().mockResolvedValue([]),
  stream: undefined as ((event: { conversation_id: string; type: string }) => void) | undefined,
  reconnect: undefined as (() => void) | undefined,
  offStream: vi.fn(),
  offReconnect: vi.fn(),
  swr: vi.fn(),
}));
vi.mock('swr', () => ({ default: fixture.swr }));
vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: (callback: typeof fixture.stream) => {
          fixture.stream = callback;
          return fixture.offStream;
        },
      },
    },
    realtime: {
      reconnected: {
        on: (callback: typeof fixture.reconnect) => {
          fixture.reconnect = callback;
          return fixture.offReconnect;
        },
      },
    },
  },
}));

describe('specialist polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fixture.swr.mockReturnValue({ data: [], error: undefined, mutate: fixture.mutate });
    fixture.mutate.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('polls idle conversations less often while keeping active background tasks responsive', () => {
    renderHook(() => useSpecialists('conversation-a'));
    const options = fixture.swr.mock.calls[0][2] as { refreshInterval: (tasks?: SpecialistTask[]) => number };
    expect(options.refreshInterval([])).toBe(30000);
    expect(options.refreshInterval([{ runs: [{ status: 'running' }] } as SpecialistTask])).toBe(2000);
    expect(options.refreshInterval([{ runs: [{ status: 'failed' }] } as SpecialistTask])).toBe(30000);
  });

  it('coalesces task activity and reconnects, ignoring another conversation', async () => {
    renderHook(() => useSpecialists('conversation-a'));
    fixture.stream?.({ conversation_id: 'conversation-b', type: 'tool_call' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fixture.mutate).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) fixture.stream?.({ conversation_id: 'conversation-a', type: 'tool_call' });
    fixture.reconnect?.();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fixture.mutate).toHaveBeenCalledTimes(1);
  });

  it('cancels pending reads and unsubscribes when switching conversation', async () => {
    const { rerender } = renderHook(({ id }) => useSpecialists(id), { initialProps: { id: 'conversation-a' } });
    fixture.stream?.({ conversation_id: 'conversation-a', type: 'tool_call' });
    rerender({ id: 'conversation-b' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fixture.mutate).not.toHaveBeenCalled();
    expect(fixture.offStream).toHaveBeenCalledTimes(1);
    expect(fixture.offReconnect).toHaveBeenCalledTimes(1);
  });

  it('handles a failed event refresh without leaving a rejected background promise', async () => {
    fixture.mutate.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useSpecialists('conversation-a'));
    fixture.reconnect?.();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    fixture.reconnect?.();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fixture.mutate).toHaveBeenCalledTimes(2);
  });
});
