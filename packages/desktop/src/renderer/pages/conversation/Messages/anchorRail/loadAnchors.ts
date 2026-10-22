/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { httpRequest } from '@/common/adapter/httpBridge';
import { anchorPreview, type MessageAnchorItem } from './anchors';

type AnchorPage = {
  items: { id: string; msg_id: string | null; question: string; answer: string }[];
  next_cursor: string | null;
};

/** Loads bounded turn previews, cancelling both the current HTTP read and further pages. */
export const loadConversationAnchors = async (
  conversationId: string,
  signal: AbortSignal
): Promise<MessageAnchorItem[]> => {
  const anchors: MessageAnchorItem[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    const query = new URLSearchParams({ limit: '200' });
    if (cursor) query.set('after', cursor);
    const page: AnchorPage = await httpRequest(
      'GET',
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/anchors?${query}`,
      undefined,
      { signal }
    );
    signal.throwIfAborted();
    for (const item of page.items) {
      anchors.push({
        index: anchors.length + 1,
        messageId: item.id,
        msgId: item.msg_id ?? undefined,
        question: anchorPreview(item.question),
        answer: anchorPreview(item.answer),
      });
    }
    cursor = page.next_cursor;
    if (cursor && cursors.has(cursor)) throw new Error('Anchor pagination did not advance');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return anchors;
};
