/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ItemKind, PetPose, Species } from './types';

export type RigPart =
  | { k: 'e'; cx: number; cy: number; rx: number; ry: number; tint: number; hole: boolean }
  | { k: 'c'; x1: number; y1: number; x2: number; y2: number; r: number; tint: number; hole: false }
  | { k: 't'; ax: number; ay: number; bx: number; by: number; cx: number; cy: number; tint: number; hole: false };

export type RigPoint = { x: number; y: number };

/** Shapes in rig units facing right, with the floor at `y = h`. Later parts are in front. */
export type Rig = { w: number; h: number; parts: RigPart[]; mouth: RigPoint; crown: RigPoint };

export type RigInput = { pose: PetPose; phase: number; age: number; eyesClosed: boolean };

export type Normal = readonly [number, number, number];

/** Legs on the far side of the body sit in shade. */
const FAR_TINT = 0.55;
/** Flat triangles (ears) are shaded as if tilted toward the light. */
const TRIANGLE_NORMAL: Normal = [-0.2, -0.45, 0.87];

const ellipse = (cx: number, cy: number, rx: number, ry: number, tint = 1): RigPart => ({
  k: 'e',
  cx,
  cy,
  rx,
  ry,
  tint,
  hole: false,
});

const hole = (cx: number, cy: number, rx: number, ry: number): RigPart => ({
  k: 'e',
  cx,
  cy,
  rx,
  ry,
  tint: 0,
  hole: true,
});

const capsule = (x1: number, y1: number, x2: number, y2: number, r: number, tint = 1): RigPart => ({
  k: 'c',
  x1,
  y1,
  x2,
  y2,
  r,
  tint,
  hole: false,
});

const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, tint = 1): RigPart => ({
  k: 't',
  ax,
  ay,
  bx,
  by,
  cx,
  cy,
  tint,
  hole: false,
});

