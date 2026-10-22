/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type Species = 'cat' | 'dog';

/** Every need runs 0..1. Higher hunger, fun and bladder mean a stronger urge; higher energy means rested. */
export type PetNeeds = { hunger: number; energy: number; fun: number; bladder: number };

export type PetActivity =
  | 'idle'
  | 'wander'
  | 'groom'
  | 'sleep'
  | 'eat'
  | 'poo'
  | 'play'
  | 'fetch'
  | 'stalk'
  | 'follow'
  | 'flee'
  | 'love'
  | 'enter'
  | 'leave';

export type PetPose = 'walk' | 'sit' | 'lie' | 'eat' | 'squat';

/** A point on the floor: `x` in world units, `d` the depth (1 is the nearest row). */
export type GroundPoint = { x: number; d: number };

export type Pet = {
  id: string;
  species: Species;
  x: number;
  d: number;
  dir: 1 | -1;
  needs: PetNeeds;
  /** False while the pet is away from the stage. */
  present: boolean;
  activity: PetActivity;
  /** Seconds left before the pet reconsiders what to do. */
  timer: number;
  target: GroundPoint | null;
  /** Item the activity is about, such as the food being eaten or the toy being chased. */
  itemId: string | null;
  carrying: string | null;
  /** True once the pet reached its spot and performs the activity in place. */
  arrived: boolean;
  /** True when the pet moved during the latest step. */
  moving: boolean;
  phase: number;
  age: number;
  /** Seconds left in the current hop. */
  hop: number;
  /** Seconds before the pet reacts to the pointer again. */
  cooldown: number;
  emoteTimer: number;
};

export type ItemKind = 'food' | 'poo' | 'ball' | 'bone';

export type Item = {
  id: string;
  kind: ItemKind;
  x: number;
  d: number;
  /** Height above the floor in world units. */
  z: number;
  vx: number;
  /** Depth velocity in depth units per second. */
  vd: number;
  vz: number;
  /** Food left, 1 being a full serving. */
  amount: number;
  /** `'pointer'` while dragged, a pet id while carried, otherwise null. */
  heldBy: string | null;
  /** World time when the item appeared. */
  born: number;
};

export type EmoteKind = 'love' | 'sleep' | 'alert' | 'hungry' | 'sparkle';

export type Emote = { kind: EmoteKind; x: number; d: number; lift: number; age: number; life: number };

export type PointerInfo = {
  ground: GroundPoint | null;
  overPetId: string | null;
  /** Screen speed in px/s. */
  speed: number;
};

export type World = {
  pets: Pet[];
  items: Item[];
  emotes: Emote[];
  pointer: PointerInfo | null;
  hover: { petId: string; time: number } | null;
  xLimit: number;
  nextId: number;
  rosterTimer: number;
  time: number;
  /** Where the latest toy throw started; a fetching dog brings the toy back here. */
  throwOrigin: GroundPoint | null;
};
