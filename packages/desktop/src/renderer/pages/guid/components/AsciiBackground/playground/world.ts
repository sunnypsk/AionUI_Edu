/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { decideActivity, stepNeeds } from './brain';
import { buildRig, itemRig } from './rigs';
import { clampToFloor, D_FAR, D_NEAR, DEPTH_TO_X, floorHalfWidth, groundDistance, RIG_TO_WORLD } from './stage';
import type { EmoteKind, GroundPoint, Item, ItemKind, Pet, PetActivity, PetPose, Species, World } from './types';

export type WorldEnv = {
  random: () => number;
  /** True where a pet would be hidden behind the page content. */
  isBlocked: (p: GroundPoint) => boolean;
};

export type Velocity = { vx: number; vd: number; vz: number };

export const ROSTER: readonly Species[] = ['cat', 'dog', 'cat', 'dog'];
export const MIN_PRESENT = 2;
export const MAX_POO = 5;
export const MAX_FOOD = 3;
export const POO_LIFETIME_S = 900;
export const HOP_S = 0.6;
export const EAT_SECONDS = 6;
export const TOY_KINDS: readonly ItemKind[] = ['ball', 'bone'];

const MAX_STEP_S = 0.25;
const GRAVITY = 900;
/** How far past the floor edge a pet walks to be fully off screen, before depth scaling. */
const OFFSTAGE = 260;
const MAX_EMOTES = 24;
const FAST_POINTER = 1400;
const CALM_POINTER = 220;
const HOVER_LOVE_S = 0.5;
const POUNCE_RANGE = 120;
const FOLLOW_GAP = 85;
const THROW_SPEED = 150;
const MAX_THROW = 900;
const FOOD_DROP_Z = 70;

const SPEED: Record<Species, { walk: number; run: number; sneak: number }> = {
  cat: { walk: 55, run: 165, sneak: 24 },
  dog: { walk: 70, run: 185, sneak: 40 },
};
const EMOTE_LIFT: Record<Species, number> = { cat: 140, dog: 145 };

/** Activities a pet finishes before it pays attention to anything else. */
const BUSY: ReadonlySet<PetActivity> = new Set<PetActivity>(['sleep', 'eat', 'poo', 'enter', 'leave']);
/** Calm activities the pointer, food or a thrown toy may interrupt. */
const INTERRUPTIBLE: ReadonlySet<PetActivity> = new Set<PetActivity>(['idle', 'wander', 'groom']);
const DISTRACTIBLE: ReadonlySet<PetActivity> = new Set<PetActivity>([...INTERRUPTIBLE, 'love', 'follow', 'stalk']);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

type Mouth = { dx: number; z: number };
const mouthCache = new Map<string, Mouth>();

/** Where the pet's mouth sits relative to its feet, in world units, when facing right. */
export const mouthOffset = (species: Species, pose: PetPose): Mouth => {
  const key = `${species}:${pose}`;
  let mouth = mouthCache.get(key);
  if (!mouth) {
    const rig = buildRig(species, { pose, phase: 0, age: 1, eyesClosed: false });
    mouth = { dx: (rig.mouth.x - rig.w / 2) * RIG_TO_WORLD, z: (rig.h - rig.mouth.y) * RIG_TO_WORLD };
    mouthCache.set(key, mouth);
  }
  return mouth;
};

const newId = (world: World, prefix: string): string => `${prefix}${world.nextId++}`;

export const findItem = (world: World, id: string | null): Item | undefined =>
  id === null ? undefined : world.items.find((item) => item.id === id);

const findPet = (world: World, id: string | null): Pet | undefined =>
  id === null ? undefined : world.pets.find((pet) => pet.id === id);

export const isToy = (item: Item): boolean => TOY_KINDS.includes(item.kind);

/** A random floor spot that stays clear of the page content, near `around` when given. */
export const pickSpot = (world: World, env: WorldEnv, around?: GroundPoint): GroundPoint => {
  const { random } = env;
  let spot: GroundPoint = { x: 0, d: D_NEAR };
  for (let i = 0; i < 16; i++) {
    let raw: GroundPoint;
    if (around) {
      raw = { x: around.x + (random() - 0.5) * 320, d: around.d + (random() - 0.5) * 0.5 };
    } else {
      const d = D_NEAR + 0.04 + random() * (D_FAR - D_NEAR - 0.12);
      raw = { x: (random() * 2 - 1) * floorHalfWidth(world.xLimit, d) * 0.95, d };
    }
    spot = clampToFloor(raw, world.xLimit);
    if (!env.isBlocked(spot)) return spot;
  }
  return spot;
};

