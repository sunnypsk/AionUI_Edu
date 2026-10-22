/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';
import { getConversationOrNull, refreshConversationCache } from '@/renderer/pages/conversation/utils/conversationCache';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

const mockConversation = {
  id: 'conv-1',
  name: 'Test conversation',
  type: 'acp',
  status: 'finished',
  extra: {},
} as TChatConversation;

describe('conversationCache', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getConversationOrNull', () => {
    it('shares overlapping reads of the same conversation', async () => {
      let resolve!: (conversation: TChatConversation) => void;
      vi.mocked(ipcBridge.conversation.get.invoke).mockReturnValue(
        new Promise((done) => {
          resolve = done;
        })
      );

      const reads = [getConversationOrNull('shared'), getConversationOrNull('shared')];
      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledTimes(1);
      resolve(mockConversation);
      expect(await Promise.all(reads)).toEqual([mockConversation, mockConversation]);
    });

    it('keeps different conversations independent and refetches after completion', async () => {
      vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(mockConversation);

      await Promise.all([getConversationOrNull('first'), getConversationOrNull('second')]);
      await getConversationOrNull('first');

      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledTimes(3);
    });

    it('allows a new read after a failed request', async () => {
      vi.mocked(ipcBridge.conversation.get.invoke)
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(mockConversation);

      await expect(getConversationOrNull('retry')).rejects.toThrow('offline');
      await expect(getConversationOrNull('retry')).resolves.toBe(mockConversation);
    });

    it('returns null when the backend reports a missing conversation', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('missing')).resolves.toBeNull();
    });

    it('returns the conversation when the backend lookup succeeds', async () => {
      vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(mockConversation);

      await expect(getConversationOrNull('conv-1')).resolves.toBe(mockConversation);
    });

    it('rethrows non-404 backend errors so database failures remain visible', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('conv-1')).rejects.toBe(error);
    });
  });

  describe('refreshConversationCache', () => {
    it('refreshes after an edit without reusing an older read still in flight', async () => {
      let resolveOld!: (conversation: TChatConversation) => void;
      let resolveFresh!: (conversation: TChatConversation) => void;
      vi.mocked(ipcBridge.conversation.get.invoke)
        .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
        .mockReturnValueOnce(new Promise((done) => (resolveFresh = done)));

      const olderRead = getConversationOrNull('edited');
      const refresh = refreshConversationCache('edited');
      resolveOld(mockConversation);
      await olderRead;
      const sharedFreshRead = getConversationOrNull('edited');
      const renamed = { ...mockConversation, name: 'Renamed' };
      resolveFresh(renamed);
      await refresh;

      expect(await sharedFreshRead).toBe(renamed);
      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledTimes(2);
      expect(mutate).toHaveBeenCalledWith('conversation/edited', renamed, false);
    });

    it('skips cache mutation when the conversation is missing', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('missing')).resolves.toBeUndefined();

      expect(mutate).not.toHaveBeenCalled();
    });

    it('rethrows non-404 backend errors instead of hiding them', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('conv-1')).rejects.toBe(error);

      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
