/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GroundPoint } from './types';

export const D_NEAR = 1;
export const D_FAR = 2.4;
export const STAGE_HALF_WIDTH = 500;
/** World x units per depth unit, so distances and speeds feel alike in both floor directions. */
export const DEPTH_TO_X = 380;
/** World units per rig unit. */
export const RIG_TO_WORLD = 4.5;

const HORIZON_RATIO = 0.12;
const NEAR_RATIO = 0.96;
const SIDE_MARGIN_PX = 24;
/** World units of floor height that must fit between the horizon and the near edge. */
const MIN_VERTICAL_UNITS = 330;
const MAX_HALF_WIDTH = STAGE_HALF_WIDTH * 1.6;

/** Perspective floor laid over the canvas: far rows sit near the horizon, near rows at the bottom. */
export type Stage = {
  width: number;
  height: number;
  horizon: number;
  near: number;
  /** Screen px per world unit at the nearest depth. */
  k: number;
  /** Half-width of the walkable floor at the nearest depth, in world units; it widens with depth. */
  xLimit: number;
};

export type ScreenPoint = { sx: number; sy: number; pxPerUnit: number };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const createStage = (width: number, height: number): Stage => {
  const horizon = height * HORIZON_RATIO;
  const near = height * NEAR_RATIO;
  const halfPx = Math.max(1, width / 2 - SIDE_MARGIN_PX);
  const k = Math.max(0.05, Math.min(halfPx / STAGE_HALF_WIDTH, (near - horizon) / MIN_VERTICAL_UNITS));
  return { width, height, horizon, near, k, xLimit: Math.min(MAX_HALF_WIDTH, halfPx / k) };
};

export const depthScale = (d: number): number => D_NEAR / d;

export const projectGround = (stage: Stage, x: number, d: number): ScreenPoint => {
  const s = depthScale(d);
  return {
    sx: stage.width / 2 + x * stage.k * s,
    sy: stage.horizon + (stage.near - stage.horizon) * s,
    pxPerUnit: stage.k * s,
  };
};

/** Maps a screen point to the floor beneath it, or null when it lies beyond the far edge. */
export const unprojectGround = (stage: Stage, sx: number, sy: number): GroundPoint | null => {
  const span = stage.near - stage.horizon;
  if (span <= 0) return null;
  const s = (sy - stage.horizon) / span;
  if (s < depthScale(D_FAR)) return null;
  const d = clamp(D_NEAR / s, D_NEAR, D_FAR);
  return { x: (sx - stage.width / 2) / (stage.k * depthScale(d)), d };
};

/** 1 at the near edge, fading toward the horizon so distant things read as hazy. */
export const depthFade = (d: number): number => 1 - 0.55 * clamp((d - D_NEAR) / (D_FAR - D_NEAR), 0, 1);

export const groundDistance = (a: GroundPoint, b: GroundPoint): number =>
  Math.hypot(a.x - b.x, (a.d - b.d) * DEPTH_TO_X);

/** Half-width of the floor at depth `d`; it grows with depth so the floor fills the screen width at every row. */
export const floorHalfWidth = (xLimit: number, d: number): number => xLimit * (d / D_NEAR);

export const clampToFloor = (p: GroundPoint, xLimit: number): GroundPoint => {
  const d = clamp(p.d, D_NEAR, D_FAR);
  const half = floorHalfWidth(xLimit, d);
  return { x: clamp(p.x, -half, half), d };
};
