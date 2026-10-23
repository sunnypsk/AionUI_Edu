/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSlashCommands } from '@/renderer/hooks/chat/useSlashCommands';

const { getRuntimeInvokeMock, ensureRuntimeInvokeMock, getSlashCommandsInvokeMock } = vi.hoisted(() => ({
  getRuntimeInvokeMock: vi.fn(),
  ensureRuntimeInvokeMock: vi.fn(),
  getSlashCommandsInvokeMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      getRuntime: { invoke: getRuntimeInvokeMock },
      ensureRuntime: {
        invoke: ensureRuntimeInvokeMock,
      },
      getSlashCommands: {
        invoke: getSlashCommandsInvokeMock,
      },
    },
  },
}));

describe('useSlashCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRuntimeInvokeMock.mockResolvedValue({ config_options: [], runtime: { has_task: true } });
    ensureRuntimeInvokeMock.mockResolvedValue({ recovered: false, config_options: [], runtime: null });
    getSlashCommandsInvokeMock.mockResolvedValue([]);
  });

  it('preserves ACP slash-command metadata from the HTTP command list', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
        completion_behavior: 'neutral_tip_on_empty',
        empty_turn_tip_code: 'acp.empty_turn.choose_command',
        empty_turn_tip_params: {
          command_count: 1,
        },
      },
    ]);

    const { result } = renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
          emptyTurnTipCode: 'acp.empty_turn.choose_command',
          emptyTurnTipParams: {
            command_count: 1,
          },
        },
      ]);
    });
  });

  it('preserves ACP slash-command metadata from camelCase HTTP fields', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
        hint: '⌘R',
        completionBehavior: 'neutral_tip_on_empty',
        emptyTurnTipCode: 'acp.empty_turn.choose_command',
        emptyTurnTipParams: {
          command_count: 1,
        },
      },
    ]);

    const { result } = renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(result.current).toEqual([
        {
          name: 'review',
          description: 'Review the current diff',
          hint: '⌘R',
          kind: 'template',
          source: 'acp',
          selectionBehavior: 'insert',
          completionBehavior: 'neutral_tip_on_empty',
          emptyTurnTipCode: 'acp.empty_turn.choose_command',
          emptyTurnTipParams: {
            command_count: 1,
          },
        },
      ]);
    });
  });

  it('reads an existing runtime before loading cached slash commands without ensuring', async () => {
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
      },
    ]);

    renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
      })
    );

    await waitFor(() => {
      expect(getRuntimeInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
      expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(getRuntimeInvokeMock.mock.invocationCallOrder[0]).toBeLessThan(
      getSlashCommandsInvokeMock.mock.invocationCallOrder[0]
    );
  });

  it('uses injected runtime preparation for an explicit slash interaction', async () => {
    const prepareRuntime = vi.fn().mockResolvedValue(undefined);
    getSlashCommandsInvokeMock.mockResolvedValue([
      {
        command: 'review',
        description: 'Review the current diff',
      },
    ]);

    renderHook(() =>
      useSlashCommands('conv-1', {
        conversation_type: 'acp',
        agentStatus: 'session_active',
        prepareRuntime,
        interactive: true,
      })
    );

    await waitFor(() => {
      expect(prepareRuntime).toHaveBeenCalled();
      expect(getSlashCommandsInvokeMock).toHaveBeenCalledWith({ conversation_id: 'conv-1' });
    });
    expect(ensureRuntimeInvokeMock).not.toHaveBeenCalled();
    expect(prepareRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      getSlashCommandsInvokeMock.mock.invocationCallOrder[0]
    );
  });
});
