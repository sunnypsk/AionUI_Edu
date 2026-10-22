/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { useEffect, useMemo, useState } from 'react';
import { buildMessageAnchors, mergeMessageAnchors, type MessageAnchorItem } from './anchors';
import { loadConversationAnchors } from './loadAnchors';

/**
 * Combines lightweight historical previews with the live tail. Navigation
 * cancels the current HTTP read and prevents requesting subsequent pages.
 */
export const useConversationAnchors = (
  conversationId: string | undefined,
  liveMessages: TMessage[]
): MessageAnchorItem[] => {
  const [history, setHistory] = useState<{ id: string; anchors: MessageAnchorItem[] }>();

  useEffect(() => {
    if (!conversationId) return;
    const controller = new AbortController();
    setHistory(undefined);
    void loadConversationAnchors(conversationId, controller.signal)
      .then((anchors) => {
        if (!controller.signal.aborted) setHistory({ id: conversationId, anchors });
      })
      .catch(() => {
        // Navigation is best-effort when offline; the visible tail remains usable.
      });
    return () => controller.abort();
  }, [conversationId]);

  const liveAnchors = useMemo(() => buildMessageAnchors(liveMessages), [liveMessages]);

  return useMemo(
    () => mergeMessageAnchors(history && history.id === conversationId ? history.anchors : [], liveAnchors),
    [conversationId, liveAnchors, history]
  );
};
