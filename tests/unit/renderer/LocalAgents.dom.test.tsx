/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Render test for the LocalAgents settings surface. Its purpose is to lock in
 * that LocalAgents reads the management view (`useManagedAgents`) — the
 * include_disabled data path that keeps user-disabled agents listed — and
 * derives the detected/custom sections from it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// t() echoes the key so section labels/buttons are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

const { runtimeEnvironment } = vi.hoisted(() => ({ runtimeEnvironment: { isDesktop: true } }));
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

const { messageSuccess, messageWarning, messageError } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  messageError: vi.fn(),
}));
const { openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      useMessage: () => [
        {
          success: messageSuccess,
          warning: messageWarning,
          error: messageError,
        },
        null,
      ],
      success: messageSuccess,
      warning: messageWarning,
      error: messageError,
    },
  };
});

// Controlled management-view data; assert LocalAgents consumes THIS hook.
const useManagedAgents = vi.fn();
vi.mock('@renderer/hooks/agent/useManagedAgents', () => ({
  useManagedAgents: () => useManagedAgents(),
}));

// Bridge is only touched by user-action handlers, not on render — stub the
// shape the handlers reference so the import resolves.
vi.mock('@/common', () => ({
  ipcBridge: {
    webRuntime: {
      codexAccount: { invoke: vi.fn().mockResolvedValue({ authenticated: false, login: { state: 'idle' } }) },
      codexLogin: { invoke: vi.fn() },
      codexCancelLogin: { invoke: vi.fn() },
      codexLogout: { invoke: vi.fn() },
      networkProxy: {
        invoke: vi.fn().mockResolvedValue({
          enabled: false,
          endpoint: '',
          hasCredentials: false,
          active: false,
          pendingRestart: false,
          managedByEnvironment: false,
          containerSupported: true,
        }),
      },
      saveNetworkProxy: { invoke: vi.fn() },
    },
    acpConversation: {
      createCustomAgent: { invoke: vi.fn() },
      updateCustomAgent: { invoke: vi.fn() },
      deleteCustomAgent: { invoke: vi.fn() },
      setAgentEnabled: { invoke: vi.fn() },
      checkManagedAgentHealthById: { invoke: vi.fn() },
    },
    // Bound-assistant avatar stacks fetch the assistant list via SWR.
    assistants: {
      list: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@renderer/utils/platform', async () => {
  const actual = await vi.importActual<typeof import('@renderer/utils/platform')>('@renderer/utils/platform');
  return {
    ...actual,
    openExternalUrl,
    isElectronDesktop: () => runtimeEnvironment.isDesktop,
  };
});

// Keep the test focused on LocalAgents' own logic — stub heavy children.
vi.mock('@/renderer/components/base/AionModal', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/InlineAgentEditor', () => ({ default: () => null }));
vi.mock('@renderer/pages/settings/AgentSettings/AgentHubModal', () => ({ AgentHubModal: () => null }));

import LocalAgents from '@renderer/pages/settings/AgentSettings/LocalAgents';
import AgentModalContent from '@renderer/components/settings/SettingsModal/contents/AgentModalContent';
import { SettingsViewModeProvider } from '@renderer/components/settings/SettingsModal/settingsViewContext';
import { ipcBridge } from '@/common';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { getBoundAssistants } from '@renderer/pages/settings/AgentSettings/BoundAssistants';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { configService, readCodexSettings } from '@/common/config/configService';

const makeAgents = () => [
  {
    id: 'aionrs',
    name: 'Aion CLI',
    agent_type: 'aionrs',
    agent_source: 'internal',
    backend: 'aionrs',
    enabled: true,
    available: true,
    installed: true,
    status: 'online',
  },
  {
    id: 'acp-claude',
    name: 'Claude Code',
    agent_type: 'acp',
    agent_source: 'builtin',
    backend: 'claude',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'openclaw-gateway',
    name: 'OpenClaw Gateway',
    agent_type: 'openclaw-gateway',
    agent_source: 'builtin',
    backend: 'openclaw-gateway',
    enabled: true,
    available: false,
    installed: false,
    status: 'missing',
  },
  {
    id: 'custom-1',
    name: 'My Agent',
    agent_type: 'acp',
    agent_source: 'custom',
    command: 'sh',
    enabled: true,
    available: true,
    installed: true,
    status: 'offline',
  },
];

describe('LocalAgents', () => {
  it('runs the health probe and shows a success toast after an official-agent test connection succeeds', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'online',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      expect(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).toHaveBeenCalledWith({ id: 'aionrs' });
    });
    await waitFor(() => {
      expect(refreshCatalog).toHaveBeenCalled();
      expect(messageSuccess).toHaveBeenCalledWith('settings.agentManagement.testConnectionOnline');
    });
  });

  it('warns with the auth guidance when a test connection reports auth_required', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({ agents: makeAgents(), revalidate: vi.fn(), refreshCatalog });
    vi.mocked(ipcBridge.acpConversation.checkManagedAgentHealthById.invoke).mockResolvedValue({
      ...makeAgents()[0],
      status: 'offline',
      last_check_error_code: 'auth_required',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getAllByText('settings.agentManagement.testConnection')[0]);

    await waitFor(() => {
      // formatManagedAgentDiagnosticMessage maps auth_required → its errorCodes key.
      expect(messageWarning).toHaveBeenCalledWith('settings.agentManagement.errorCodes.auth_required');
    });
  });

  it('reads the managed-agents view and renders detected + custom sections', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Proves L30 (useManagedAgents) ran and fed the derived lists.
    expect(useManagedAgents).toHaveBeenCalled();
    expect(screen.getByText('Aion CLI')).toBeTruthy();
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByText('My Agent')).toBeTruthy();
  });

  it('shows the empty state when no detected agents are present', () => {
    useManagedAgents.mockReturnValue({ agents: [], revalidate: vi.fn(), refreshCatalog: vi.fn() });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.localAgentsEmpty')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customEmpty')).toBeTruthy();
  });

  it('renders official/custom sections with management statuses and removes the chat shortcut', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agents')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.customAgents')).toBeTruthy();
    // Only Claude Code shows 'missing' now; openclaw-gateway is filtered out as deprecated
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeTruthy();
    expect(screen.getByText('settings.agentManagement.statusOffline')).toBeTruthy();
    expect(screen.queryByText('settings.agentManagement.goToChat')).toBeNull();
    // Verify deprecated agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
  });

  it('shows a lightweight refresh hint while the management view is revalidating', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      isRefreshing: true,
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.getByText('settings.agentManagement.refreshingStatuses')).toBeInTheDocument();
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
  });

  it('renders official agents as diagnostics cards and filters out deprecated types', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Agent names render
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    // Deprecated openclaw-gateway agent is filtered out
    expect(screen.queryByText('OpenClaw Gateway')).toBeNull();
    // Status tags render
    expect(screen.getByText('settings.agentManagement.statusOnline')).toBeInTheDocument();
    expect(screen.getByText('settings.agentManagement.statusMissing')).toBeInTheDocument();
  });

  it('does not render the market-install CTA in the diagnostics-only agent page', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    expect(screen.queryByText('settings.agentManagement.installFromMarket')).toBeNull();
    expect(screen.queryByText('settings.agentManagement.discoverMoreAgents')).toBeNull();
  });

  it('renders the setup-guide action for official agents diagnostics', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByText('settings.agentManagement.localAgentsSetupLink'));

    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup');
  });

  it('binds assistants to managed agents by agent_id instead of runtime backend', () => {
    const [aionrsAgent, claudeAgent] = makeAgents();
    const assistants: Assistant[] = [
      {
        id: 'assistant-on-claude-runtime',
        source: 'generated',
        name: 'Claude Runtime',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 1,
        agent_id: 'acp-other-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
      {
        id: 'assistant-on-claude-agent',
        source: 'generated',
        name: 'Claude Agent',
        name_i18n: {},
        description_i18n: {},
        enabled: true,
        sort_order: 2,
        agent_id: 'acp-claude',
        preset_agent_type: 'claude',
        enabled_skills: [],
        custom_skill_names: [],
        disabled_builtin_skills: [],
        context_i18n: {},
        prompts: [],
        prompts_i18n: {},
        models: [],
        agent_status: 'online',
        team_selectable: true,
        deletable: true,
      },
    ];

    expect(getBoundAssistants(claudeAgent, assistants).map((assistant) => assistant.id)).toEqual([
      'assistant-on-claude-agent',
    ]);
    expect(getBoundAssistants(aionrsAgent, assistants)).toEqual([]);
  });

  it('pins Kimi right after the aionrs agent in the official list', () => {
    useManagedAgents.mockReturnValue({
      agents: [
        ...makeAgents(),
        {
          id: 'acp-kimi',
          name: 'Kimi',
          agent_type: 'acp',
          agent_source: 'builtin',
          backend: 'kimi',
          enabled: true,
          available: false,
          installed: false,
          status: 'missing',
        },
      ],
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Alphabetically Claude Code < Kimi, so this order proves the pin rule:
    // aionrs stays first, Kimi jumps ahead of the localeCompare ordering.
    const aion = screen.getByText('Aion CLI');
    const kimi = screen.getByText('Kimi');
    const claude = screen.getByText('Claude Code');
    expect(kimi.compareDocumentPosition(aion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(claude.compareDocumentPosition(kimi) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('shows only Codex in the Edu agent settings page', () => {
    mockMatchMedia();
    useManagedAgents.mockReturnValue({ agents: [...makeAgents(), codexAgent], refreshCatalog: vi.fn() });
    renderSettings();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.queryByText('Aion CLI')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-add-custom-agent')).not.toBeInTheDocument();
  });

  it('surfaces custom-agent toggle failures to the user', async () => {
    const refreshCatalog = vi.fn().mockResolvedValue(undefined);
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog,
    });
    vi.mocked(ipcBridge.acpConversation.setAgentEnabled.invoke).mockRejectedValue({
      backendMessage: 'permission denied',
    });

    render(<LocalAgents />);

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => {
      expect(ipcBridge.acpConversation.setAgentEnabled.invoke).toHaveBeenCalledWith({
        id: 'custom-1',
        enabled: false,
      });
      expect(messageError).toHaveBeenCalledWith('permission denied');
    });
    expect(refreshCatalog).not.toHaveBeenCalled();
  });

  it('renders the availability filter as underline tabs and switches the visible official agents', () => {
    useManagedAgents.mockReturnValue({
      agents: makeAgents(),
      revalidate: vi.fn(),
      refreshCatalog: vi.fn(),
    });

    render(<LocalAgents />);

    // Filter tabs render as buttons (underline-tab style), not an Arco radio group.
    const allTab = screen.getByTestId('settings-tab-all');
    const availableTab = screen.getByTestId('settings-tab-available');
    const unavailableTab = screen.getByTestId('settings-tab-unavailable');
    expect(allTab.tagName).toBe('BUTTON');

    // Default "all": both official agents visible (Aion CLI online, Claude Code missing).
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();

    // "available" keeps only the online agent.
    fireEvent.click(availableTab);
    expect(screen.getByText('Aion CLI')).toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).toBeNull();

    // "unavailable" keeps only the non-online agent.
    fireEvent.click(unavailableTab);
    expect(screen.queryByText('Aion CLI')).toBeNull();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });
});

const codexAgent = {
  id: 'acp-codex',
  name: 'Codex CLI',
  agent_type: 'acp',
  agent_source: 'builtin',
  backend: 'codex',
  enabled: true,
  available: true,
  installed: true,
  status: 'online',
};

function mockMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SettingsViewModeProvider value='page'>
          <AgentModalContent />
        </SettingsViewModeProvider>
      </SWRConfig>
    </MemoryRouter>
  );
}

