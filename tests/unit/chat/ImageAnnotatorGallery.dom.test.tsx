/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';
import type { ConversationContextValue } from '@/renderer/hooks/context/ConversationContext';
import { ToolImageGallery } from '@/renderer/pages/conversation/Messages/components/MessageToolCall';
import { emitter } from '@/renderer/utils/emitter';

const mockUpload = vi.fn();
const mockExportScene = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@/renderer/services/FileService', () => ({
  uploadFileViaHttp: (...args: unknown[]) => mockUpload(...args),
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/ImageAnnotator/drawAnnotations', async () => {
  const actual = await vi.importActual<
    typeof import('@/renderer/pages/conversation/Messages/acp/ImageAnnotator/drawAnnotations')
  >('@/renderer/pages/conversation/Messages/acp/ImageAnnotator/drawAnnotations');
  return {
    ...actual,
    // jsdom has no 2D canvas; rendering is a no-op and export returns a stub PNG.
    renderScene: vi.fn(),
    exportScene: (...args: unknown[]) => mockExportScene(...args),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.instruction ? `${key}:${options.instruction}` : key,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [{ success: mockMessageSuccess, error: mockMessageError }, null],
    },
  };
});

const IMAGE = { path: '/home/u/.codex/generated_images/s1/ig_cat.png', mime_type: 'image/png' };

const codexContext: ConversationContextValue = { conversation_id: 'conv-1', type: 'acp', backend: 'codex' };

const renderGallery = (context: ConversationContextValue | null, editable = true) => {
  const gallery = <ToolImageGallery images={[IMAGE]} editable={editable} />;
  return render(context ? <ConversationProvider value={context}>{gallery}</ConversationProvider> : gallery);
};

const originalBlob = new Blob(['original'], { type: 'image/png' });
const annotatedBlob = new Blob(['annotated'], { type: 'image/png' });

describe('ToolImageGallery image editing', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockUpload.mockReset();
    mockUpload.mockImplementation(async (file: File) => `/uploads/${file.name}`);
    mockExportScene.mockReset();
    mockExportScene.mockResolvedValue(annotatedBlob);
    mockMessageSuccess.mockClear();
    mockMessageError.mockClear();
    emitSpy = vi.spyOn(emitter, 'emit');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.stubGlobal(
      'fetch',
      // Node's Response expects Blob.stream(), which jsdom's Blob does not provide.
      vi.fn(async () => ({ ok: true, status: 200, blob: async () => originalBlob }))
    );
    URL.createObjectURL = vi.fn(() => 'blob:original');
    URL.revokeObjectURL = vi.fn();
    // jsdom never decodes images; fire load as soon as a source is assigned.
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      set(this: HTMLImageElement) {
        setTimeout(() => this.dispatchEvent(new Event('load')), 0);
      },
      get: () => 'blob:original',
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { configurable: true, get: () => 300 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Restore jsdom's own image accessors for other suites.
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).src;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalHeight;
  });

  it('offers editing for generated images in Codex conversations', () => {
    renderGallery(codexContext);
    expect(screen.getByLabelText('acp.image.edit.open_aria')).toBeInTheDocument();
  });

  it('hides editing for other agent backends', () => {
    renderGallery({ ...codexContext, backend: 'claude' });
    expect(screen.queryByLabelText('acp.image.edit.open_aria')).not.toBeInTheDocument();
  });

  it('hides editing for observation images such as screenshots', () => {
    renderGallery(codexContext, false);
    expect(screen.queryByLabelText('acp.image.edit.open_aria')).not.toBeInTheDocument();
  });

  it('hides editing where the conversation has no send box', () => {
    renderGallery({ ...codexContext, hideSendBox: true });
    expect(screen.queryByLabelText('acp.image.edit.open_aria')).not.toBeInTheDocument();
  });

  it('hides editing outside a conversation', () => {
    renderGallery(null);
    expect(screen.queryByLabelText('acp.image.edit.open_aria')).not.toBeInTheDocument();
  });

  const openEditorAndDraw = async () => {
    renderGallery(codexContext);
    fireEvent.click(screen.getByLabelText('acp.image.edit.open_aria'));
    const canvas = await screen.findByTestId('image-annotator-canvas');
    fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 50, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
  };

  it('keeps the attach action disabled until the user marks up the image or writes an instruction', async () => {
    renderGallery(codexContext);
    fireEvent.click(screen.getByLabelText('acp.image.edit.open_aria'));
    await screen.findByTestId('image-annotator-canvas');
    expect(screen.getByRole('button', { name: 'acp.image.edit.submit' })).toBeDisabled();
  });

  it('uploads original then annotated image and stages both with the prompt in the Codex send box', async () => {
    await openEditorAndDraw();
    fireEvent.change(screen.getByPlaceholderText('acp.image.edit.instruction_placeholder'), {
      target: { value: 'make the cat orange' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'acp.image.edit.submit' }));

    await waitFor(() => expect(mockMessageSuccess).toHaveBeenCalledWith('acp.image.edit.attached'));
    expect(mockUpload.mock.calls.map((call) => (call[0] as File).name)).toEqual(['ig_cat.png', 'ig_cat-edit.png']);
    expect(emitSpy).toHaveBeenCalledWith(
      'acp.selected.file.append',
      ['/uploads/ig_cat.png', '/uploads/ig_cat-edit.png'],
      'conv-1'
    );
    expect(emitSpy).toHaveBeenCalledWith('sendbox.fill', 'acp.image.edit.prompt_with_instruction:make the cat orange');
  });

  it('exports the drawn annotation rather than the untouched scene', async () => {
    await openEditorAndDraw();
    fireEvent.click(screen.getByRole('button', { name: 'acp.image.edit.submit' }));
    await waitFor(() => expect(mockExportScene).toHaveBeenCalled());
    const scene = mockExportScene.mock.calls[0][3] as { annotations: Array<{ kind: string }> };
    expect(scene.annotations.map((annotation) => annotation.kind)).toEqual(['stroke']);
  });

  it('reports a failure and stages nothing when the upload fails', async () => {
    mockUpload.mockRejectedValue(new Error('network down'));
    await openEditorAndDraw();
    fireEvent.click(screen.getByRole('button', { name: 'acp.image.edit.submit' }));

    await waitFor(() => expect(mockMessageError).toHaveBeenCalledWith('acp.image.edit.attach_error'));
    expect(emitSpy).not.toHaveBeenCalledWith('sendbox.fill', expect.anything());
  });

  it('shows a load error when the generated image cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    renderGallery(codexContext);
    fireEvent.click(screen.getByLabelText('acp.image.edit.open_aria'));
    expect(await screen.findByText('acp.image.edit.load_error')).toBeInTheDocument();
  });
});
