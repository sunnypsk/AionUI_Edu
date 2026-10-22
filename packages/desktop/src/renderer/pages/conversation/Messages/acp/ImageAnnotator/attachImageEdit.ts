/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { uploadFileViaHttp } from '@/renderer/services/FileService';
import { emitter } from '@/renderer/utils/emitter';
import type { ImageEditResult } from './types';

type AttachImageEditOptions = {
  conversationId: string;
  fileName: string;
  edit: ImageEditResult;
  prompt: string;
};

/** Split `name.ext` into base and extension; extensionless names keep an empty extension. */
export const splitFileName = (fileName: string): { base: string; ext: string } => {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { base: fileName || 'image', ext: '' };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot) };
};

/**
 * Upload the original and annotated images into the conversation and stage them,
 * together with the edit prompt, in the Codex send box for the user to review and send.
 * The original goes first so the prompt can refer to the attachments by order.
 */
export const attachImageEditToSendBox = async ({
  conversationId,
  fileName,
  edit,
  prompt,
}: AttachImageEditOptions): Promise<void> => {
  const { base, ext } = splitFileName(fileName);
  const originalName = `${base}${ext || '.png'}`;
  const editedName = `${base}-edit.png`;
  const originalFile = new File([edit.original], originalName, { type: edit.original.type || 'image/png' });
  const editedFile = new File([edit.annotated], editedName, { type: 'image/png' });
  const originalPath = await uploadFileViaHttp(originalFile, conversationId, undefined, originalName);
  const editedPath = await uploadFileViaHttp(editedFile, conversationId, undefined, editedName);
  emitter.emit('acp.selected.file.append', [originalPath, editedPath], conversationId);
  emitter.emit('sendbox.fill', prompt);
};