/** Returns the surface normal where the point lies inside the part, treating it as a rounded volume. */
export const hitPart = (p: RigPart, x: number, y: number): Normal | null => {
  if (p.k === 'e') {
    const nx = (x - p.cx) / p.rx;
    const ny = (y - p.cy) / p.ry;
    const q = nx * nx + ny * ny;
    return q <= 1 ? [nx, ny, Math.sqrt(1 - q)] : null;
  }
  if (p.k === 'c') {
    const vx = p.x2 - p.x1;
    const vy = p.y2 - p.y1;
    const len = vx * vx + vy * vy;
    const t = len ? Math.min(1, Math.max(0, ((x - p.x1) * vx + (y - p.y1) * vy) / len)) : 0;
    const dx = (x - (p.x1 + vx * t)) / p.r;
    const dy = (y - (p.y1 + vy * t)) / p.r;
    const q = dx * dx + dy * dy;
    return q <= 1 ? [dx, dy, Math.sqrt(1 - q)] : null;
  }
  const side = (ax: number, ay: number, bx: number, by: number): number => (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d1 = side(p.ax, p.ay, p.bx, p.by);
  const d2 = side(p.bx, p.by, p.cx, p.cy);
  const d3 = side(p.cx, p.cy, p.ax, p.ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return hasNeg && hasPos ? null : TRIANGLE_NORMAL;
};

const curve = (segments: number, at: (u: number) => RigPoint): RigPoint[] =>
  Array.from({ length: segments + 1 }, (_, i) => at(i / segments));

const addChain = (parts: RigPart[], points: RigPoint[], r: number, tint: number): void => {
  for (let i = 1; i < points.length; i++) {
    parts.push(capsule(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, r, tint));
  }
};

const addEye = (parts: RigPart[], x: number, y: number, closed: boolean): void => {
  if (closed) {
    parts.push(hole(x, y, 1.5, 0.55));
    return;
  }
  parts.push(hole(x, y, 1.35, 1.9), ellipse(x + 0.45, y - 0.8, 0.5, 0.5));
};

const catRig = ({ pose, phase, age, eyesClosed }: RigInput): Rig => {
  const parts: RigPart[] = [];
  const walking = pose === 'walk';
  const lying = pose === 'lie';
  const bob = walking ? Math.abs(Math.sin(phase)) * 0.7 : lying ? Math.sin(age * 1.6) * 0.25 : 0;
  const head = lying ? { x: 29, y: 19.6 } : pose === 'eat' ? { x: 31, y: 18.4 } : { x: 29, y: 11.2 + bob };
  const hindTop = pose === 'squat' ? 23 : 20;
  const leg = (hx: number, top: number, offset: number, r: number, tint: number): void => {
    const swing = walking ? Math.sin(phase + offset) * 2.6 : 0;
    parts.push(capsule(hx, top + bob, hx + swing, 26.2, r, tint), ellipse(hx + swing + 0.8, 26.4, r + 0.5, 1.3, tint));
  };
  if (!lying) {
    leg(15, hindTop, Math.PI, 2, FAR_TINT);
    leg(25.5, 20, 0, 2, FAR_TINT);
  }
  const wag = Math.sin(age * (walking ? 4 : 1.5)) * 0.5;
  const tailBase = (pose === 'squat' ? 19.5 : 18) + bob;
  const tail = lying
    ? curve(8, (u) => ({ x: 7 + 10 * u, y: 23.5 + 3.4 * u - 1.6 * Math.sin(Math.PI * u) }))
    : curve(10, (u) => ({ x: 8 - 5.5 * u + wag * 4 * u * u, y: tailBase - 11 * u + 3 * u * u }));
  addChain(parts, tail, 1.8, 0.85);
  if (lying) parts.push(ellipse(17.5, 23 + bob, 11, 4.6));
  else if (pose === 'squat') parts.push(ellipse(17.5, 20.8, 10.5, 6));
  else parts.push(ellipse(17.5, 19.5 + bob, 10.5, 6));
  if (lying) {
    parts.push(ellipse(24.5, 27, 2.4, 1.2), ellipse(28.5, 27.2, 2.4, 1.2));
  } else {
    leg(12.5, hindTop, 0, 2.1, 1);
    leg(23, 20, Math.PI, 2.1, 1);
  }
  const { x: hx, y: hy } = head;
  parts.push(
    tri(hx - 7.5, hy - 2.7, hx - 6.4, hy - 10.8, hx - 1.6, hy - 7.2, 0.95),
    tri(hx + 2, hy - 7.2, hx + 6.6, hy - 10.8, hx + 7.6, hy - 2.6, 0.95),
    ellipse(hx, hy, 9, 7.8)
  );
  const closed = eyesClosed || age % 4 < 0.2;
  addEye(parts, hx - 3.2, hy - 0.2, closed);
  addEye(parts, hx + 3.4, hy - 0.2, closed);
  parts.push(ellipse(hx + 0.2, hy + 2.6, 0.95, 0.6, 0.15));
  return { w: 40, h: 28, parts, mouth: { x: hx + 0.5, y: hy + 4 }, crown: { x: hx, y: hy - 11 } };
};

const dogRig = ({ pose, phase, age, eyesClosed }: RigInput): Rig => {
  const parts: RigPart[] = [];
  const walking = pose === 'walk';
  const lying = pose === 'lie';
  const bob = walking ? Math.abs(Math.sin(phase)) * 0.8 : lying ? Math.sin(age * 1.4) * 0.25 : 0;
  const head = lying ? { x: 32.5, y: 21 } : pose === 'eat' ? { x: 34, y: 19.6 } : { x: 32, y: 12.2 + bob };
  const hindTop = pose === 'squat' ? 24 : 21;
  const leg = (hx: number, top: number, offset: number, r: number, tint: number): void => {
    const swing = walking ? Math.sin(phase + offset) * 3 : 0;
    parts.push(capsule(hx, top + bob, hx + swing, 28.2, r, tint), ellipse(hx + swing + 0.9, 28.4, r + 0.6, 1.4, tint));
  };
  if (!lying) {
    leg(16, hindTop, Math.PI, 2.2, FAR_TINT);
    leg(28, 21, 0, 2.2, FAR_TINT);
  }
  const wag = lying ? Math.sin(age * 2) * 0.6 : Math.sin(age * 11) * 2.2;
  const tailBase = (pose === 'squat' ? 19 : 17) + bob;
  parts.push(
    lying ? capsule(8, 24.5, 2.5, 26.5 + wag, 1.6, 0.85) : capsule(7.5, tailBase, 3 + wag, tailBase - 7, 1.7, 0.85)
  );
  if (lying) parts.push(ellipse(19.5, 24.6 + bob, 12, 4.8));
  else if (pose === 'squat') parts.push(ellipse(19.5, 22, 11.5, 6.6));
  else parts.push(ellipse(19.5, 20.5 + bob, 11.5, 6.6));
  if (lying) {
    parts.push(ellipse(30, 28.6, 2.8, 1.3), ellipse(35, 28.8, 2.8, 1.3));
  } else {
    leg(13.5, hindTop, 0, 2.3, 1);
    leg(25.5, 21, Math.PI, 2.3, 1);
  }
  const { x: hx, y: hy } = head;
  parts.push(
    ellipse(hx, hy, 8.6, 7.8),
    ellipse(hx + 6.6, hy + 3, 4.8, 3.4),
    ellipse(hx + 10.6, hy + 1.6, 1.5, 1.15, 0.12)
  );
  if (walking) parts.push(ellipse(hx + 7.4, hy + 6.6, 1.3, 1.7, 0.95));
  const earSwing = walking ? Math.sin(phase) * 0.7 : 0;
  parts.push(ellipse(hx - 4.6, hy + 1.2 + earSwing, 2.9, 6, 0.55));
  addEye(parts, hx + 2.4, hy - 1.6, eyesClosed || age % 5 < 0.2);
  return { w: 47, h: 30, parts, mouth: { x: hx + 8, y: hy + 5.5 }, crown: { x: hx, y: hy - 11 } };
};

export const buildRig = (species: Species, input: RigInput): Rig => (species === 'cat' ? catRig(input) : dogRig(input));

const ITEM_RIGS: Record<ItemKind, Rig> = {
  ball: {
    w: 8,
    h: 8,
    parts: [ellipse(4, 4, 3.9, 3.9), ellipse(4, 4, 3.9, 0.9, 0.6)],
    mouth: { x: 4, y: 4 },
    crown: { x: 4, y: 0 },
  },
  bone: {
    w: 15,
    h: 6,
    parts: [
      capsule(3.2, 3.2, 11.8, 3.2, 1.3),
      ellipse(2.2, 2, 1.9, 1.7),
      ellipse(2.2, 4.4, 1.9, 1.7),
      ellipse(12.8, 2, 1.9, 1.7),
      ellipse(12.8, 4.4, 1.9, 1.7),
    ],
    mouth: { x: 7.5, y: 3 },
    crown: { x: 7.5, y: 0 },
  },
  poo: {
    w: 10,
    h: 8.5,
    parts: [
      ellipse(5, 6.8, 4.6, 1.8),
      ellipse(5, 4.8, 3.4, 1.6),
      ellipse(5.1, 2.9, 2.2, 1.3),
      tri(4.2, 2, 5.6, 0.1, 6.1, 2.2),
    ],
    mouth: { x: 5, y: 4 },
    crown: { x: 5, y: 0 },
  },
  food: {
    w: 11,
    h: 5,
    parts: [
      ellipse(3, 3.4, 2.4, 1.5),
      ellipse(8, 3.5, 2.4, 1.5),
      ellipse(5.5, 2, 2.3, 1.5),
      ellipse(5.4, 3.9, 2.2, 1.1),
    ],
    mouth: { x: 5.5, y: 2.5 },
    crown: { x: 5.5, y: 0 },
  },
};

export const itemRig = (kind: ItemKind): Rig => ITEM_RIGS[kind];
