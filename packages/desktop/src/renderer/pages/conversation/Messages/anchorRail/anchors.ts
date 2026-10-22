/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import {
  isTextMessage,
  normalizeText,
  truncate,
} from '@/renderer/pages/conversation/components/ConversationTitleMinimap/minimapUtils';

/** One user message rendered as a tick on the anchor rail. */
export type MessageAnchorItem = {
  /** 1-based turn number, shown in the preview card. */
  index: number;
  /** Truncated user question for the preview card. */
  question: string;
  /** Truncated first AI reply of the turn; empty when the turn has no reply yet. */
  answer: string;
  /** Message id used to scroll the chat area to this turn. */
  messageId: string;
  msgId?: string;
};

const PREVIEW_MAX_LEN = 120;

/** Shared normalization for live messages and bounded server previews. */
export const anchorPreview = (text: string): string => truncate(normalizeText(text), PREVIEW_MAX_LEN);

/** Keeps historical turns while incorporating new or streaming turns from the visible tail. */
export const mergeMessageAnchors = (history: MessageAnchorItem[], live: MessageAnchorItem[]): MessageAnchorItem[] => {
  const merged = [...history];
  const positions = new Map(history.map((item, index) => [item.messageId, index]));
  const messagePositions = new Map(
    history.flatMap((item, index) => (item.msgId ? [[item.msgId, index] as const] : []))
  );
  for (const item of live) {
    const position = positions.get(item.messageId) ?? (item.msgId ? messagePositions.get(item.msgId) : undefined);
    if (position === undefined) {
      merged.push(item);
    } else {
      merged[position] = { ...item, answer: item.answer || merged[position].answer };
    }
  }
  return merged.map((item, index) => ({ ...item, index: index + 1 }));
};

/**
 * Collects the user messages of a conversation into rail anchors.
 *
 * Only user (right-positioned) text messages become ticks — mirroring the
 * conversation search panel's turn model — and each anchor carries the first AI
 * reply of its turn so the hover card can show a two-line preview.
 */
export const buildMessageAnchors = (messages: TMessage[]): MessageAnchorItem[] => {
  const anchors: MessageAnchorItem[] = [];
  let current: MessageAnchorItem | null = null;

  for (const message of messages) {
    if (message.hidden) continue;
    if (!isTextMessage(message)) continue;

    const text = normalizeText(message.content.content || '');
    if (!text) continue;

    if (message.position === 'right') {
      if (current) anchors.push(current);
      current = {
        index: anchors.length + 1,
        question: truncate(text, PREVIEW_MAX_LEN),
        answer: '',
        messageId: message.id,
        msgId: message.msg_id,
      };
      continue;
    }

    if (message.position === 'left' && current && !current.answer) {
      current.answer = truncate(text, PREVIEW_MAX_LEN);
    }
  }

  if (current) anchors.push(current);

  return anchors;
};
