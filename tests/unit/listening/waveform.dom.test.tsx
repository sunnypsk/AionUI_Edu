import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { Waveform } from '@/renderer/pages/listening/timeline/Waveform';
import { useZoom, ZOOM } from '@/renderer/pages/listening/timeline/useZoom';

describe('Waveform', () => {
  afterEach(cleanup);

  it('draws one bar per visible pixel column of the selected source window', () => {
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect,
      set fillStyle(_value: string) {},
    } as unknown as CanvasRenderingContext2D);
    const peaks = { bucketMs: 10, min: new Int8Array(1000).fill(-64), max: new Int8Array(1000).fill(64) };
    render(<Waveform peaks={peaks} start={2} end={4} width={50} height={20} />);
    expect(fillRect).toHaveBeenCalledTimes(50);
    // Half-scale peaks fill half the height, centred.
    expect(fillRect.mock.calls[0].slice(1)).toEqual([5, 1, 10]);
  });

  it('draws nothing until peaks arrive', () => {
    const fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D);
    render(<Waveform start={0} end={1} width={50} height={20} />);
    expect(fillRect).not.toHaveBeenCalled();
  });
});

describe('useZoom', () => {
  it('zooms with Ctrl or Cmd and the wheel, clamped to the allowed range', () => {
    const { result } = renderHook(() => useZoom());
    expect(result.current.pxPerSec).toBe(ZOOM.DEFAULT_PX_PER_SEC);
    const wheel = (deltaY: number, modifier: boolean) =>
      act(() =>
        result.current.onWheel({ deltaY, ctrlKey: modifier, metaKey: false, preventDefault: vi.fn() } as never)
      );
    wheel(-100, false);
    expect(result.current.pxPerSec).toBe(ZOOM.DEFAULT_PX_PER_SEC);
    wheel(-100, true);
    expect(result.current.pxPerSec).toBeGreaterThan(ZOOM.DEFAULT_PX_PER_SEC);
    act(() => result.current.setPxPerSec(10000));
    expect(result.current.pxPerSec).toBe(ZOOM.MAX_PX_PER_SEC);
    act(() => result.current.setPxPerSec(0));
    expect(result.current.pxPerSec).toBe(ZOOM.MIN_PX_PER_SEC);
  });
});