const spawnItem = (world: World, kind: ItemKind, at: GroundPoint, z: number): Item => {
  const item: Item = {
    id: newId(world, kind),
    kind,
    x: at.x,
    d: at.d,
    z,
    vx: 0,
    vd: 0,
    vz: 0,
    amount: 1,
    heldBy: null,
    born: world.time,
  };
  world.items.push(item);
  return item;
};

export const makePet = (
  id: string,
  species: Species,
  spot: GroundPoint,
  random: () => number,
  present: boolean
): Pet => ({
  id,
  species,
  x: spot.x,
  d: spot.d,
  dir: random() < 0.5 ? 1 : -1,
  needs: {
    hunger: 0.15 + random() * 0.3,
    energy: 0.6 + random() * 0.4,
    fun: 0.3 + random() * 0.4,
    bladder: random() * 0.5,
  },
  present,
  activity: 'idle',
  timer: 1 + random() * 3,
  target: null,
  itemId: null,
  carrying: null,
  arrived: false,
  moving: false,
  phase: random() * Math.PI * 2,
  age: random() * 10,
  hop: 0,
  cooldown: 0,
  emoteTimer: 0,
});

/** Every playground keeps one ball and one bone around. */
export const ensureToys = (world: World, env: WorldEnv): void => {
  for (const kind of TOY_KINDS) {
    if (!world.items.some((item) => item.kind === kind)) spawnItem(world, kind, pickSpot(world, env), 0);
  }
};

export const createWorld = (xLimit: number, env: WorldEnv): World => {
  const world: World = {
    pets: [],
    items: [],
    emotes: [],
    pointer: null,
    hover: null,
    xLimit,
    nextId: 1,
    rosterTimer: 60 + env.random() * 60,
    time: 0,
    throwOrigin: null,
  };
  ROSTER.forEach((species, i) => {
    world.pets.push(makePet(newId(world, species), species, pickSpot(world, env), env.random, i < 3));
  });
  ensureToys(world, env);
  return world;
};

export const addEmote = (world: World, kind: EmoteKind, x: number, d: number, lift: number): void => {
  world.emotes.push({ kind, x, d, lift, age: 0, life: kind === 'sleep' ? 2.2 : 1.6 });
  if (world.emotes.length > MAX_EMOTES) world.emotes.shift();
};

const petEmote = (world: World, pet: Pet, kind: EmoteKind): void => {
  const lift = EMOTE_LIFT[pet.species] * (pet.activity === 'sleep' ? 0.6 : 1);
  addEmote(world, kind, pet.x + pet.dir * 20, pet.d, lift);
};

export const removeItem = (world: World, id: string): void => {
  world.items = world.items.filter((item) => item.id !== id);
  for (const pet of world.pets) {
    if (pet.carrying === id) pet.carrying = null;
  }
};

const dropCarried = (world: World, pet: Pet): void => {
  const item = findItem(world, pet.carrying);
  if (item && item.heldBy === pet.id) item.heldBy = null;
  pet.carrying = null;
};

type ActivityExtra = { target?: GroundPoint | null; itemId?: string | null };

const setActivity = (world: World, pet: Pet, activity: PetActivity, timer: number, extra: ActivityExtra = {}): void => {
  if (pet.carrying && activity !== 'fetch') dropCarried(world, pet);
  pet.activity = activity;
  pet.timer = timer;
  pet.target = extra.target ?? null;
  pet.itemId = extra.itemId ?? null;
  pet.arrived = false;
};

const decide = (world: World, pet: Pet, env: WorldEnv): void => {
  const decision = decideActivity(pet, world, {
    random: env.random,
    pickSpot: (around) => pickSpot(world, env, around),
  });
  setActivity(world, pet, decision.activity, decision.timer, decision);
};

const faceToward = (pet: Pet, x: number): void => {
  if (Math.abs(x - pet.x) > 10) pet.dir = x > pet.x ? 1 : -1;
};

