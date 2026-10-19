/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => vi.fn());

vi.mock('@/common', () => ({
  ipcBridge: {
    webRuntime: {
      codexVersion: { invoke: status },
      codexCheckUpdate: { invoke: vi.fn() },
      codexInstallUpdate: { invoke: vi.fn() },
      codexVersions: {
        invoke: vi.fn().mockResolvedValue({ versions: [], supported: false, inspectionComplete: true, busy: false }),
      },
      codexCleanupVersions: { invoke: vi.fn() },
    },
  },
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
  const { useEffect, useState } = await import('react');
  return {
    default: (key: string, fetcher: () => Promise<unknown>) => {
      const [data, setData] = useState<unknown>();
      useEffect(() => {
        void fetcher().then(setData);
      }, []);
      return { data, error: undefined, isLoading: !data, isValidating: false, mutate: vi.fn() };
    },
  };
});

import CodexUpdatePanel from '@/renderer/components/settings/SettingsModal/contents/AgentModalContent/CodexUpdatePanel';

const base = {
  latestVersion: '0.163.0',
  checkedAt: null,
  updateAvailable: false,
  canInstall: false,
  installation: { phase: 'idle', targetVersion: null },
};

describe('CodexUpdatePanel version drift notice', () => {
  beforeEach(() => status.mockReset());

  it('shows the notice when installed is newer than the verified version', async () => {
    status.mockResolvedValue({ ...base, installedVersion: '0.163.0', verifiedVersion: '0.151.0' });
    render(<CodexUpdatePanel />);
    await waitFor(() => expect(screen.getByText('codex.update.newerThanVerified')).toBeTruthy());
  });

  it('hides the notice when installed equals the verified version', async () => {
    status.mockResolvedValue({ ...base, installedVersion: '0.151.0', verifiedVersion: '0.151.0' });
    render(<CodexUpdatePanel />);
    await waitFor(() => expect(screen.getByText('codex.updates.installed: 0.151.0')).toBeTruthy());
    expect(screen.queryByText('codex.update.newerThanVerified')).toBeNull();
  });

  it('hides the notice when the verified version is unknown', async () => {
    status.mockResolvedValue({ ...base, installedVersion: '0.163.0', verifiedVersion: null });
    render(<CodexUpdatePanel />);
    await waitFor(() => expect(screen.getByText('codex.updates.installed: 0.163.0')).toBeTruthy());
    expect(screen.queryByText('codex.update.newerThanVerified')).toBeNull();
  });
});
