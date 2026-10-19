/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { isElectronDesktop } from '@/renderer/utils/platform';

/**
 * Teachers on the WebUI cannot act on "newer than verified"; the settings panel explains it instead.
 * Shared by MessageList (drops the row) and MessageTips (renders nothing) so both apply one rule.
 */
export const isHiddenVersionTip = (code: string | undefined): boolean =>
  code === 'CLI_VERSION_NEWER' && !isElectronDesktop();

export const isHiddenTipMessage = (message: TMessage): boolean =>
  message.type === 'tips' && isHiddenVersionTip(message.content.code);
