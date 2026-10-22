/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(
    (_handler: (event: { conversation_id: string; type: string; turn_id: string; data: object }) => void) => () => {}
  ),
  complete: vi.fn((_handler: (event: { session_id: string; turn_id: string; state: string }) => void) => () => {}),
  reconnect: vi.fn((_handler: () => void) => () => {}),
  get: vi.fn(),
}));
vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({ getConversationOrNull: mocks.get }));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: vi.fn(() => new Promise(() => {})) },
    },
    conversation: {
      listChanged: { on: () => () => {} },
      responseStream: { on: mocks.stream },
      turnCompleted: { on: mocks.complete },
      confirmation: { remove: { on: () => () => {} } },
    },
    realtime: { reconnected: { on: mocks.reconnect } },
    application: {
      writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: () => () => {} }));

import {
  reconcileGeneratingFromRuntime,
  beginSidebarRuntimeRead,
  reconcileSidebarRuntime,
  invalidateSidebarRuntime,
  useConversationListSync,
} from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

describe('reconcileGeneratingFromRuntime', () => {
  // Each test uses a distinct conversation id (conv-a/b/c/d) since the store
  // backing this hook is module-level and persists across tests in this file.

  it('marks a conversation generating when isProcessing is true', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-a', true);
    });

    expect(result.current.isConversationGenerating('conv-a')).toBe(true);
  });

  it('does not touch other conversations when reconciling one id', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-b', true);
    });

    expect(result.current.isConversationGenerating('conv-b')).toBe(true);
    expect(result.current.isConversationGenerating('conv-c')).toBe(false);
  });

  it('leaves the generating state unchanged when isProcessing is false', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      reconcileGeneratingFromRuntime('conv-d', false);
    });

    expect(result.current.isConversationGenerating('conv-d')).toBe(false);
  });
});

const runtime = (turn: string | null): TConversationRuntimeSummary => ({
  state: turn ? 'running' : 'idle',
  turn_id: turn,
  is_processing: Boolean(turn),
  can_send_message: !turn,
  has_task: Boolean(turn),
  task_status: turn ? 'running' : 'finished',
  pending_confirmations: 0,
});

describe('guarded runtime reconciliation', () => {
  it('clears a stale spinner using a fresh idle snapshot', () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => {
      reconcileGeneratingFromRuntime('idle-reconcile', true);
      reconcileSidebarRuntime('idle-reconcile', runtime(null), beginSidebarRuntimeRead('idle-reconcile'));
    });
    expect(result.current.isConversationGenerating('idle-reconcile')).toBe(false);
  });

  it('rejects an idle read superseded by a local send', () => {
    const { result } = renderHook(() => useConversationListSync());
    const read = beginSidebarRuntimeRead('local-send');
    act(() => {
      invalidateSidebarRuntime('local-send');
      reconcileGeneratingFromRuntime('local-send', true);
      expect(reconcileSidebarRuntime('local-send', runtime(null), read)).toBe(false);
    });
    expect(result.current.isConversationGenerating('local-send')).toBe(true);
  });

  it('rejects an older request after a newer busy result', () => {
    const { result } = renderHook(() => useConversationListSync());
    const old = beginSidebarRuntimeRead('request-order');
    const latest = beginSidebarRuntimeRead('request-order');
    act(() => {
      reconcileSidebarRuntime('request-order', runtime('new-turn'), latest);
      reconcileSidebarRuntime('request-order', runtime(null), old);
    });
    expect(result.current.isConversationGenerating('request-order')).toBe(true);
  });

  it('does not let an old terminal frame or completion clear the current turn', () => {
    const { result } = renderHook(() => useConversationListSync());
    act(() => reconcileSidebarRuntime('turn-guard', runtime('new'), beginSidebarRuntimeRead('turn-guard')));
    const stream = mocks.stream.mock.calls[0][0];
    const complete = mocks.complete.mock.calls[0][0];
    act(() => {
      stream({ conversation_id: 'turn-guard', type: 'finish', turn_id: 'old', data: {} });
      complete({ session_id: 'turn-guard', turn_id: 'old', state: 'ai_waiting_input' });
    });
    expect(result.current.isConversationGenerating('turn-guard')).toBe(true);
    act(() => complete({ session_id: 'turn-guard', turn_id: 'new', state: 'ai_waiting_input' }));
    expect(result.current.isConversationGenerating('turn-guard')).toBe(false);
  });

  it('reconciles background conversations after reconnect, including idle results', async () => {
    const { result } = renderHook(() => useConversationListSync());
    mocks.get.mockResolvedValue({ runtime: runtime(null) });
    act(() => {
      reconcileGeneratingFromRuntime('background-one', true);
      reconcileGeneratingFromRuntime('background-two', true);
    });
    await act(async () => {
      mocks.reconnect.mock.calls[0][0]();
    });
    expect(mocks.get).toHaveBeenCalledWith('background-two', { fresh: true });
    expect(result.current.isConversationGenerating('background-one')).toBe(false);
    expect(result.current.isConversationGenerating('background-two')).toBe(false);
  });
});
