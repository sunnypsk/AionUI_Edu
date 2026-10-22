/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  EPIC_RAMP_DOWN_S,
  EPIC_RAMP_UP_S,
  stepEpic,
} from '@/renderer/pages/guid/components/AsciiBackground/asciiEngine';

describe('stepEpic', () => {
  it('builds up slowly over the ramp-up duration while idle', () => {
    expect(stepEpic(0, true, EPIC_RAMP_UP_S / 2)).toBeCloseTo(0.5);
    expect(stepEpic(0, true, EPIC_RAMP_UP_S)).toBe(1);
  });

  it('drops quickly once the page is active again', () => {
    expect(stepEpic(1, false, EPIC_RAMP_DOWN_S)).toBe(0);
    expect(stepEpic(0.5, false, EPIC_RAMP_DOWN_S / 2)).toBeCloseTo(0);
  });

  it('never goes out of the 0..1 range', () => {
    expect(stepEpic(1, true, 100)).toBe(1);
    expect(stepEpic(0, false, 100)).toBe(0);
  });
});