describe('Codex settings form', () => {
  beforeEach(() => {
    mockMatchMedia();
    configService.reset();
    vi.clearAllMocks();
    useManagedAgents.mockReturnValue({ agents: [codexAgent], refreshCatalog: vi.fn() });
  });
  afterEach(() => {
    configService.reset();
    vi.unstubAllGlobals();
  });

  it('shows the default model and low reasoning', () => {
    renderSettings();
    expect(screen.getByRole('textbox', { name: 'codex.settings.model' })).toHaveValue('gpt-6-astra');
    expect(screen.getByText('codex.settings.efforts.low')).toBeInTheDocument();
  });

  it('rejects an empty model without saving it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();
    fireEvent.change(screen.getByRole('textbox', { name: 'codex.settings.model' }), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save', exact: true }));
    await waitFor(() => expect(screen.getByText('codex.settings.invalidModel')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the selected model to the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();
    fireEvent.change(screen.getByRole('textbox', { name: 'codex.settings.model' }), {
      target: { value: 'gpt-6-astra-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save', exact: true }));
    await waitFor(() => expect(messageSuccess).toHaveBeenCalledWith('common.saveSuccess'));
    expect(readCodexSettings().model).toBe('gpt-6-astra-test');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      'codex.settings': { model: 'gpt-6-astra-test', reasoningEffort: 'low' },
    });
  });

  it('reports failed saves and keeps the previously saved model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
    renderSettings();
    fireEvent.change(screen.getByRole('textbox', { name: 'codex.settings.model' }), {
      target: { value: 'gpt-6-astra-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save', exact: true }));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('common.saveFailed'));
    expect(readCodexSettings().model).toBe('gpt-6-astra');
  });
});

