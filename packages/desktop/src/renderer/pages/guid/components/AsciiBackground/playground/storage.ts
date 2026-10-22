/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { stepNeeds } from './brain';
import { clampToFloor } from './stage';
import type { Item, ItemKind, Pet, PetNeeds, Species, World } from './types';
import { ensureToys, makePet, MIN_PRESENT, pickSpot, type WorldEnv } from './world';

export const STORAGE_KEY = 'aionui.guid.playground';
export const STORAGE_VERSION = 1;
/** Time away counts toward the pets' needs, but only partly and only up to an hour. */
const OFFLINE_CAP_S = 3600;
const OFFLINE_NEED_RATE = 0.1;
const MAX_PETS = 8;
const MAX_ITEMS = 32;

type SavedPet = Pick<Pet, 'id' | 'species' | 'x' | 'd' | 'dir' | 'needs' | 'present'>;
type SavedItem = Pick<Item, 'id' | 'kind' | 'x' | 'd' | 'amount' | 'born'>;

export type SavedPlayground = {
  version: typeof STORAGE_VERSION;
  savedAt: number;
  time: number;
  nextId: number;
  pets: SavedPet[];
  items: SavedItem[];
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const SPECIES: ReadonlySet<unknown> = new Set<Species>(['cat', 'dog']);
const ITEM_KINDS: ReadonlySet<unknown> = new Set<ItemKind>(['food', 'poo', 'ball', 'bone']);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 32;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const serializeWorld = (world: World, now: number): SavedPlayground => ({
  version: STORAGE_VERSION,
  savedAt: now,
  time: world.time,
  nextId: world.nextId,
  pets: world.pets.map(({ id, species, x, d, dir, needs, present }) => ({ id, species, x, d, dir, needs, present })),
  items: world.items.map(({ id, kind, x, d, amount, born }) => ({ id, kind, x, d, amount, born })),
});

const parseNeeds = (raw: unknown): PetNeeds | null => {
  if (!isRecord(raw)) return null;
  const { hunger, energy, fun, bladder } = raw;
  if (!isNum(hunger) || !isNum(energy) || !isNum(fun) || !isNum(bladder)) return null;
  return { hunger: clamp01(hunger), energy: clamp01(energy), fun: clamp01(fun), bladder: clamp01(bladder) };
};

const parsePet = (raw: unknown): SavedPet | null => {
  if (!isRecord(raw)) return null;
  const { id, species, x, d, dir, present } = raw;
  const needs = parseNeeds(raw.needs);
  if (!isId(id) || !SPECIES.has(species as Species) || !isNum(x) || !isNum(d) || !needs) return null;
  return { id, species: species as Species, x, d, dir: dir === -1 ? -1 : 1, needs, present: present === true };
};

const parseItem = (raw: unknown): SavedItem | null => {
  if (!isRecord(raw)) return null;
  const { id, kind, x, d, amount, born } = raw;
  if (!isId(id) || !ITEM_KINDS.has(kind) || !isNum(x) || !isNum(d) || !isNum(born)) return null;
  const left = isNum(amount) ? Math.min(1, amount) : 1;
  return left > 0 ? { id, kind: kind as ItemKind, x, d, amount: left, born } : null;
};

/** Validates stored JSON; anything malformed or from another version yields null. */
export const parseSaved = (raw: unknown): SavedPlayground | null => {
  if (!isRecord(raw) || raw.version !== STORAGE_VERSION) return null;
  const { savedAt, time, nextId, pets, items } = raw;
  if (!isNum(savedAt) || !isNum(time) || time < 0 || !isNum(nextId) || !Array.isArray(pets) || !Array.isArray(items)) {
    return null;
  }
  if (pets.length === 0 || pets.length > MAX_PETS || items.length > MAX_ITEMS) return null;
  const parsedPets = pets.map(parsePet);
  if (parsedPets.some((pet) => pet === null)) return null;
  const validPets = parsedPets.filter((pet): pet is SavedPet => pet !== null);
  const validItems = items.map(parseItem).filter((item): item is SavedItem => item !== null);
  const ids = new Set([...validPets, ...validItems].map((entry) => entry.id));
  if (ids.size !== validPets.length + validItems.length) return null;
  return {
    version: STORAGE_VERSION,
    savedAt,
    time,
    nextId: Math.max(1, Math.floor(nextId)),
    pets: validPets,
    items: validItems,
  };
};

const highestIdNumber = (ids: string[]): number =>
  ids.reduce((max, id) => Math.max(max, Number(/(\d+)$/.exec(id)?.[1] ?? 0)), 0);

/** Rebuilds a live world from a save; positions are re-fitted to the current floor size. */
export const restoreWorld = (saved: SavedPlayground, xLimit: number, env: WorldEnv, now: number): World => {
  const away = Math.min(OFFLINE_CAP_S, Math.max(0, (now - saved.savedAt) / 1000));
  const world: World = {
    pets: [],
    items: [],
    emotes: [],
    pointer: null,
    hover: null,
    xLimit,
    nextId: Math.max(saved.nextId, highestIdNumber([...saved.pets, ...saved.items].map((e) => e.id)) + 1),
    rosterTimer: 40 + env.random() * 60,
    time: saved.time + away,
    throwOrigin: null,
  };
  for (const entry of saved.pets) {
    let spot = clampToFloor(entry, xLimit);
    if (entry.present && env.isBlocked(spot)) spot = pickSpot(world, env);
    const pet = makePet(entry.id, entry.species, spot, env.random, entry.present);
    pet.dir = entry.dir;
    pet.needs = stepNeeds(entry.needs, 'idle', away * OFFLINE_NEED_RATE, entry.species);
    world.pets.push(pet);
  }
  for (const pet of world.pets) {
    if (world.pets.filter((p) => p.present).length >= MIN_PRESENT) break;
    pet.present = true;
  }
  for (const entry of saved.items) {
    const spot = clampToFloor(entry, xLimit);
    world.items.push({ ...entry, ...spot, z: 0, vx: 0, vd: 0, vz: 0, heldBy: null });
  }
  ensureToys(world, env);
  return world;
};

export const loadWorld = (storage: StorageLike | null, xLimit: number, env: WorldEnv, now: number): World | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const saved = raw ? parseSaved(JSON.parse(raw)) : null;
    return saved ? restoreWorld(saved, xLimit, env, now) : null;
  } catch {
    return null;
  }
};

/** Best effort: a full or blocked storage never breaks the playground. */
export const saveWorld = (storage: StorageLike | null, world: World, now: number): boolean => {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(serializeWorld(world, now)));
    return true;
  } catch {
    return false;
  }
};
