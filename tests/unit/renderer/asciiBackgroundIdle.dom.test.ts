/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdle } from '@/renderer/pages/guid/components/AsciiBackground/useIdle';

describe('useIdle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays active at first, then turns idle once the delay passes without input', () => {
    const { result } = renderHook(() => useIdle(1000));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(true);
  });

  it('resets to active on user input and rearms the timer', () => {
    const { result } = renderHook(() => useIdle(1000));
    act(() => void vi.advanceTimersByTime(600));
    act(() => void window.dispatchEvent(new Event('keydown')));
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current).toBe(false);
    act(() => void vi.advanceTimersByTime(400));
    expect(result.current).toBe(true);
  });

  it('never turns idle when disabled, even after the delay', () => {
    const { result } = renderHook(() => useIdle(1000, false));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(result.current).toBe(false);
  });

  it('removes its window listeners when unmounted', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useIdle(1000));
    unmount();
    const removed = removeSpy.mock.calls.map(([type]) => type);
    expect(removed).toContain('keydown');
    expect(removed).toContain('pointermove');
    removeSpy.mockRestore();
  });
});
