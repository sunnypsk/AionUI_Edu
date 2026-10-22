/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { clearFrame, KIND, rasterFloor, rasterRig, rasterShadow, type Frame, type PxRect } from './raster';
import { buildRig, itemRig } from './rigs';
import { depthFade, depthScale, projectGround, RIG_TO_WORLD, type Stage } from './stage';
import type { Emote, EmoteKind, Item, ItemKind, Pet, PetPose, Species, World } from './types';
import { HOP_S } from './world';

/** Peak hop height in rig units. */
const HOP_HEIGHT = 11;
const SHADOW_PEAK = 0.32;
const EMOTE_BASE_PX = 22;
const EMOTE_MIN_PX = 12;

export type HitBox =
  | { type: 'pet'; id: string; kind: Species; rect: PxRect }
  | { type: 'item'; id: string; kind: ItemKind; rect: PxRect };

export type EmoteGlyph = { kind: EmoteKind; text: string; x: number; y: number; size: number; alpha: number };

export type SceneOutput = {
  /** Screen boxes in drawing order, so later boxes are in front. */
  boxes: HitBox[];
  emotes: EmoteGlyph[];
};

export const petPose = (pet: Pet): PetPose => {
  if (pet.activity === 'sleep') return 'lie';
  if (pet.arrived && pet.activity === 'eat') return 'eat';
  if (pet.arrived && pet.activity === 'poo') return 'squat';
  return pet.moving ? 'walk' : 'sit';
};

const eyesClosed = (pet: Pet): boolean => {
  if (pet.activity === 'sleep') return true;
  if (pet.activity === 'groom') return pet.age % 2.4 < 1.2;
  return pet.activity === 'love' && pet.age % 1.4 < 0.9;
};

/** 0 on the ground, rising to 1 halfway through a hop. */
export const hopLift = (hop: number): number => (hop > 0 ? Math.sin((Math.PI * (HOP_S - hop)) / HOP_S) : 0);

const drawPet = (frame: Frame, stage: Stage, pet: Pet): HitBox => {
  const ground = projectGround(stage, pet.x, pet.d);
  const fade = depthFade(pet.d);
  const pxr = ground.pxPerUnit * RIG_TO_WORLD;
  const rig = buildRig(pet.species, {
    pose: petPose(pet),
    phase: pet.phase,
    age: pet.age,
    eyesClosed: eyesClosed(pet),
  });
  const lift = hopLift(pet.hop);
  const shrink = 1 - 0.45 * lift;
  const shadowW = rig.w * 0.42 * pxr * shrink;
  rasterShadow(frame, ground.sx, ground.sy, shadowW, shadowW / 6, SHADOW_PEAK * fade, fade);
  const rect = rasterRig(frame, rig, {
    left: ground.sx - (rig.w / 2) * pxr,
    top: ground.sy - (rig.h + lift * HOP_HEIGHT) * pxr,
    pxPerUnit: pxr,
    dir: pet.dir,
    fade,
    kind: KIND[pet.species],
  });
  return { type: 'pet', id: pet.id, kind: pet.species, rect };
};

const drawItem = (frame: Frame, stage: Stage, item: Item): HitBox => {
  const ground = projectGround(stage, item.x, item.d);
  const fade = depthFade(item.d);
  const rig = itemRig(item.kind);
  const scale = item.kind === 'food' ? 0.45 + 0.55 * Math.max(0, item.amount) : 1;
  const pxr = ground.pxPerUnit * RIG_TO_WORLD * scale;
  const lifted = ground.pxPerUnit * item.z;
  if (item.heldBy === null || item.heldBy === 'pointer') {
    const shadowW = (rig.w * 0.55 * pxr) / (1 + item.z / 120);
    rasterShadow(frame, ground.sx, ground.sy, shadowW, shadowW / 4, SHADOW_PEAK * fade, fade);
  }
  const rect = rasterRig(frame, rig, {
    left: ground.sx - (rig.w / 2) * pxr,
    top: ground.sy - lifted - rig.h * pxr,
    pxPerUnit: pxr,
    dir: 1,
    fade,
    kind: KIND[item.kind],
  });
  return { type: 'item', id: item.id, kind: item.kind, rect };
};

const emoteText = (emote: Emote): string => {
  switch (emote.kind) {
    case 'love':
      return '<3';
    case 'sleep':
      return emote.age < emote.life / 2 ? 'z' : 'zZ';
    case 'alert':
      return '!';
    case 'hungry':
      return '?';
    default:
      return '*';
  }
};

const placeEmote = (stage: Stage, emote: Emote): EmoteGlyph => {
  const ground = projectGround(stage, emote.x, emote.d);
  const fadeIn = Math.min(1, emote.age / 0.15);
  const fadeOut = Math.min(1, (emote.life - emote.age) / 0.5);
  return {
    kind: emote.kind,
    text: emoteText(emote),
    x: ground.sx,
    y: ground.sy - (emote.lift + emote.age * 24) * ground.pxPerUnit,
    size: Math.max(EMOTE_MIN_PX, Math.round(EMOTE_BASE_PX * depthScale(emote.d))),
    // Emotes stay brighter than the depth haze so reactions read at any distance.
    alpha: Math.max(0, (0.6 + 0.4 * depthFade(emote.d)) * fadeIn * fadeOut),
  };
};

type Drawable = { depth: number; draw: () => HitBox };

/** Paints the floor, shadows, pets and items far to near and lays out the emotes. */
export const renderScene = (frame: Frame, stage: Stage, world: World): SceneOutput => {
  clearFrame(frame);
  rasterFloor(frame, stage);
  const drawables: Drawable[] = [];
  for (const pet of world.pets) {
    if (pet.present) drawables.push({ depth: pet.d, draw: () => drawPet(frame, stage, pet) });
  }
  for (const item of world.items) {
    // A dragged toy floats above everything else.
    const depth = item.heldBy === 'pointer' ? -Infinity : item.d;
    drawables.push({ depth, draw: () => drawItem(frame, stage, item) });
  }
  drawables.sort((a, b) => b.depth - a.depth);
  return {
    boxes: drawables.map((entry) => entry.draw()),
    emotes: world.emotes.map((emote) => placeEmote(stage, emote)),
  };
};
