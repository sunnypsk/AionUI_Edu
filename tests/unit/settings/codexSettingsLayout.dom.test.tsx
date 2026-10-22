/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  'edu.factory.account': {
    available: true,
    version: '0.245.1',
    authenticated: true,
    models: { argon: true, opus: true },
    login: { state: 'idle' as string, url: undefined as string | undefined },
  },
  'edu.codex.account': {
    authenticated: true,
    email: 'teacher@example.com',
    login: { state: 'idle' },
  },
  'edu.codex.version': {
    installedVersion: '0.150.0',
    latestVersion: '0.163.0',
    verifiedVersion: '0.150.0',
    checkedAt: null,
    updateAvailable: true,
    canInstall: true,
    installation: { phase: 'idle', targetVersion: null },
  },
  'edu.codex.versions': {
    versions: [{ id: 'v1', version: '0.140.0', removable: true, protection: null }],
    supported: true,
    inspectionComplete: true,
    busy: false,
  },
  'edu.networkProxy': {
    enabled: true,
    active: true,
    endpoint: 'socks5://proxy:1080',
    hasCredentials: false,
    pendingRestart: false,
    managedByEnvironment: false,
    containerSupported: true,
  },
}));

// Arco's responsive observers call matchMedia, which jsdom lacks.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

vi.mock('@/common', () => ({ ipcBridge: { webRuntime: {} } }));
vi.mock('@/common/config/configService', () => ({
  CODEX_REASONING_EFFORTS: ['low', 'medium', 'high'],
  configService: { setConfirmed: vi.fn() },
  isCodexModelId: () => true,
  readCodexSettings: () => ({ model: 'gpt-5', reasoningEffort: 'medium' }),
}));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => false }));
vi.mock('../../../packages/desktop/src/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'page',
}));
vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/pages/settings/AgentSettings/LocalAgents', () => ({
  default: () => <h1>{'settings.agentsTitle'}</h1>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-TW' } }),
}));
// Arco's Descriptions needs layout APIs jsdom lacks; a plain list keeps the values assertable.
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  const Descriptions = ({ data }: { data: Array<{ label: string; value: string }> }) => (
    <ul>
      {data.map((row) => (
        <li key={row.label}>{`${row.label}: ${row.value}`}</li>
      ))}
    </ul>
  );
  return { ...actual, Descriptions };
});
vi.mock('swr', async () => {
  const mutate = vi.fn();
  return {
    default: (key: keyof typeof fixtures) => ({
      data: fixtures[key],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate,
    }),
    mutate,
  };
});

import AgentModalContent from '@/renderer/components/settings/SettingsModal/contents/AgentModalContent';
import FactoryAccountPanel from '@/renderer/components/settings/SettingsModal/contents/AgentModalContent/FactoryAccountPanel';
import { specialistApi } from '@/renderer/services/runtime/specialists';

describe('Codex settings layout', () => {
  it('shows the official Factory pairing link and cancels a pending login', async () => {
    const account = fixtures['edu.factory.account'];
    account.login = { state: 'pending', url: 'https://app.factory.ai/device?code=fixture' };
    const cancel = vi
      .spyOn(specialistApi, 'cancelLogin')
      .mockResolvedValue({ ...account, login: { state: 'cancelled' } });
    try {
      render(<FactoryAccountPanel />);
      expect(screen.getByRole('link', { name: 'codex.specialists.openLogin' }).getAttribute('href')).toBe(
        account.login.url
      );
      fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      expect(screen.queryByText('codex.specialists.signIn')).toBeNull();
    } finally {
      account.login = { state: 'idle', url: undefined };
      cancel.mockRestore();
    }
  });
  it('renders every section as a System-settings style card', async () => {
    const { container } = render(<AgentModalContent />);
    await waitFor(() => expect(screen.getByText('codex.settings.title')).toBeTruthy());
    const sections = Array.from(container.querySelectorAll('section[aria-labelledby]')).filter((el) =>
      [
        'codex-account-title',
        'factory-account-title',
        'codex-updates-title',
        'codex-settings-title',
        'network-proxy-title',
      ].includes(el.getAttribute('aria-labelledby') ?? '')
    );
    expect(sections).toHaveLength(5);
    for (const section of sections) {
      expect(section.className).toContain('bg-2');
      expect(section.className).toContain('rd-16px');
      expect(section.className).not.toContain('border');
    }
  });

  it('uses only primary (one per section) or secondary Arco buttons, none full width', async () => {
    const { container } = render(<AgentModalContent />);
    await waitFor(() => expect(screen.getByText('codex.settings.title')).toBeTruthy());
    const buttons = Array.from(container.querySelectorAll('button.arco-btn'));
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    for (const button of buttons) {
      expect(button.className).not.toContain('arco-btn-long');
      const kinds = ['primary', 'secondary'].filter((kind) => button.classList.contains(`arco-btn-${kind}`));
      expect(kinds, button.textContent ?? '').toHaveLength(1);
    }
    for (const section of container.querySelectorAll('section[aria-labelledby]')) {
      expect(section.querySelectorAll('button.arco-btn-primary').length).toBeLessThanOrEqual(1);
    }
    const primaryLabels = Array.from(container.querySelectorAll('button.arco-btn-primary')).map((b) => b.textContent);
    expect(primaryLabels).toEqual(['codex.updates.install', 'common.save', 'codex.proxy.save']);
  });

  it('right-aligns the Codex CLI save button and shows the translated Agents heading', async () => {
    render(<AgentModalContent />);
    const save = await screen.findByText('common.save');
    expect(save.closest('button')?.parentElement?.className).toContain('justify-end');
    expect(screen.getByText('settings.agentsTitle')).toBeTruthy();
  });
});
