/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Pet, Species, World } from '@/renderer/pages/guid/components/AsciiBackground/playground/types';
import {
  createWorld,
  makePet,
  stepWorld,
  type WorldEnv,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/world';

/** Deterministic Park-Miller generator so simulations replay the same way. */
export const seeded = (seed = 7): (() => number) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
};

export const openEnv = (random: () => number = seeded()): WorldEnv => ({ random, isBlocked: () => false });

export const testPet = (id: string, species: Species, overrides: Partial<Pet> = {}): Pet => ({
  ...makePet(id, species, { x: 0, d: 1.5 }, () => 0.5, true),
  needs: { hunger: 0, energy: 1, fun: 0, bladder: 0 },
  timer: 5,
  ...overrides,
});

/** A world holding only the given pets, with the roster frozen so nobody wanders off stage. */
export const worldWith = (env: WorldEnv, pets: Pet[]): World => {
  const world = createWorld(400, env);
  world.pets = pets;
  world.items = [];
  world.rosterTimer = Number.POSITIVE_INFINITY;
  return world;
};

export const run = (world: World, env: WorldEnv, seconds: number, until?: () => boolean): void => {
  for (let t = 0; t < seconds; t += 0.05) {
    stepWorld(world, 0.05, env);
    if (until?.()) return;
  }
};
