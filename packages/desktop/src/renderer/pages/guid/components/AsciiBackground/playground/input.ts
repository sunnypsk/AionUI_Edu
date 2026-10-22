/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HitBox } from './scene';
import type { GroundPoint } from './types';
import type { Velocity } from './world';

/** Small items get a forgiving margin so they are easy to click. */
const ITEM_HIT_PAD_PX = 8;
const VELOCITY_WINDOW_MS = 100;
const THROW_LIFT = 0.35;
const MAX_LIFT_SPEED = 350;

/** True when the event landed on the empty page background rather than on real UI. */
export const isBackgroundTarget = (target: EventTarget | null, surfaces: readonly (EventTarget | null)[]): boolean =>
  target !== null && surfaces.includes(target);

/** The front-most box under the point. */
export const hitTest = (boxes: readonly HitBox[], x: number, y: number): HitBox | null => {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    const pad = box.type === 'item' ? ITEM_HIT_PAD_PX : 0;
    const { l, t, r, b } = box.rect;
    if (x >= l - pad && x <= r + pad && y >= t - pad && y <= b + pad) return box;
  }
  return null;
};

export const cursorFor = (hit: HitBox | null, dragging: boolean): string => {
  if (dragging) return 'grabbing';
  if (!hit) return '';
  if (hit.type === 'pet' || hit.kind === 'poo') return 'pointer';
  return hit.kind === 'ball' || hit.kind === 'bone' ? 'grab' : '';
};

export type PointerSample = { t: number; sx: number; sy: number; ground: GroundPoint | null };

/** Keeps only the samples recent enough to describe the current motion. */
export const pushSample = (samples: PointerSample[], sample: PointerSample): PointerSample[] => [
  ...samples.filter((s) => sample.t - s.t <= VELOCITY_WINDOW_MS),
  sample,
];

/** Screen speed in px/s across the samples. */
export const screenSpeed = (samples: readonly PointerSample[]): number => {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? Math.hypot(last.sx - first.sx, last.sy - first.sy) / dt : 0;
};

/** Floor velocity of a release, with an upward kick so fast throws fly in an arc. */
export const throwVelocity = (samples: readonly PointerSample[], depthToX: number): Velocity => {
  const grounded = samples.filter((s): s is PointerSample & { ground: GroundPoint } => s.ground !== null);
  if (grounded.length < 2) return { vx: 0, vd: 0, vz: 0 };
  const first = grounded[0];
  const last = grounded[grounded.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vd: 0, vz: 0 };
  const vx = (last.ground.x - first.ground.x) / dt;
  const vd = (last.ground.d - first.ground.d) / dt;
  const vz = Math.min(MAX_LIFT_SPEED, Math.hypot(vx, vd * depthToX) * THROW_LIFT);
  return { vx, vd, vz };
};
