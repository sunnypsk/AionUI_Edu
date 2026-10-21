/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configService } from '@/common/config/configService';
import type { IMcpServer } from '@/common/config/storage';
import { useGuidSend, type GuidSendDeps } from '@/renderer/pages/guid/hooks/useGuidSend';

const createConversationInvokeMock = vi.fn();
const swrMutateMock = vi.fn();
const runtimeEnvironment = vi.hoisted(() => ({ isDesktop: false }));

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => runtimeEnvironment.isDesktop }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      create: {
        invoke: (...args: unknown[]) => createConversationInvokeMock(...args),
      },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    emit: vi.fn(),
  },
}));

vi.mock('swr', () => ({
  mutate: (...args: unknown[]) => swrMutateMock(...args),
}));

vi.mock('@/renderer/utils/workspace/workspaceHistory', () => ({
  updateWorkspaceTime: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const createDeps = (): GuidSendDeps => ({
  input: 'hello',
  setInput: vi.fn(),
  files: [],
  setFiles: vi.fn(),
  dir: '',
  setDir: vi.fn(),
  setLoading: vi.fn(),
  loading: false,
  selectedAssistantId: 'assistant-1',
  selectedAssistantBackend: 'codex',
  selectedMode: 'bypassPermissions',
  guidDisabledBuiltinSkills: undefined,
  guidEnabledSkills: undefined,
  assistantDefaultSkillIds: undefined,
  assistantDefaultDisabledBuiltinSkillIds: undefined,
  availableMcpServers: [{ id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer],
  selectedMcpServerIds: ['mcp-user'],
  assistantDefaultMcpIds: undefined,
  setMentionOpen: vi.fn(),
  setMentionQuery: vi.fn(),
  setMentionSelectorOpen: vi.fn(),
  setMentionActiveIndex: vi.fn(),
  navigate: vi.fn(() => Promise.resolve()) as never,
  t: vi.fn((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as never,
  localeKey: 'zh-CN',
});

describe('useGuidSend', () => {
  beforeEach(() => {
    runtimeEnvironment.isDesktop = false;
    configService.reset();
    sessionStorage.clear();
    createConversationInvokeMock.mockReset();
    createConversationInvokeMock.mockResolvedValue({ id: 'conv-1' });
    swrMutateMock.mockReset();
    swrMutateMock.mockResolvedValue(undefined);
  });

  it('creates a new managed folder even when legacy WebUI state supplies a project directory', async () => {
    const deps = createDeps();
    deps.dir = '/existing-project';
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => result.current.handleSend());
    expect(createConversationInvokeMock.mock.calls[0][0].extra).toMatchObject({
      workspace: '',
      custom_workspace: false,
    });
  });

  it('preserves explicitly selected folders in the Electron desktop app', async () => {
    runtimeEnvironment.isDesktop = true;
    const deps = createDeps();
    deps.dir = '/desktop-project';
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => result.current.handleSend());
    expect(createConversationInvokeMock.mock.calls[0][0].extra).toMatchObject({
      workspace: '/desktop-project',
      custom_workspace: true,
    });
  });

  it('passes selected mode into assistant conversation overrides when creating a preset ACP conversation', async () => {
    const deps = createDeps();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.type).toBeUndefined();
    expect('model' in payload).toBe(false);
    expect(payload.assistant?.conversation_overrides?.permission).toBe('bypassPermissions');
    expect(payload.assistant?.conversation_overrides?.model).toBe('gpt-6-astra');
    expect(payload.assistant?.conversation_overrides?.thought_level).toBe('low');
    expect(payload.extra.backend).toBeUndefined();
    expect(payload.extra.agent_name).toBeUndefined();
    expect(payload.extra.agent_id).toBeUndefined();
    expect(payload.extra.custom_agent_id).toBeUndefined();
    expect(payload.extra.preset_rules).toBeUndefined();
    expect(payload.extra.preset_context).toBeUndefined();
    expect(payload.extra.session_mode).toBeUndefined();
    expect(payload.extra.current_model_id).toBeUndefined();
    expect(payload.extra.preset_assistant_id).toBeUndefined();
    expect(swrMutateMock).toHaveBeenCalledWith('guid.assistant.detail.assistant-1.zh-CN');
    expect(swrMutateMock).toHaveBeenCalledWith('assistants.list');
  });

  it('creates a new conversation with full access selected in the composer', async () => {
    const deps = createDeps();
    deps.selectedMode = 'full-access';
    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => result.current.handleSend());

    expect(createConversationInvokeMock.mock.calls[0][0].assistant.conversation_overrides.permission).toBe(
      'full-access'
    );
  });

  it('falls back to assistant default skill and MCP ids for preset conversations before local Guid overrides exist', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = undefined;
    deps.guidDisabledBuiltinSkills = undefined;
    deps.assistantDefaultSkillIds = ['assistant-skill'];
    deps.assistantDefaultDisabledBuiltinSkillIds = ['builtin-skill'];
    deps.selectedMcpServerIds = undefined;
    deps.assistantDefaultMcpIds = ['mcp-user'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['assistant-skill']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['builtin-skill']);
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
  });

  it('preserves builtin MCP ids in assistant overrides while only sending user MCP ids to runtime selection', async () => {
    const deps = createDeps();
    deps.availableMcpServers = [
      { id: 'mcp-user', name: 'User MCP', enabled: true, builtin: false } as IMcpServer,
      { id: 'builtin-mcp', name: 'Builtin MCP', enabled: true, builtin: true } as IMcpServer,
    ];
    deps.selectedMcpServerIds = ['mcp-user', 'builtin-mcp'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.conversation_overrides?.mcp_ids).toEqual(['mcp-user', 'builtin-mcp']);
    expect(payload.extra.selected_mcp_server_ids).toEqual(['mcp-user']);
    expect(payload.extra.selected_session_mcp_servers).toEqual([expect.objectContaining({ id: 'builtin-mcp' })]);
  });

  it('does not write legacy preset_assistant_id for preset assistant sends', async () => {
    const deps = createDeps();

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.extra.preset_assistant_id).toBeUndefined();
  });

  it('forwards local skill overrides through assistant conversation overrides for ACP assistants', async () => {
    const deps = createDeps();
    deps.guidEnabledSkills = ['pdf-reader'];
    deps.guidDisabledBuiltinSkills = ['todo-tracker'];

    const { result } = renderHook(() => useGuidSend(deps));

    await act(async () => {
      await result.current.handleSend();
    });

    const payload = createConversationInvokeMock.mock.calls[0][0];
    expect(payload.assistant?.id).toBe('assistant-1');
    expect(payload.assistant?.conversation_overrides?.skill_ids).toEqual(['pdf-reader']);
    expect(payload.assistant?.conversation_overrides?.disabled_builtin_skill_ids).toEqual(['todo-tracker']);
  });

  it('reads the latest saved Settings values when creating a conversation', async () => {
    const { result } = renderHook(() => useGuidSend(createDeps()));
    configService.setLocal('codex.settings', { model: 'gpt-6-astra', reasoningEffort: 'high' });
    await act(async () => result.current.handleSend());
    expect(createConversationInvokeMock.mock.calls[0][0].assistant.conversation_overrides).toMatchObject({
      model: 'gpt-6-astra',
      thought_level: 'high',
    });
  });

  it.each(['claude', 'aionrs', 'antigravity', ''])(
    'blocks an unsupported %s backend even if selected by stale state',
    async (backend) => {
      const deps = createDeps();
      deps.selectedAssistantBackend = backend;
      const { result } = renderHook(() => useGuidSend(deps));
      await act(async () => result.current.handleSend());
      expect(createConversationInvokeMock).not.toHaveBeenCalled();
      expect(result.current.isButtonDisabled).toBe(true);
    }
  );

  it('does not create a conversation without an assistant identity', async () => {
    const deps = createDeps();
    deps.selectedAssistantId = null;
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => result.current.handleSend());
    expect(createConversationInvokeMock).not.toHaveBeenCalled();
  });

  it('allows starting an empty Codex session without sending an initial message', async () => {
    const deps = createDeps();
    deps.input = '';
    const { result } = renderHook(() => useGuidSend(deps));
    await act(async () => result.current.handleSend());
    expect(createConversationInvokeMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('acp_initial_message_conv-1')).toBeNull();
    expect(deps.navigate).toHaveBeenCalledWith('/conversation/conv-1');
  });
});
