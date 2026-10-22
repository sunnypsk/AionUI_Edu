/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { hitPart, type Rig } from './rigs';
import { D_FAR, D_NEAR, depthFade, floorHalfWidth, projectGround, type Stage } from './stage';

export const RAMP = ' .:-=+*#%@';

/** What a sub-pixel shows; the engine colors each kind separately. */
export const KIND = { none: 0, floor: 1, shadow: 2, cat: 3, dog: 4, food: 5, poo: 6, ball: 7, bone: 8 } as const;
export const KIND_COUNT = 9;

const EMPTY = 0.02;
/** A bright rim keeps silhouettes readable even where the body is in shade. */
const RIM_VALUE = 0.82;
const MIN_LIT = 0.16;
const LIGHT_LEN = Math.hypot(-0.45, -0.7, 0.55);
const LIGHT: readonly [number, number, number] = [-0.45 / LIGHT_LEN, -0.7 / LIGHT_LEN, 0.55 / LIGHT_LEN];
const FLOOR_X_STEP = 60;
const FLOOR_D_STEP = 0.1;
const FLOOR_VALUE = 0.12;

/**
 * Character grid where every cell stacks two square sub-pixels (cells are twice as tall as wide).
 * Sub-pixel row `r2` of column `c` lives at `r2 * cols + c`.
 */
export type Frame = {
  cols: number;
  rows: number;
  cellW: number;
  value: Float32Array;
  kind: Uint8Array;
  fade: Float32Array;
};

export type PxRect = { l: number; t: number; r: number; b: number };

export type RigPlacement = { left: number; top: number; pxPerUnit: number; dir: 1 | -1; fade: number; kind: number };

export const createFrame = (cols: number, rows: number, cellW: number): Frame => {
  const size = cols * rows * 2;
  return { cols, rows, cellW, value: new Float32Array(size), kind: new Uint8Array(size), fade: new Float32Array(size) };
};

export const clearFrame = (frame: Frame): void => {
  frame.value.fill(0);
  frame.kind.fill(0);
  frame.fade.fill(0);
};

let scratchValue = new Float32Array(0);
let scratchFilled = new Uint8Array(0);

const prepareScratch = (size: number): void => {
  if (scratchValue.length < size) {
    scratchValue = new Float32Array(size);
    scratchFilled = new Uint8Array(size);
    return;
  }
  scratchFilled.fill(0, 0, size);
};

/** Lights the rig like rounded volumes and writes it over whatever is behind; returns its screen box. */
export const rasterRig = (frame: Frame, rig: Rig, place: RigPlacement): PxRect => {
  const { cols, rows, cellW } = frame;
  const rect = {
    l: place.left,
    t: place.top,
    r: place.left + rig.w * place.pxPerUnit,
    b: place.top + rig.h * place.pxPerUnit,
  };
  const c0 = Math.max(0, Math.floor(rect.l / cellW));
  const c1 = Math.min(cols - 1, Math.ceil(rect.r / cellW));
  const r0 = Math.max(0, Math.floor(rect.t / cellW));
  const r1 = Math.min(rows * 2 - 1, Math.ceil(rect.b / cellW));
  const lw = c1 - c0 + 1;
  const lh = r1 - r0 + 1;
  if (lw <= 0 || lh <= 0 || place.pxPerUnit <= 0) return rect;
  prepareScratch(lw * lh);
  for (let y = 0; y < lh; y++) {
    const uy = ((r0 + y + 0.5) * cellW - place.top) / place.pxPerUnit;
    for (let x = 0; x < lw; x++) {
      const raw = ((c0 + x + 0.5) * cellW - place.left) / place.pxPerUnit;
      const ux = place.dir < 0 ? rig.w - raw : raw;
      for (let j = rig.parts.length - 1; j >= 0; j--) {
        const part = rig.parts[j];
        const n = hitPart(part, ux, uy);
        if (!n) continue;
        if (!part.hole) {
          const nx = place.dir < 0 ? -n[0] : n[0];
          const diffuse = Math.max(0, nx * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
          scratchValue[y * lw + x] = Math.min(1, Math.pow(0.12 + 0.88 * diffuse, 0.75) * part.tint);
          scratchFilled[y * lw + x] = 1;
        }
        break;
      }
    }
  }
  const filledAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < lw && y < lh && scratchFilled[y * lw + x] === 1;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const li = y * lw + x;
      if (scratchFilled[li] !== 1) continue;
      const edge = !filledAt(x - 1, y) || !filledAt(x + 1, y) || !filledAt(x, y - 1) || !filledAt(x, y + 1);
      const lit = edge ? Math.max(scratchValue[li], RIM_VALUE) : scratchValue[li];
      const i = (r0 + y) * cols + (c0 + x);
      frame.value[i] = Math.max(MIN_LIT, lit) * place.fade;
      frame.kind[i] = place.kind;
      frame.fade[i] = place.fade;
    }
  }
  return rect;
};

