import { useCallback } from 'react';
import type React from 'react';

/** Moves shorter than this many pixels count as a click. */
const CLICK_SLOP = 3;

export type DragHandlers = {
  move?: (dx: number, event: MouseEvent) => void;
  end: (dx: number, moved: boolean, event: MouseEvent) => void;
};

/** Start a mouse drag from a timeline element; window listeners follow the pointer outside the element. */
export function useTimelineDrag(disabled: boolean): (event: React.MouseEvent, handlers: DragHandlers) => void {
  return useCallback(
    (event: React.MouseEvent, handlers: DragHandlers) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      let moved = false;
      const onMove = (next: MouseEvent) => {
        const dx = next.clientX - startX;
        if (Math.abs(dx) > CLICK_SLOP) moved = true;
        handlers.move?.(dx, next);
      };
      const onUp = (next: MouseEvent) => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        handlers.end(next.clientX - startX, moved, next);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [disabled]
  );
}