/** Moves the pet toward `target`; returns true once it is within `stopAt` world units. */
export const moveToward = (pet: Pet, target: GroundPoint, speed: number, dt: number, stopAt = 4): boolean => {
  const dx = target.x - pet.x;
  const dd = (target.d - pet.d) * DEPTH_TO_X;
  const dist = Math.hypot(dx, dd);
  if (dist <= stopAt) return true;
  const step = Math.min(dist - stopAt, speed * dt);
  pet.x += (dx / dist) * step;
  pet.d += (dd / dist) * (step / DEPTH_TO_X);
  if (Math.abs(dx) > 3) pet.dir = dx > 0 ? 1 : -1;
  pet.phase += dt * (6 + speed * 0.08);
  pet.moving = true;
  return dist - step <= stopAt + 1e-6;
};

// --- Items ---------------------------------------------------------------------

const stepItem = (world: World, item: Item, dt: number): void => {
  if (item.heldBy === 'pointer') return;
  if (item.heldBy !== null) {
    const pet = findPet(world, item.heldBy);
    if (pet?.present && pet.carrying === item.id) {
      const mouth = mouthOffset(pet.species, 'walk');
      item.x = pet.x + pet.dir * mouth.dx;
      // Drawn just in front of the carrier so the toy sits in its mouth.
      item.d = pet.d - 0.002;
      item.z = Math.max(0, mouth.z - (itemRig(item.kind).h / 2) * RIG_TO_WORLD);
      item.vx = 0;
      item.vd = 0;
      item.vz = 0;
      return;
    }
    item.heldBy = null;
  }
  if (item.z > 0 || item.vz > 0) {
    item.vz -= GRAVITY * dt;
    item.z += item.vz * dt;
    if (item.z <= 0) {
      item.z = 0;
      item.vz = item.kind === 'ball' && Math.abs(item.vz) > 80 ? -item.vz * 0.45 : 0;
    }
  }
  item.x += item.vx * dt;
  item.d += item.vd * dt;
  const drag = item.z > 0 ? 0.3 : item.kind === 'ball' ? 1.4 : 4;
  const friction = Math.exp(-drag * dt);
  item.vx = Math.abs(item.vx * friction) < 2 ? 0 : item.vx * friction;
  item.vd = Math.abs(item.vd * friction) < 0.005 ? 0 : item.vd * friction;
  if (item.d < D_NEAR || item.d > D_FAR) {
    item.d = clamp(item.d, D_NEAR, D_FAR);
    item.vd = -item.vd * 0.6;
  }
  const half = floorHalfWidth(world.xLimit, item.d);
  if (Math.abs(item.x) > half) {
    item.x = Math.sign(item.x) * half;
    item.vx = -item.vx * 0.6;
  }
};

const expirePoo = (world: World): void => {
  const expired = world.items.filter((item) => item.kind === 'poo' && world.time - item.born > POO_LIFETIME_S);
  for (const item of expired) removeItem(world, item.id);
};

// --- Activities ------------------------------------------------------------------

const stepEat = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const food = findItem(world, pet.itemId);
  if (!food || food.kind !== 'food' || food.heldBy !== null) {
    decide(world, pet, env);
    return;
  }
  if (!pet.arrived) {
    const side = pet.x <= food.x ? 1 : -1;
    pet.target = { x: food.x - side * mouthOffset(pet.species, 'eat').dx, d: food.d };
    const speed = pet.needs.hunger > 0.6 ? SPEED[pet.species].run : SPEED[pet.species].walk;
    if (moveToward(pet, pet.target, speed, dt) && food.z <= 0) {
      pet.arrived = true;
      pet.dir = side;
    } else if (pet.timer <= 0) {
      decide(world, pet, env);
    }
    return;
  }
  food.amount -= dt / EAT_SECONDS;
  pet.needs = {
    ...pet.needs,
    hunger: Math.max(0, pet.needs.hunger - dt * 0.12),
    bladder: Math.min(1, pet.needs.bladder + dt * 0.015),
  };
  if (food.amount > 0 && pet.needs.hunger > 0.02) return;
  if (food.amount <= 0) removeItem(world, food.id);
  petEmote(world, pet, 'sparkle');
  setActivity(world, pet, pet.species === 'cat' ? 'groom' : 'idle', 3 + env.random() * 2);
};

