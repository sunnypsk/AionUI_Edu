/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import AsciiBackground from '@/renderer/pages/guid/components/AsciiBackground';

// jsdom has no canvas 2D context, so these tests exercise the graceful-degradation path.

describe('AsciiBackground', () => {
  it('renders a decorative, non-interactive container', () => {
    const clearRef = { current: null };
    const { getByTestId } = render(<AsciiBackground visitKey='visit-1' clearRef={clearRef} />);
    const root = getByTestId('ascii-background');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelector('canvas')).not.toBeNull();
  });

  it('keeps rendering when the browser cannot provide a 2D context', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clearRef = { current: null };
    expect(() => render(<AsciiBackground visitKey='visit-2' clearRef={clearRef} />)).not.toThrow();
    warn.mockRestore();
  });

  it('re-initializes without crashing when the visit key changes', () => {
    const clearRef = { current: null };
    const { rerender, getByTestId } = render(<AsciiBackground visitKey='visit-3' clearRef={clearRef} />);
    rerender(<AsciiBackground visitKey='visit-4' clearRef={clearRef} />);
    expect(getByTestId('ascii-background')).toBeInTheDocument();
  });
});
