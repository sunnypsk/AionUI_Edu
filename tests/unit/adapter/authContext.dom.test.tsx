import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  Reflect.deleteProperty(window, 'electronAPI');
});
import { AuthProvider, useAuth } from '@/renderer/hooks/context/AuthContext';

let session: ReturnType<typeof useAuth>;
function Consumer() {
  session = useAuth();
  return <span>{session.status}</span>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('session refresh during throttling', () => {
  it('keeps a known user signed in on 429 and retries after Retry-After', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ success: true, user: { id: 'teacher', username: 'Teacher' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(Response.json({ success: true, user: { id: 'teacher', username: 'Teacher' } }));
    vi.stubGlobal('fetch', request);
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      );
    });
    await act(async () => {
      await session.refresh();
    });
    expect(session.status).toBe('authenticated');
    expect(session.user?.id).toBe('teacher');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6999);
    });
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('keeps the initial check pending during a backend outage and cancels retries on unmount', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', request);
    let unmount!: () => void;
    await act(async () => {
      ({ unmount } = render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      ));
    });
    expect(session.status).toBe('checking');
    expect(session.ready).toBe(false);
    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