const stepPoo = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  if (!pet.arrived) {
    if (moveToward(pet, pet.target ?? pet, SPEED[pet.species].walk, dt) || pet.timer <= 0) {
      pet.arrived = true;
      pet.timer = 2.4;
    }
    return;
  }
  if (pet.timer > 0) return;
  const behind = buildRig(pet.species, { pose: 'squat', phase: 0, age: 0, eyesClosed: false }).w * 0.32 * RIG_TO_WORLD;
  spawnItem(world, 'poo', clampToFloor({ x: pet.x - pet.dir * behind, d: pet.d + 0.01 }, world.xLimit), 0);
  const poos = world.items.filter((item) => item.kind === 'poo').toSorted((a, b) => a.born - b.born);
  for (let i = 0; i < poos.length - MAX_POO; i++) removeItem(world, poos[i].id);
  pet.needs = { ...pet.needs, bladder: 0 };
  setActivity(world, pet, 'wander', 15, { target: pickSpot(world, env, pet) });
};

const stepPlay = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const ball = findItem(world, pet.itemId);
  if (!ball || ball.heldBy !== null || pet.timer <= 0 || pet.needs.fun < 0.1 || pet.needs.energy < 0.15) {
    setActivity(world, pet, 'idle', 2 + env.random() * 2);
    return;
  }
  const rolling = Math.hypot(ball.vx, ball.vd * DEPTH_TO_X) >= 25 || ball.z > 0;
  if (pet.arrived) {
    faceToward(pet, ball.x);
    if (!rolling) pet.arrived = false;
    return;
  }
  const side = pet.x <= ball.x ? 1 : -1;
  const reach = mouthOffset(pet.species, 'walk').dx * 0.9;
  if (!moveToward(pet, { x: ball.x - side * reach, d: ball.d }, SPEED[pet.species].run, dt)) return;
  ball.vx = side * (140 + env.random() * 200);
  ball.vd = (env.random() - 0.5) * 0.9;
  ball.vz = 100 + env.random() * 160;
  if (env.random() < 0.5) pet.hop = HOP_S;
  pet.arrived = true;
  pet.dir = side;
};

const bringBackSpot = (world: World, env: WorldEnv, pet: Pet): GroundPoint => {
  const home = world.throwOrigin ?? world.pointer?.ground ?? null;
  if (!home) return pickSpot(world, env, pet);
  const spot = clampToFloor(home, world.xLimit);
  return env.isBlocked(spot) ? pickSpot(world, env, spot) : spot;
};

const stepFetch = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const toy = findItem(world, pet.itemId);
  if (!toy) {
    decide(world, pet, env);
    return;
  }
  if (pet.carrying !== toy.id) {
    if (toy.heldBy === 'pointer') {
      // Waits for the throw, watching the toy.
      faceToward(pet, toy.x);
      if (pet.timer <= 0) setActivity(world, pet, 'idle', 2);
      return;
    }
    if (toy.heldBy !== null || pet.timer <= 0) {
      decide(world, pet, env);
      return;
    }
    const side = pet.x <= toy.x ? 1 : -1;
    const target = { x: toy.x - side * mouthOffset(pet.species, 'walk').dx, d: toy.d };
    if (moveToward(pet, target, SPEED[pet.species].run, dt) && toy.z < 30) {
      toy.heldBy = pet.id;
      pet.carrying = toy.id;
      pet.target = bringBackSpot(world, env, pet);
      pet.timer = 25;
    }
    return;
  }
  if (moveToward(pet, pet.target ?? pet, SPEED[pet.species].walk * 1.4, dt) || pet.timer <= 0) {
    dropCarried(world, pet);
    petEmote(world, pet, 'love');
    setActivity(world, pet, 'idle', 4 + env.random() * 3);
  }
};

const stepStalk = (world: World, pet: Pet, dt: number): void => {
  if (pet.arrived) {
    if (pet.target) moveToward(pet, pet.target, SPEED[pet.species].run * 1.3, dt);
    if (pet.hop <= 0) {
      pet.cooldown = 8;
      setActivity(world, pet, 'idle', 2.5);
    }
    return;
  }
  const pointer = world.pointer;
  const goal = pointer?.ground;
  if (!pointer || !goal || pet.timer <= 0) {
    pet.cooldown = 5;
    setActivity(world, pet, 'idle', 2);
    return;
  }
  faceToward(pet, goal.x);
  if (groundDistance(pet, goal) <= POUNCE_RANGE) {
    pet.arrived = true;
    pet.hop = HOP_S;
    pet.target = { ...goal };
    return;
  }
  // Freezes while the pointer moves, creeps closer while it rests.
  if (pointer.speed <= CALM_POINTER * 2) moveToward(pet, goal, SPEED[pet.species].sneak, dt);
};

