import { useCallback, useState } from 'react';
import type React from 'react';

export const ZOOM = { MIN_PX_PER_SEC: 2, MAX_PX_PER_SEC: 400, DEFAULT_PX_PER_SEC: 40 } as const;

const clamp = (value: number): number => Math.min(ZOOM.MAX_PX_PER_SEC, Math.max(ZOOM.MIN_PX_PER_SEC, value));

/** Timeline scale in pixels per second; Ctrl/⌘ + wheel zooms, plain wheel is left to scrolling. */
export function useZoom(): {
  pxPerSec: number;
  setPxPerSec: (value: number) => void;
  onWheel: (event: React.WheelEvent) => void;
} {
  const [pxPerSec, setValue] = useState<number>(ZOOM.DEFAULT_PX_PER_SEC);
  const setPxPerSec = useCallback((value: number) => setValue(clamp(value)), []);
  const onWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setValue((current) => clamp(current * Math.exp(-event.deltaY / 300)));
  }, []);
  return { pxPerSec, setPxPerSec, onWheel };
}
