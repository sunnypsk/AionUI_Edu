/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnnotatorToolbar from '@/renderer/pages/conversation/Messages/acp/ImageAnnotator/AnnotatorToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const renderToolbar = (canUndo: boolean, onUndo = vi.fn()) => (
  <AnnotatorToolbar
    tool='brush'
    color='#F53F3F'
    size='medium'
    canUndo={canUndo}
    canRedo={false}
    canClear={canUndo}
    onToolChange={vi.fn()}
    onColorChange={vi.fn()}
    onSizeChange={vi.fn()}
    onUndo={onUndo}
    onRedo={vi.fn()}
    onClear={vi.fn()}
  />
);

describe('AnnotatorToolbar history buttons', () => {
  it('keeps the tooltip anchor element stable when undo becomes disabled', () => {
    // Arco wraps disabled buttons in a fresh span; if that span were the tooltip anchor,
    // an open tooltip would lose its element and crash while positioning the popup.
    const { rerender } = render(renderToolbar(true));
    const anchor = screen.getByLabelText('acp.image.edit.undo').parentElement;
    rerender(renderToolbar(false));
    expect(screen.getByLabelText('acp.image.edit.undo').parentElement).toBe(anchor);
  });

  it('does not fire undo while there is nothing to undo', () => {
    const onUndo = vi.fn();
    render(renderToolbar(false, onUndo));
    fireEvent.click(screen.getByLabelText('acp.image.edit.undo'));
    expect(onUndo).not.toHaveBeenCalled();
  });
});
