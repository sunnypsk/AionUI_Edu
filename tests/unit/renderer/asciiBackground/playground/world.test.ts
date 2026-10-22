/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { clampToFloor, groundDistance } from '@/renderer/pages/guid/components/AsciiBackground/playground/stage';
import type { Item } from '@/renderer/pages/guid/components/AsciiBackground/playground/types';
import {
  createWorld,
  dragToy,
  dropFood,
  grabToy,
  MAX_FOOD,
  MAX_POO,
  MIN_PRESENT,
  pickUpPoo,
  POO_LIFETIME_S,
  stepWorld,
  throwToy,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/world';
import { openEnv, run, seeded, testPet, worldWith } from './fixtures';

const ball = (overrides: Partial<Item> = {}): Item => ({
  id: 'ball1',
  kind: 'ball',
  x: 0,
  d: 1.2,
  z: 0,
  vx: 0,
  vd: 0,
  vz: 0,
  amount: 1,
  heldBy: null,
  born: 0,
  ...overrides,
});

const poo = (id: string, born: number): Item => ({ ...ball(), id, kind: 'poo', x: -300, born });

describe('createWorld', () => {
  it('starts with cats and dogs, some of them on stage, and one of each toy', () => {
    const world = createWorld(400, openEnv());
    expect(new Set(world.pets.map((p) => p.species))).toEqual(new Set(['cat', 'dog']));
    expect(world.pets.filter((p) => p.present).length).toBeGreaterThanOrEqual(MIN_PRESENT);
    expect(world.items.map((i) => i.kind).toSorted()).toEqual(['ball', 'bone']);
  });

  it('places pets away from blocked floor when it can', () => {
    const world = createWorld(400, { random: seeded(3), isBlocked: (p) => p.x > 0 });
    expect(world.pets.every((p) => p.x <= 0)).toBe(true);
  });
});

describe('food', () => {
  it('sends the nearest hungry pet to eat it all', () => {
    const env = openEnv();
    const cat = testPet('cat1', 'cat', { x: -100, needs: { hunger: 0.9, energy: 1, fun: 0, bladder: 0 } });
    const world = worldWith(env, [cat]);
    dropFood(world, { x: 100, d: 1.5 });
    expect(cat.activity).toBe('eat');
    run(world, env, 30, () => !world.items.some((i) => i.kind === 'food'));
    expect(world.items.some((i) => i.kind === 'food')).toBe(false);
    expect(cat.needs.hunger).toBeLessThan(0.3);
  });

  it('leaves the food alone when nobody is hungry', () => {
    const env = openEnv();
    const cat = testPet('cat1', 'cat', { needs: { hunger: 0.05, energy: 1, fun: 0, bladder: 0 } });
    const world = worldWith(env, [cat]);
    dropFood(world, { x: 100, d: 1.5 });
    expect(cat.activity).not.toBe('eat');
  });

  it('keeps at most a few servings on the floor', () => {
    const world = worldWith(openEnv(), []);
    for (let i = 0; i < MAX_FOOD + 2; i++) dropFood(world, { x: i * 40, d: 1.5 });
    expect(world.items.filter((i) => i.kind === 'food')).toHaveLength(MAX_FOOD);
  });
});

describe('poo', () => {
  it('appears when a pet needs to go, and empties its bladder', () => {
    const env = openEnv();
    const dog = testPet('dog1', 'dog', { timer: 0, needs: { hunger: 0, energy: 1, fun: 0, bladder: 0.95 } });
    const world = worldWith(env, [dog]);
    run(world, env, 40, () => world.items.some((i) => i.kind === 'poo'));
    expect(world.items.filter((i) => i.kind === 'poo')).toHaveLength(1);
    expect(dog.needs.bladder).toBeLessThan(0.1);
  });

  it('drops the oldest poo once the floor is full', () => {
    const env = openEnv();
    const dog = testPet('dog1', 'dog', { timer: 0, needs: { hunger: 0, energy: 1, fun: 0, bladder: 0.95 } });
    const world = worldWith(env, [dog]);
    world.items = Array.from({ length: MAX_POO }, (_, i) => poo(`old${i}`, i));
    run(world, env, 40, () => dog.needs.bladder < 0.1);
    expect(world.items.filter((i) => i.kind === 'poo')).toHaveLength(MAX_POO);
    expect(world.items.some((i) => i.id === 'old0')).toBe(false);
  });

  it('can be picked up, while other items cannot', () => {
    const world = worldWith(openEnv(), []);
    world.items = [poo('poo1', 0), ball()];
    expect(pickUpPoo(world, 'poo1')).toBe(true);
    expect(pickUpPoo(world, 'ball1')).toBe(false);
    expect(world.items.map((i) => i.id)).toEqual(['ball1']);
  });

  it('cleans itself up after a long time', () => {
    const env = openEnv();
    const world = worldWith(env, []);
    world.items = [poo('poo1', 0)];
    world.time = POO_LIFETIME_S + 1;
    stepWorld(world, 0.05, env);
    expect(world.items).toHaveLength(0);
  });
});

describe('toys', () => {
  it('a thrown toy is fetched by a dog and brought back to where it was thrown', () => {
    const env = openEnv();
    const dog = testPet('dog1', 'dog', { x: -150, d: 1.2, needs: { hunger: 0, energy: 1, fun: 0.3, bladder: 0 } });
    const world = worldWith(env, [dog]);
    world.items = [ball()];
    grabToy(world, 'ball1');
    dragToy(world, 'ball1', { x: -100, d: 1.2 }, 0);
    throwToy(world, 'ball1', { vx: 600, vd: 0.3, vz: 200 }, () => 0.9);
    expect(dog.activity).toBe('fetch');
    run(world, env, 20, () => dog.carrying === 'ball1');
    run(world, env, 30, () => dog.carrying === null);
    expect(groundDistance(world.items[0], { x: -100, d: 1.2 })).toBeLessThan(160);
  });

  it('a gentle release does not start a game of fetch', () => {
    const env = openEnv();
    const dog = testPet('dog1', 'dog', { x: -150, d: 1.2 });
    const world = worldWith(env, [dog]);
    world.items = [ball()];
    grabToy(world, 'ball1');
    throwToy(world, 'ball1', { vx: 10, vd: 0, vz: 0 }, () => 0.9);
    expect(dog.activity).not.toBe('fetch');
  });

  it('can be taken out of a dog mouth, but poo cannot be grabbed', () => {
    const dog = testPet('dog1', 'dog', { activity: 'fetch', itemId: 'ball1', carrying: 'ball1' });
    const world = worldWith(openEnv(), [dog]);
    world.items = [ball({ heldBy: 'dog1' }), poo('poo1', 0)];
    expect(grabToy(world, 'ball1')).toBe(true);
    expect(dog.carrying).toBeNull();
    expect(grabToy(world, 'poo1')).toBe(false);
  });

  it('bounces off the floor edges instead of leaving the floor', () => {
    const env = openEnv();
    const world = worldWith(env, []);
    world.items = [ball({ vx: 900, vd: 3 })];
    run(world, env, 5);
    const toy = world.items[0];
    expect(clampToFloor(toy, world.xLimit)).toEqual({ x: toy.x, d: toy.d });
  });
});

describe('pointer reactions', () => {
  it('a hovered pet shows love', () => {
    const env = openEnv();
    const cat = testPet('cat1', 'cat', { activity: 'idle' });
    const world = worldWith(env, [cat]);
    world.pointer = { ground: { x: 0, d: 1.5 }, overPetId: 'cat1', speed: 0 };
    run(world, env, 1);
    expect(cat.activity).toBe('love');
    expect(world.emotes.some((e) => e.kind === 'love')).toBe(true);
  });

  it('a sleeping pet is not woken by hovering', () => {
    const env = openEnv();
    const cat = testPet('cat1', 'cat', {
      activity: 'sleep',
      timer: 30,
      needs: { hunger: 0, energy: 0.3, fun: 0, bladder: 0 },
    });
    const world = worldWith(env, [cat]);
    world.pointer = { ground: { x: 0, d: 1.5 }, overPetId: 'cat1', speed: 0 };
    run(world, env, 1);
    expect(cat.activity).toBe('sleep');
  });

  it('a fast swipe scares a cat away and excites a dog', () => {
    const env = openEnv();
    const cat = testPet('cat1', 'cat', { x: -40, activity: 'idle' });
    const dog = testPet('dog1', 'dog', { x: 40, activity: 'idle' });
    const world = worldWith(env, [cat, dog]);
    world.pointer = { ground: { x: 0, d: 1.5 }, overPetId: null, speed: 3000 };
    stepWorld(world, 0.05, env);
    expect(cat.activity).toBe('flee');
    expect(dog.activity).toBe('follow');
  });
});

describe('roster and robustness', () => {
  it('sends a pet away when everyone is on stage', () => {
    const env = openEnv(() => 0.1);
    const pets = ['a', 'b', 'c', 'd'].map((id, i) => testPet(id, i % 2 ? 'dog' : 'cat', { x: i * 50 - 75 }));
    const world = worldWith(env, pets);
    world.rosterTimer = 0;
    stepWorld(world, 0.05, env);
    expect(pets.filter((p) => p.activity === 'leave')).toHaveLength(1);
  });

  it('never drops below the minimum number of pets on stage', () => {
    const env = openEnv(seeded(11));
    const world = createWorld(400, env);
    let fewest = Infinity;
    for (let i = 0; i < 12000; i++) {
      stepWorld(world, 0.05, env);
      fewest = Math.min(fewest, world.pets.filter((p) => p.present).length);
    }
    expect(fewest).toBeGreaterThanOrEqual(MIN_PRESENT);
  });

  it('keeps pets on the floor and finite after huge or empty time steps', () => {
    const env = openEnv(seeded(5));
    const world = createWorld(400, env);
    stepWorld(world, 0, env);
    expect(world.time).toBe(0);
    for (let i = 0; i < 200; i++) stepWorld(world, 1000, env);
    const settled = world.pets.filter((p) => p.present && p.activity !== 'leave' && p.activity !== 'enter');
    expect(settled.every((p) => Number.isFinite(p.x) && clampToFloor(p, world.xLimit).x === p.x)).toBe(true);
  });
});
