import { useEffect, useRef } from 'react';

export type ShortcutHandlers = {
  togglePlay: () => void;
  split: () => void;
  remove: () => void;
  undo: () => void;
  redo: () => void;
  nudge: (seconds: number) => void;
  saveNow: () => void;
};

const TYPING = 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"]';

/** Whether a key event belongs to a text field or an open dialog rather than the editor. */
function ignored(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target?.isContentEditable || target?.closest?.(TYPING)) return true;
  return !!document.querySelector('.arco-modal-wrapper:not([style*="display: none"]) .arco-modal');
}

/**
 * Editor keyboard shortcuts: Space play/pause, S split, Delete remove, ⌘Z / ⇧⌘Z undo/redo,
 * ←/→ move the playhead 1 s (Shift: 5 s), ⌘S save now. Ctrl works in place of ⌘.
 */
export function useEditorShortcuts(handlers: ShortcutHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || ignored(event)) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (command && key === 'z') run(event.shiftKey ? latest.current.redo : latest.current.undo);
      else if (command && key === 's') run(latest.current.saveNow);
      else if (command || event.altKey) return;
      else if (key === ' ') run(latest.current.togglePlay);
      else if (key === 's') run(latest.current.split);
      else if (key === 'delete' || key === 'backspace') run(latest.current.remove);
      else if (key === 'arrowleft') run(() => latest.current.nudge(event.shiftKey ? -5 : -1));
      else if (key === 'arrowright') run(() => latest.current.nudge(event.shiftKey ? 5 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
