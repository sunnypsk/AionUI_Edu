/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createFrame } from '@/renderer/pages/guid/components/AsciiBackground/playground/raster';
import { hopLift, petPose, renderScene } from '@/renderer/pages/guid/components/AsciiBackground/playground/scene';
import { createStage } from '@/renderer/pages/guid/components/AsciiBackground/playground/stage';
import { addEmote, HOP_S } from '@/renderer/pages/guid/components/AsciiBackground/playground/world';
import { openEnv, testPet, worldWith } from './fixtures';

const setup = () => {
  const stage = createStage(800, 600);
  const frame = createFrame(Math.ceil(800 / 4), Math.ceil(600 / 8), 4);
  return { stage, frame };
};

describe('petPose', () => {
  it('matches the pose to what the pet is doing', () => {
    expect(petPose(testPet('a', 'cat', { activity: 'sleep' }))).toBe('lie');
    expect(petPose(testPet('a', 'cat', { activity: 'eat', arrived: true }))).toBe('eat');
    expect(petPose(testPet('a', 'dog', { activity: 'wander', moving: true }))).toBe('walk');
  });

  it('sits while still on the way to poo', () => {
    expect(petPose(testPet('a', 'dog', { activity: 'poo', arrived: false }))).toBe('sit');
  });
});

describe('hopLift', () => {
  it('peaks mid-hop and rests on the ground otherwise', () => {
    expect(hopLift(0)).toBe(0);
    expect(hopLift(HOP_S / 2)).toBeCloseTo(1);
  });
});

describe('renderScene', () => {
  it('draws far things first so near things end up in front', () => {
    const { stage, frame } = setup();
    const far = testPet('far', 'cat', { d: 2.2 });
    const near = testPet('near', 'dog', { d: 1.1 });
    const scene = renderScene(frame, stage, worldWith(openEnv(), [near, far]));
    expect(scene.boxes.map((b) => b.id)).toEqual(['far', 'near']);
  });

  it('draws a dragged toy on top of everything and skips pets that are away', () => {
    const { stage, frame } = setup();
    const away = testPet('away', 'cat', { present: false });
    const near = testPet('near', 'dog', { d: 1 });
    const world = worldWith(openEnv(), [away, near]);
    world.items = [
      { id: 'ball1', kind: 'ball', x: 0, d: 2, z: 0, vx: 0, vd: 0, vz: 0, amount: 1, heldBy: 'pointer', born: 0 },
    ];
    expect(renderScene(frame, stage, world).boxes.map((b) => b.id)).toEqual(['near', 'ball1']);
  });

  it('lays out emotes as readable text above the floor', () => {
    const { stage, frame } = setup();
    const world = worldWith(openEnv(), []);
    addEmote(world, 'love', 0, 1.5, 100);
    const [emote] = renderScene(frame, stage, world).emotes;
    expect(emote.text).toBe('<3');
    expect(emote.y).toBeLessThan(stage.near);
  });
});