describe('WebUI Codex account and SOCKS5 controls', () => {
  const disconnected = { authenticated: false, login: { state: 'idle' as const } };
  const proxyStatus = {
    enabled: true,
    endpoint: 'socks5://192.0.2.1:1080',
    hasCredentials: true,
    active: false,
    pendingRestart: true,
    managedByEnvironment: false,
    containerSupported: true,
  };
  beforeEach(() => {
    runtimeEnvironment.isDesktop = false;
    mockMatchMedia();
    vi.clearAllMocks();
    useManagedAgents.mockReturnValue({ agents: [codexAgent], refreshCatalog: vi.fn() });
    vi.mocked(ipcBridge.webRuntime.codexAccount.invoke).mockResolvedValue(disconnected);
    vi.mocked(ipcBridge.webRuntime.networkProxy.invoke).mockResolvedValue(proxyStatus);
  });
  afterEach(() => {
    runtimeEnvironment.isDesktop = true;
    vi.unstubAllGlobals();
  });

  it('shows the official device-code link and code after starting login', async () => {
    vi.mocked(ipcBridge.webRuntime.codexLogin.invoke).mockResolvedValue({
      authenticated: false,
      login: { state: 'pending', userCode: 'TEST-CODE', verificationUrl: 'https://auth.openai.com/codex/device' },
    });
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'codex.account.signIn' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'codex.account.signIn' }));
    await waitFor(() => expect(screen.getByText('TEST-CODE')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'codex.account.openLogin' })).toHaveAttribute(
      'href',
      'https://auth.openai.com/codex/device'
    );
  });

  it('reports failed login without showing a device code', async () => {
    vi.mocked(ipcBridge.webRuntime.codexLogin.invoke).mockRejectedValue(new Error('offline'));
    renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'codex.account.signIn' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'codex.account.signIn' }));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('codex.account.actionFailed'));
    expect(screen.queryByRole('link', { name: 'codex.account.openLogin' })).not.toBeInTheDocument();
  });

  it('keeps stored proxy credentials on a save with an empty replacement field', async () => {
    vi.mocked(ipcBridge.webRuntime.saveNetworkProxy.invoke).mockResolvedValue(proxyStatus);
    renderSettings();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'codex.proxy.enable' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'codex.proxy.save' }));
    await waitFor(() => expect(ipcBridge.webRuntime.saveNetworkProxy.invoke).toHaveBeenCalledWith({ enabled: true }));
    expect(screen.getByLabelText('codex.proxy.url')).toHaveValue('');
  });

  it('shows failed proxy saves without claiming the active route changed', async () => {
    vi.mocked(ipcBridge.webRuntime.saveNetworkProxy.invoke).mockRejectedValue(new Error('invalid'));
    renderSettings();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'codex.proxy.enable' })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: 'codex.proxy.save' }));
    await waitFor(() => expect(messageError).toHaveBeenCalledWith('codex.proxy.saveFailed'));
    expect(screen.getByText('codex.proxy.inactive')).toBeInTheDocument();
  });

  it('locks proxy settings managed by the container environment', async () => {
    vi.mocked(ipcBridge.webRuntime.networkProxy.invoke).mockResolvedValue({
      ...proxyStatus,
      managedByEnvironment: true,
    });
    renderSettings();
    await waitFor(() => expect(screen.getByText('codex.proxy.environmentManaged')).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: 'codex.proxy.enable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'codex.proxy.save' })).toBeDisabled();
  });
});
