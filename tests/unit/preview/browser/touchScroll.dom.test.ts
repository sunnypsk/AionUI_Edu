import { act, renderHook } from '@testing-library/react';
import type { PointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTouchScroll } from '@/renderer/pages/conversation/Preview/browser/WebBrowserViewer/useTouchScroll';

const pointer = (y: number): PointerEvent<HTMLDivElement> =>
  ({
    pointerType: 'touch',
    pointerId: 1,
    clientX: 100,
    clientY: y,
    currentTarget: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
  }) as unknown as PointerEvent<HTMLDivElement>;

describe('shared browser touch scrolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces a swipe into remote scrolling and suppresses the trailing click', () => {
    const scroll = vi.fn();
    const { result } = renderHook(() => useTouchScroll('tab', true, scroll));
    act(() => {
      result.current.onPointerDown(pointer(300));
      result.current.onPointerMove(pointer(250));
      result.current.onPointerMove(pointer(200));
      vi.advanceTimersByTime(50);
      result.current.onPointerUp();
    });
    expect(scroll).toHaveBeenCalledWith(0, 100);
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });

  it('keeps taps available without scrolling the page', () => {
    const scroll = vi.fn();
    const { result } = renderHook(() => useTouchScroll('tab', true, scroll));
    act(() => {
      result.current.onPointerDown(pointer(300));
      result.current.onPointerUp();
    });
    expect(scroll).not.toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(false);
  });

  it('does not send human input while AI owns the browser', () => {
    const scroll = vi.fn();
    const { result } = renderHook(() => useTouchScroll('tab', false, scroll));
    act(() => {
      result.current.onPointerDown(pointer(300));
      result.current.onPointerMove(pointer(100));
      vi.advanceTimersByTime(100);
      result.current.onPointerUp();
    });
    expect(scroll).not.toHaveBeenCalled();
  });

  it('discards a pending swipe when switching tabs', () => {
    const scroll = vi.fn();
    const { result, rerender } = renderHook(({ tab }) => useTouchScroll(tab, true, scroll), {
      initialProps: { tab: 'first' },
    });
    act(() => {
      result.current.onPointerDown(pointer(300));
      result.current.onPointerMove(pointer(100));
    });
    rerender({ tab: 'second' });
    act(() => vi.advanceTimersByTime(100));
    expect(scroll).not.toHaveBeenCalled();
  });
});
