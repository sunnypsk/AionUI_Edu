/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { groundDistance } from './stage';
import type { GroundPoint, Item, Pet, PetActivity, PetNeeds, Species, World } from './types';

/** Per-second rates. `tire` drains energy while awake, `rest` restores it while asleep. */
export type NeedRates = { hunger: number; fun: number; bladder: number; tire: number; rest: number };

export const NEED_RATES: Record<Species, NeedRates> = {
  cat: { hunger: 1 / 540, fun: 1 / 240, bladder: 1 / 720, tire: 1 / 420, rest: 1 / 45 },
  dog: { hunger: 1 / 480, fun: 1 / 180, bladder: 1 / 600, tire: 1 / 360, rest: 1 / 50 },
};

const PLAYFUL: ReadonlySet<PetActivity> = new Set<PetActivity>(['play', 'fetch', 'stalk', 'follow', 'flee', 'love']);

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const stepNeeds = (needs: PetNeeds, activity: PetActivity, dt: number, species: Species): PetNeeds => {
  const rates = NEED_RATES[species];
  const sleeping = activity === 'sleep';
  const playing = PLAYFUL.has(activity);
  const funRate = playing ? -rates.fun * 4 : sleeping ? 0 : rates.fun;
  return {
    hunger: clamp01(needs.hunger + rates.hunger * dt),
    fun: clamp01(needs.fun + funRate * dt),
    bladder: clamp01(needs.bladder + rates.bladder * dt),
    energy: clamp01(needs.energy + (sleeping ? rates.rest : -rates.tire * (playing ? 3 : 1)) * dt),
  };
};

export type Decision = { activity: PetActivity; timer: number; target: GroundPoint | null; itemId: string | null };

export type DecideContext = {
  random: () => number;
  /** A free floor spot, near `around` when given. */
  pickSpot: (around?: GroundPoint) => GroundPoint;
};

/** True when another present pet is already after this item. */
export const isClaimed = (world: World, itemId: string, petId: string): boolean =>
  world.pets.some((p) => p.present && p.id !== petId && p.itemId === itemId);

const nearestFree = (world: World, pet: Pet, accept: (item: Item) => boolean): Item | null => {
  let best: Item | null = null;
  let bestDist = Infinity;
  for (const item of world.items) {
    if (item.heldBy !== null || !accept(item) || isClaimed(world, item.id, pet.id)) continue;
    const dist = groundDistance(pet, item);
    if (dist < bestDist) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
};

const isToyFor = (species: Species, item: Item): boolean =>
  item.kind === 'ball' || (species === 'dog' && item.kind === 'bone');

/** Chooses the next activity from the pet's strongest need, with some randomness when nothing is urgent. */
export const decideActivity = (pet: Pet, world: World, ctx: DecideContext): Decision => {
  const { needs } = pet;
  const { random } = ctx;
  if (needs.bladder >= 0.85) return { activity: 'poo', timer: 25, target: ctx.pickSpot(pet), itemId: null };
  const food = nearestFree(world, pet, (item) => item.kind === 'food');
  if (food && needs.hunger >= 0.35) return { activity: 'eat', timer: 30, target: null, itemId: food.id };
  if (needs.energy <= 0.2) return { activity: 'sleep', timer: 30 + random() * 30, target: null, itemId: null };
  const toy = nearestFree(world, pet, (item) => isToyFor(pet.species, item));
  if (toy && needs.fun >= 0.55) {
    return { activity: pet.species === 'dog' ? 'fetch' : 'play', timer: 25, target: null, itemId: toy.id };
  }
  const roll = random();
  if (needs.energy < 0.5 && roll < 0.2)
    return { activity: 'sleep', timer: 20 + random() * 20, target: null, itemId: null };
  if (roll < 0.5) return { activity: 'wander', timer: 20, target: ctx.pickSpot(), itemId: null };
  if (roll < 0.75) return { activity: 'idle', timer: 2 + random() * 4, target: null, itemId: null };
  return { activity: 'groom', timer: 3 + random() * 3, target: null, itemId: null };
};