const stepFollow = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const goal = world.pointer?.ground;
  if (!goal || pet.timer <= 0) {
    pet.cooldown = 8;
    setActivity(world, pet, 'idle', 2);
    return;
  }
  const dist = groundDistance(pet, goal);
  if (dist > FOLLOW_GAP)
    moveToward(pet, goal, dist > 260 ? SPEED[pet.species].run : SPEED[pet.species].walk, dt, FOLLOW_GAP);
  faceToward(pet, goal.x);
  if (pet.emoteTimer <= 0) {
    if (env.random() < 0.3) petEmote(world, pet, 'love');
    pet.emoteTimer = 2.5;
  }
};

const stepLove = (world: World, pet: Pet): void => {
  const goal = world.pointer?.ground;
  if (goal) faceToward(pet, goal.x);
  if (pet.emoteTimer <= 0) {
    petEmote(world, pet, 'love');
    pet.emoteTimer = 0.9;
  }
  if (pet.timer <= 0) setActivity(world, pet, 'idle', 2);
};

const stepSleep = (world: World, pet: Pet, env: WorldEnv): void => {
  if (pet.emoteTimer <= 0) {
    petEmote(world, pet, 'sleep');
    pet.emoteTimer = 2.4;
  }
  if (pet.timer <= 0 || pet.needs.energy >= 0.995) decide(world, pet, env);
};

const runActivity = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const walk = SPEED[pet.species].walk;
  switch (pet.activity) {
    case 'eat':
      return stepEat(world, pet, dt, env);
    case 'poo':
      return stepPoo(world, pet, dt, env);
    case 'play':
      return stepPlay(world, pet, dt, env);
    case 'fetch':
      return stepFetch(world, pet, dt, env);
    case 'stalk':
      return stepStalk(world, pet, dt);
    case 'follow':
      return stepFollow(world, pet, dt, env);
    case 'love':
      return stepLove(world, pet);
    case 'sleep':
      return stepSleep(world, pet, env);
    case 'flee':
      if (moveToward(pet, pet.target ?? pet, SPEED[pet.species].run, dt) || pet.timer <= 0) {
        pet.cooldown = 6;
        setActivity(world, pet, 'idle', 2);
      }
      return;
    case 'wander':
      if (moveToward(pet, pet.target ?? pet, walk, dt)) setActivity(world, pet, 'idle', 1.5 + env.random() * 2.5);
      else if (pet.timer <= 0) decide(world, pet, env);
      return;
    case 'enter':
      if (moveToward(pet, pet.target ?? pet, walk, dt) || pet.timer <= 0) setActivity(world, pet, 'idle', 2);
      return;
    case 'leave':
      if (moveToward(pet, pet.target ?? pet, walk, dt) || pet.timer <= 0) {
        setActivity(world, pet, 'idle', 0);
        pet.present = false;
      }
      return;
    default:
      if (pet.timer <= 0) decide(world, pet, env);
  }
};

// --- Pointer -----------------------------------------------------------------------

const reactToPointer = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  const pointer = world.pointer;
  const goal = pointer?.ground;
  if (!pointer || !goal || pet.cooldown > 0 || !INTERRUPTIBLE.has(pet.activity) || pet.needs.energy < 0.2) return;
  const dist = groundDistance(pet, goal);
  if (pointer.speed > FAST_POINTER && dist < 170) {
    if (pet.species === 'cat') {
      const dx = pet.x - goal.x;
      const dd = (pet.d - goal.d) * DEPTH_TO_X;
      const len = Math.hypot(dx, dd) || 1;
      const away = clampToFloor(
        { x: pet.x + (dx / len) * 280, d: pet.d + ((dd / len) * 280) / DEPTH_TO_X },
        world.xLimit
      );
      setActivity(world, pet, 'flee', 3, { target: away });
      pet.hop = HOP_S;
      petEmote(world, pet, 'alert');
    } else {
      setActivity(world, pet, 'follow', 6);
      petEmote(world, pet, 'love');
    }
    return;
  }
  if (pointer.speed > CALM_POINTER || dist > 480 || dist < 60) return;
  const ratePerSecond = pet.species === 'cat' ? 0.2 : 0.35;
  if (env.random() >= ratePerSecond * dt) return;
  setActivity(world, pet, pet.species === 'cat' ? 'stalk' : 'follow', pet.species === 'cat' ? 12 : 9);
  petEmote(world, pet, pet.species === 'cat' ? 'alert' : 'love');
};

