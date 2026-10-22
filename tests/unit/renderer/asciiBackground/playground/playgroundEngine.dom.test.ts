/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundEngine } from '@/renderer/pages/guid/components/AsciiBackground/playground/playgroundEngine';
import { parseSaved, STORAGE_KEY } from '@/renderer/pages/guid/components/AsciiBackground/playground/storage';

const WIDTH = 1200;
const HEIGHT = 800;

const fakeContext = (): CanvasRenderingContext2D =>
  ({
    setTransform: vi.fn(),
    measureText: () => ({ width: 3.6 }),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    font: '',
    fillStyle: '',
    textBaseline: 'top',
    textAlign: 'left',
  }) as unknown as CanvasRenderingContext2D;

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
  };
};

const mount = () => {
  const surface = document.createElement('div');
  const root = document.createElement('div');
  const canvas = document.createElement('canvas');
  const button = document.createElement('button');
  root.appendChild(canvas);
  surface.append(root, button);
  document.body.appendChild(surface);
  Object.defineProperty(root, 'clientWidth', { value: WIDTH });
  Object.defineProperty(root, 'clientHeight', { value: HEIGHT });
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  return { surface, root, canvas, button };
};

const click = (target: Element, x: number, y: number): void => {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
};

const savedKinds = (storage: ReturnType<typeof memoryStorage>): string[] =>
  parseSaved(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'))?.items.map((i) => i.kind) ?? [];

describe('PlaygroundEngine', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('returns null when the browser has no 2D canvas context', () => {
    const { root, canvas } = mount();
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(PlaygroundEngine.create({ canvas, root, reducedMotion: false, storage: null })).toBeNull();
  });

  it('drops food where the empty background is clicked and saves it on destroy', () => {
    const { surface, root, canvas } = mount();
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeContext() as never);
    const storage = memoryStorage();
    const engine = PlaygroundEngine.create({ canvas, root, reducedMotion: false, storage, random: () => 0.5 });
    engine?.start();
    click(surface, WIDTH / 2, HEIGHT * 0.9);
    engine?.destroy();
    expect(savedKinds(storage)).toContain('food');
  });

  it('ignores clicks on real controls and stops listening after destroy', () => {
    const { surface, root, canvas, button } = mount();
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeContext() as never);
    const storage = memoryStorage();
    const engine = PlaygroundEngine.create({ canvas, root, reducedMotion: false, storage, random: () => 0.5 });
    engine?.start();
    click(button, WIDTH / 2, HEIGHT * 0.9);
    engine?.destroy();
    click(surface, WIDTH / 2, HEIGHT * 0.9);
    expect(savedKinds(storage)).not.toContain('food');
  });

  it('stays still and never saves with reduced motion', () => {
    const { surface, root, canvas } = mount();
    vi.spyOn(canvas, 'getContext').mockReturnValue(fakeContext() as never);
    const storage = memoryStorage();
    const engine = PlaygroundEngine.create({ canvas, root, reducedMotion: true, storage });
    engine?.start();
    click(surface, WIDTH / 2, HEIGHT * 0.9);
    engine?.destroy();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
