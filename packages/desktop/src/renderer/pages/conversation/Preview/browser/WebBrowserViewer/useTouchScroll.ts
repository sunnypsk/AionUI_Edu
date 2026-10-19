import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';

/** Convert finger swipes on the viewport into remote scrolling without clicking the page at gesture end. */
export function useTouchScroll(tabId: string | undefined, enabled: boolean, scroll: (x: number, y: number) => void) {
  const callback = useRef(scroll);
  callback.current = scroll;
  const position = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const pending = useRef({ x: 0, y: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moved = useRef(false);
  const ignoreClickUntil = useRef(0);
  const flush = (): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { x, y } = pending.current;
    pending.current = { x: 0, y: 0 };
    if (x || y)
      callback.current(Math.max(-4000, Math.min(4000, Math.round(x))), Math.max(-4000, Math.min(4000, Math.round(y))));
  };
  useLayoutEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      position.current = null;
      pending.current = { x: 0, y: 0 };
      ignoreClickUntil.current = 0;
    },
    [tabId, enabled]
  );

  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>): void => {
      if (!enabled || !tabId || event.pointerType !== 'touch') return;
      position.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY };
      moved.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>): void => {
      const previous = position.current;
      if (!enabled || event.pointerType !== 'touch' || !previous) return;
      if (Math.abs(event.clientX - previous.startX) + Math.abs(event.clientY - previous.startY) > 6)
        moved.current = true;
      if (moved.current) {
        event.preventDefault();
        pending.current.x += previous.x - event.clientX;
        pending.current.y += previous.y - event.clientY;
        if (!timer.current) timer.current = setTimeout(flush, 50);
      }
      previous.x = event.clientX;
      previous.y = event.clientY;
    },
    onPointerUp: (): void => {
      if (!position.current) return;
      flush();
      position.current = null;
      if (moved.current) ignoreClickUntil.current = Date.now() + 400;
    },
    onPointerCancel: (): void => {
      flush();
      position.current = null;
    },
    consumeClick: (): boolean => {
      const suppress = Date.now() < ignoreClickUntil.current;
      ignoreClickUntil.current = 0;
      return suppress;
    },
  };
}