const updateHover = (world: World, dt: number): void => {
  const petId = world.pointer?.overPetId ?? null;
  if (!petId) {
    world.hover = null;
    return;
  }
  const hover = world.hover?.petId === petId ? { petId, time: world.hover.time + dt } : { petId, time: 0 };
  world.hover = hover;
  const pet = findPet(world, petId);
  if (!pet?.present || hover.time < HOVER_LOVE_S) return;
  if (pet.activity === 'love') {
    pet.timer = Math.max(pet.timer, 0.8);
    return;
  }
  if (BUSY.has(pet.activity) || pet.carrying) return;
  setActivity(world, pet, 'love', 1.5);
  pet.emoteTimer = 0;
};

// --- Roster ------------------------------------------------------------------------

const stepRoster = (world: World, dt: number, env: WorldEnv): void => {
  world.rosterTimer -= dt;
  if (world.rosterTimer > 0) return;
  world.rosterTimer = 70 + env.random() * 110;
  const present = world.pets.filter((pet) => pet.present && pet.activity !== 'leave');
  const absent = world.pets.filter((pet) => !pet.present);
  const wantsLeave = present.length > MIN_PRESENT && (absent.length === 0 || env.random() < 0.5);
  if (wantsLeave) {
    const leaver = present.find((pet) => INTERRUPTIBLE.has(pet.activity) && !pet.carrying);
    if (!leaver) return;
    const side = leaver.x < 0 ? -1 : 1;
    const x = side * (world.xLimit + OFFSTAGE) * (leaver.d / D_NEAR);
    setActivity(world, leaver, 'leave', 60, { target: { x, d: leaver.d } });
    return;
  }
  const comer = absent[Math.floor(env.random() * absent.length)];
  if (!comer) return;
  const side = env.random() < 0.5 ? -1 : 1;
  const spot = pickSpot(world, env);
  Object.assign(comer, {
    present: true,
    x: side * (world.xLimit + OFFSTAGE) * (spot.d / D_NEAR),
    d: spot.d,
    needs: { hunger: 0.3 + env.random() * 0.2, energy: 0.8, fun: 0.5, bladder: env.random() * 0.3 },
    hop: 0,
    cooldown: 0,
  });
  setActivity(world, comer, 'enter', 40, { target: spot });
};

// --- Step --------------------------------------------------------------------------

const stepPet = (world: World, pet: Pet, dt: number, env: WorldEnv): void => {
  pet.age += dt;
  pet.timer -= dt;
  pet.cooldown = Math.max(0, pet.cooldown - dt);
  pet.hop = Math.max(0, pet.hop - dt);
  pet.emoteTimer -= dt;
  pet.moving = false;
  pet.needs = stepNeeds(pet.needs, pet.activity, dt, pet.species);
  reactToPointer(world, pet, dt, env);
  runActivity(world, pet, dt, env);
  if (pet.present && pet.activity !== 'enter' && pet.activity !== 'leave') {
    Object.assign(pet, clampToFloor(pet, world.xLimit));
  }
};

/** Advances the whole playground by `dt` seconds. */
export const stepWorld = (world: World, rawDt: number, env: WorldEnv): void => {
  const dt = clamp(rawDt, 0, MAX_STEP_S);
  if (dt === 0) return;
  world.time += dt;
  for (const item of world.items) stepItem(world, item, dt);
  updateHover(world, dt);
  for (const pet of world.pets) {
    if (pet.present) stepPet(world, pet, dt, env);
  }
  stepRoster(world, dt, env);
  for (const emote of world.emotes) emote.age += dt;
  world.emotes = world.emotes.filter((emote) => emote.age < emote.life);
  expirePoo(world);
};

// --- Interactions ------------------------------------------------------------------

