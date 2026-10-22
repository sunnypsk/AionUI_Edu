/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

const pendingReads = new Map<string, Promise<TChatConversation | null>>();

async function readConversation(conversation_id: string): Promise<TChatConversation | null> {
  try {
    return await ipcBridge.conversation.get.invoke({ id: conversation_id });
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/** Share concurrent reads; mutations can request a fresh snapshot without reusing a stale request. */
export function getConversationOrNull(
  conversation_id: string,
  options: { fresh?: boolean } = {}
): Promise<TChatConversation | null> {
  const pending = pendingReads.get(conversation_id);
  if (pending && !options.fresh) return pending;

  const request = readConversation(conversation_id).finally(() => {
    // An older request must not remove a newer post-mutation read.
    if (pendingReads.get(conversation_id) === request) pendingReads.delete(conversation_id);
  });
  pendingReads.set(conversation_id, request);
  return request;
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await getConversationOrNull(conversation_id, { fresh: true });
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
