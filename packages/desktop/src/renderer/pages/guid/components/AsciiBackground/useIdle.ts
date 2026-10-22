/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Returns true once no pointer, keyboard, wheel or touch input has happened for `delayMs`. */
export const useIdle = (delayMs: number, enabled = true): boolean => {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    setIdle(false);
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), delayMs);
    };
    const onActivity = (): void => {
      setIdle(false);
      arm();
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { passive: true });
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
    };
  }, [delayMs, enabled]);

  return idle;
};