/** Drops a serving of food from above; the nearest pet that is a little hungry runs over. */
export const dropFood = (world: World, at: GroundPoint): Item => {
  const foods = world.items.filter((item) => item.kind === 'food');
  if (foods.length >= MAX_FOOD) removeItem(world, foods[0].id);
  const food = spawnItem(world, 'food', clampToFloor(at, world.xLimit), FOOD_DROP_Z);
  let best: Pet | null = null;
  let bestDist = Infinity;
  for (const pet of world.pets) {
    if (!pet.present || !DISTRACTIBLE.has(pet.activity) || pet.needs.hunger < 0.15) continue;
    const dist = groundDistance(pet, food);
    if (dist < bestDist) {
      best = pet;
      bestDist = dist;
    }
  }
  if (best) {
    setActivity(world, best, 'eat', 30, { itemId: food.id });
    petEmote(world, best, 'hungry');
  }
  return food;
};

/** A click on a pet: sleepy pets stay asleep, awake ones lap up the attention. */
export const petPet = (world: World, petId: string): void => {
  const pet = findPet(world, petId);
  if (!pet?.present) return;
  pet.needs = { ...pet.needs, fun: Math.max(0, pet.needs.fun - 0.1) };
  if (BUSY.has(pet.activity) || pet.carrying) {
    petEmote(world, pet, 'love');
    return;
  }
  setActivity(world, pet, 'love', 2.5);
  pet.emoteTimer = 0;
};

export const pickUpPoo = (world: World, itemId: string): boolean => {
  const poo = findItem(world, itemId);
  if (!poo || poo.kind !== 'poo') return false;
  removeItem(world, itemId);
  addEmote(world, 'sparkle', poo.x, poo.d, 50);
  return true;
};

/** Takes a toy into the pointer, even out of a dog's mouth. */
export const grabToy = (world: World, itemId: string): boolean => {
  const toy = findItem(world, itemId);
  if (!toy || !isToy(toy) || toy.heldBy === 'pointer') return false;
  const carrier = findPet(world, toy.heldBy);
  if (carrier) carrier.carrying = null;
  toy.heldBy = 'pointer';
  toy.vx = 0;
  toy.vd = 0;
  toy.vz = 0;
  for (const pet of world.pets) {
    if (pet.itemId === itemId && pet.activity === 'fetch') pet.timer = Math.max(pet.timer, 15);
  }
  return true;
};

export const dragToy = (world: World, itemId: string, at: GroundPoint, z: number): void => {
  const toy = findItem(world, itemId);
  if (!toy || toy.heldBy !== 'pointer') return;
  const spot = clampToFloor(at, world.xLimit);
  toy.x = spot.x;
  toy.d = spot.d;
  toy.z = Math.max(0, z);
};

const nearestAvailable = (world: World, item: Item, accept: (pet: Pet) => boolean): Pet | null => {
  let best: Pet | null = null;
  let bestDist = Infinity;
  for (const pet of world.pets) {
    if (!pet.present || BUSY.has(pet.activity) || pet.carrying || !accept(pet)) continue;
    const dist = groundDistance(pet, item);
    if (dist < bestDist) {
      best = pet;
      bestDist = dist;
    }
  }
  return best;
};

/** Lets go of a dragged toy; a real throw sends a dog after it and maybe a cat after the ball. */
export const throwToy = (world: World, itemId: string, velocity: Velocity, random: () => number): void => {
  const toy = findItem(world, itemId);
  if (!toy || toy.heldBy !== 'pointer') return;
  toy.heldBy = null;
  toy.vx = clamp(velocity.vx, -MAX_THROW, MAX_THROW);
  toy.vd = clamp(velocity.vd, -MAX_THROW / DEPTH_TO_X, MAX_THROW / DEPTH_TO_X);
  toy.vz = clamp(velocity.vz, 0, 500);
  if (Math.hypot(toy.vx, toy.vd * DEPTH_TO_X) < THROW_SPEED) return;
  world.throwOrigin = { x: toy.x, d: toy.d };
  const chased = world.pets.some((pet) => pet.present && pet.itemId === itemId && pet.activity === 'fetch');
  const dog = chased ? null : nearestAvailable(world, toy, (pet) => pet.species === 'dog' && pet.needs.energy > 0.2);
  if (dog) {
    setActivity(world, dog, 'fetch', 25, { itemId });
    petEmote(world, dog, 'alert');
  }
  if (toy.kind !== 'ball' || random() >= 0.6) return;
  const cat = nearestAvailable(world, toy, (pet) => pet.species === 'cat' && pet.needs.fun > 0.25);
  if (cat) setActivity(world, cat, 'play', 15, { itemId });
};
