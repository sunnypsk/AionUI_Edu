/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  decideActivity,
  stepNeeds,
  type DecideContext,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/brain';
import type { Item } from '@/renderer/pages/guid/components/AsciiBackground/playground/types';
import { openEnv, testPet, worldWith } from './fixtures';

const ctx: DecideContext = { random: () => 0.99, pickSpot: () => ({ x: 10, d: 1.4 }) };

const item = (id: string, kind: Item['kind']): Item => ({
  id,
  kind,
  x: 50,
  d: 1.5,
  z: 0,
  vx: 0,
  vd: 0,
  vz: 0,
  amount: 1,
  heldBy: null,
  born: 0,
});

describe('stepNeeds', () => {
  it('restores energy while asleep and drains it while awake', () => {
    const needs = { hunger: 0, energy: 0.5, fun: 0, bladder: 0 };
    expect(stepNeeds(needs, 'sleep', 10, 'cat').energy).toBeGreaterThan(0.5);
    expect(stepNeeds(needs, 'idle', 10, 'cat').energy).toBeLessThan(0.5);
  });

  it('never leaves the 0..1 range', () => {
    const needs = stepNeeds({ hunger: 1, energy: 0, fun: 0, bladder: 1 }, 'play', 1e6, 'dog');
    expect(Object.values(needs).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('decideActivity', () => {
  it('goes to poo when the bladder is full', () => {
    const pet = testPet('a', 'cat', { needs: { hunger: 0.9, energy: 1, fun: 0, bladder: 0.9 } });
    expect(decideActivity(pet, worldWith(openEnv(), [pet]), ctx).activity).toBe('poo');
  });

  it('eats free food when hungry but skips food another pet claimed', () => {
    const cat = testPet('a', 'cat', { needs: { hunger: 0.6, energy: 1, fun: 0, bladder: 0 } });
    const dog = testPet('b', 'dog', { itemId: 'food1', activity: 'eat' });
    const world = worldWith(openEnv(), [cat]);
    world.items = [item('food1', 'food')];
    expect(decideActivity(cat, world, ctx)).toMatchObject({ activity: 'eat', itemId: 'food1' });
    world.pets.push(dog);
    expect(decideActivity(cat, world, ctx).activity).not.toBe('eat');
  });

  it('sleeps when exhausted', () => {
    const pet = testPet('a', 'dog', { needs: { hunger: 0, energy: 0.1, fun: 0.9, bladder: 0 } });
    expect(decideActivity(pet, worldWith(openEnv(), [pet]), ctx).activity).toBe('sleep');
  });

  it('plays fetch as a dog and chases the ball as a cat when bored', () => {
    const bored = { hunger: 0, energy: 1, fun: 0.8, bladder: 0 };
    const dog = testPet('a', 'dog', { needs: bored });
    const cat = testPet('b', 'cat', { needs: bored });
    const world = worldWith(openEnv(), [dog, cat]);
    world.items = [item('ball1', 'ball')];
    expect(decideActivity(dog, world, ctx).activity).toBe('fetch');
    world.items = [item('ball2', 'ball')];
    expect(decideActivity(cat, world, ctx).activity).toBe('play');
  });

  it('ignores a toy someone is holding', () => {
    const dog = testPet('a', 'dog', { needs: { hunger: 0, energy: 1, fun: 0.9, bladder: 0 } });
    const world = worldWith(openEnv(), [dog]);
    world.items = [{ ...item('ball1', 'ball'), heldBy: 'pointer' }];
    expect(decideActivity(dog, world, ctx).activity).not.toBe('fetch');
  });
});