/** Soft elliptical shadow on the floor; it never covers bodies drawn earlier. */
export const rasterShadow = (
  frame: Frame,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  peak: number,
  fade: number
): void => {
  if (rx <= 0 || ry <= 0) return;
  const { cols, rows, cellW } = frame;
  const c0 = Math.max(0, Math.floor((cx - rx) / cellW));
  const c1 = Math.min(cols - 1, Math.ceil((cx + rx) / cellW));
  const r0 = Math.max(0, Math.floor((cy - ry) / cellW));
  const r1 = Math.min(rows * 2 - 1, Math.ceil((cy + ry) / cellW));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const nx = ((c + 0.5) * cellW - cx) / rx;
      const ny = ((r + 0.5) * cellW - cy) / ry;
      const q = nx * nx + ny * ny;
      if (q > 1) continue;
      const i = r * cols + c;
      const v = peak * Math.pow(1 - q, 0.6);
      if (frame.kind[i] > KIND.shadow || v <= frame.value[i]) continue;
      frame.value[i] = v;
      frame.kind[i] = KIND.shadow;
      frame.fade[i] = fade;
    }
  }
};

/** Sparse dots on the floor that bunch up toward the horizon to sell the perspective. */
export const rasterFloor = (frame: Frame, stage: Stage): void => {
  const { cols, rows, cellW } = frame;
  for (let d = D_NEAR; d <= D_FAR + 1e-6; d += FLOOR_D_STEP) {
    const fade = depthFade(d);
    const half = floorHalfWidth(stage.xLimit, d);
    for (let x = -Math.floor(half / FLOOR_X_STEP) * FLOOR_X_STEP; x <= half + 1e-6; x += FLOOR_X_STEP) {
      const p = projectGround(stage, x, d);
      const c = Math.floor(p.sx / cellW);
      const r = Math.floor(p.sy / cellW);
      if (c < 0 || c >= cols || r < 0 || r >= rows * 2) continue;
      const i = r * cols + c;
      if (frame.kind[i] !== KIND.none) continue;
      frame.value[i] = FLOOR_VALUE;
      frame.kind[i] = KIND.floor;
      frame.fade[i] = fade;
    }
  }
};

/** Picks the character for a cell from its top and bottom sub-pixels; '' means leave it blank. */
export const cellChar = (top: number, bottom: number): string => {
  const hasTop = top >= EMPTY;
  const hasBottom = bottom >= EMPTY;
  if (hasTop && hasBottom) {
    const level = Math.floor(((top + bottom) / 2) * RAMP.length);
    return RAMP[Math.max(1, Math.min(RAMP.length - 1, level))];
  }
  if (hasTop) return top > 0.55 ? '"' : "'";
  if (hasBottom) return bottom > 0.55 ? ',' : '.';
  return '';
};

/** Visits every non-blank cell with its character and the kind and depth fade of its brighter half. */
export const forEachGlyph = (
  frame: Frame,
  mask: Float32Array,
  visit: (col: number, row: number, ch: string, kind: number, fade: number) => void
): void => {
  const { cols, rows, value, kind, fade } = frame;
  const hasMask = mask.length === cols * rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const top = 2 * row * cols + col;
      const bottom = top + cols;
      const m = hasMask ? mask[row * cols + col] : 1;
      const a = value[top] * m;
      const b = value[bottom] * m;
      const ch = cellChar(a, b);
      if (!ch) continue;
      const main = a >= b ? top : bottom;
      visit(col, row, ch, kind[main], fade[main]);
    }
  }
};
