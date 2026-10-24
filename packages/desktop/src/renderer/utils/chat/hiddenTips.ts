/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMessageTips, TMessage } from '@/common/chat/chatLib';
import { isElectronDesktop } from '@/renderer/utils/platform';

/**
 * Teachers on the WebUI cannot act on "newer than verified"; the settings panel explains it instead.
 * Shared by MessageList (drops the row) and MessageTips (renders nothing) so both apply one rule.
 */
export const isHiddenVersionTip = (code: string | undefined): boolean =>
  code === 'CLI_VERSION_NEWER' && !isElectronDesktop();

export const isHiddenTipMessage = (message: TMessage): boolean =>
  message.type === 'tips' && isHiddenVersionTip(message.content.code);

/**
 * Only known, non-actionable provider notices belong in technical details.
 * Match the same payload in live and persisted messages; never classify chat text,
 * coded guidance, approval rejections, or errors by a word such as "warning".
 */
export const isTechnicalTipMessage = (message: TMessage): message is IMessageTips => {
  if (message.type !== 'tips') return false;
  const { content, type, code, error } = message.content;
  if (type === 'error' || error || code) return false;
  const text = content.trim();

  return (
    /^Automatic approval review approved \(risk: (?:low|medium|high), authorization: (?:low|medium|high)\):/.test(
      text
    ) ||
    /^Full-history hydration is deprecated for paginated threads[;.]/.test(text) ||
    text.startsWith('Under-development features enabled:') ||
    text.startsWith('`[features].collab` is deprecated. Use `[features].multi_agent` instead.')
  );
};
