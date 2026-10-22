/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { D_FAR } from '@/renderer/pages/guid/components/AsciiBackground/playground/stage';
import {
  loadWorld,
  parseSaved,
  saveWorld,
  serializeWorld,
  STORAGE_KEY,
} from '@/renderer/pages/guid/components/AsciiBackground/playground/storage';
import { createWorld, dropFood } from '@/renderer/pages/guid/components/AsciiBackground/playground/world';
import { openEnv } from './fixtures';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};

describe('playground storage', () => {
  it('round-trips pets and items', () => {
    const storage = memoryStorage();
    const world = createWorld(400, openEnv());
    world.pets[0].needs.hunger = 0.42;
    saveWorld(storage, world, 1000);
    const loaded = loadWorld(storage, 400, openEnv(), 1000);
    expect(loaded?.pets.map((p) => p.id)).toEqual(world.pets.map((p) => p.id));
    expect(loaded?.pets[0].needs.hunger).toBeCloseTo(0.42);
    expect(loaded?.items.map((i) => i.kind).toSorted()).toEqual(['ball', 'bone']);
  });

  it('refits saved positions to a smaller floor', () => {
    const storage = memoryStorage();
    const world = createWorld(800, openEnv());
    world.pets[0].x = 800 * D_FAR;
    world.pets[0].d = D_FAR;
    saveWorld(storage, world, 0);
    const loaded = loadWorld(storage, 100, openEnv(), 0);
    expect(loaded?.pets[0].x).toBeLessThanOrEqual(100 * D_FAR);
  });

  it('lets needs grow a little while away, but only up to a cap', () => {
    const storage = memoryStorage();
    const world = createWorld(400, openEnv());
    world.pets[0].needs.hunger = 0;
    saveWorld(storage, world, 0);
    const soon = loadWorld(storage, 400, openEnv(), 60_000);
    const years = loadWorld(storage, 400, openEnv(), 1e12);
    expect(soon?.pets[0].needs.hunger).toBeGreaterThan(0);
    expect(years?.pets[0].needs.hunger).toBeLessThan(1);
  });

  it('gives fresh items ids that do not collide with saved ones', () => {
    const storage = memoryStorage();
    saveWorld(storage, createWorld(400, openEnv()), 0);
    const loaded = loadWorld(storage, 400, openEnv(), 0);
    if (!loaded) throw new Error('save did not load');
    const ids = new Set([...loaded.pets, ...loaded.items].map((e) => e.id));
    expect(ids.has(dropFood(loaded, { x: 0, d: 1.5 }).id)).toBe(false);
  });

  it('rejects corrupt, foreign or inconsistent saves', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    expect(loadWorld(storage, 400, openEnv(), 0)).toBeNull();
    const saved = serializeWorld(createWorld(400, openEnv()), 0);
    expect(parseSaved({ ...saved, version: 99 })).toBeNull();
    expect(parseSaved({ ...saved, pets: [...saved.pets, saved.pets[0]] })).toBeNull();
  });

  it('survives storage that is missing or refuses writes', () => {
    const failing = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    };
    expect(saveWorld(failing, createWorld(400, openEnv()), 0)).toBe(false);
    expect(loadWorld(null, 400, openEnv(), 0)).toBeNull();
  });
});
