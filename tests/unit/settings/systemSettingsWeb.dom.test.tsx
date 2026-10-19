/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';
import { SWRConfig } from 'swr';

const { systemInfoMock, updateSystemInfoMock, restartMock, showOpenMock, messageInfoMock, configServiceMock } =
  vi.hoisted(() => ({
    systemInfoMock: vi.fn(),
    updateSystemInfoMock: vi.fn(),
    restartMock: vi.fn(),
    showOpenMock: vi.fn(),
    messageInfoMock: vi.fn(),
    configServiceMock: {
      get: vi.fn(() => undefined),
      set: vi.fn(() => Promise.resolve()),
      setLocal: vi.fn(),
    },
  }));
const clientBusinessSettingsMocks = vi.hoisted(() => ({
  getClientBusinessSetting: vi.fn(),
  setClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => false,
}));

vi.mock('@/renderer/components/base/AionScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/base/FeedbackButton', () => ({
  default: () => <button type='button'>settings.oneClickFeedback</button>,
}));

vi.mock('@/renderer/components/settings/LanguageSwitcher', () => ({
  default: () => <div>LanguageSwitcher</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/DevSettings', () => ({
  default: () => <div>DevSettings</div>,
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: clientBusinessSettingsMocks.getClientBusinessSetting,
  setClientBusinessSetting: clientBusinessSettingsMocks.setClientBusinessSetting,
  removeClientBusinessSetting: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/common/config/configService', () => ({
  configService: configServiceMock,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      systemInfo: { invoke: systemInfoMock },
      updateSystemInfo: { invoke: updateSystemInfoMock },
      restart: { invoke: restartMock },
      getStartOnBootStatus: { invoke: vi.fn(() => Promise.resolve({ success: false })) },
      getGpuStatus: { invoke: vi.fn(() => Promise.resolve({ success: false })) },
    },
    systemSettings: {
      getCloseToTray: { invoke: vi.fn(() => Promise.resolve(false)) },
      setCloseToTray: { invoke: vi.fn(() => Promise.resolve()) },
    },
    dialog: {
      showOpen: { invoke: showOpenMock },
    },
    shell: {
      openFolderWith: { invoke: vi.fn(() => Promise.resolve()) },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      info: messageInfoMock,
    },
    Modal: {
      ...actual.Modal,
      useModal: () => [
        {
          confirm: ({ onOk }: { onOk?: () => void }) => {
            onOk?.();
          },
        },
        null,
      ],
    },
  };
});

vi.mock('@/common/adapter/httpBridge', () => ({
  httpRequest: vi.fn(() => Promise.resolve({ agentEnabled: false })),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText/integration', () => ({
  OpenUISettings: () => <div>OpenUISettings</div>,
}));

import SystemModalContent from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent';

const renderContent = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConfigProvider>
        <SystemModalContent />
      </ConfigProvider>
    </SWRConfig>
  );

describe('SystemModalContent on WebUI', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    configServiceMock.get.mockImplementation(() => undefined);
    clientBusinessSettingsMocks.getClientBusinessSetting.mockResolvedValue(undefined);
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission: 'default',
      requestPermission: vi.fn(() => Promise.resolve('granted')),
    };
    systemInfoMock.mockResolvedValue({
      cacheDir: '/cache',
      workDir: '/work',
      logDir: '/logs',
      platform: 'linux',
      arch: 'x64',
    });
  });

  it('does not render the desktop-only start-on-boot and close-to-tray rows', async () => {
    renderContent();
    await screen.findByText('/logs');
    expect(screen.queryByText('settings.startOnBoot')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.startOnBootUnsupported')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.closeToTray')).not.toBeInTheDocument();
  });

  it('renders the notification grant as a secondary Arco button without a nested card', async () => {
    renderContent();
    await screen.findByText('/logs');
    const button = await screen.findByRole('button', { name: 'settings.browserNotification.enable' });
    expect(button).toHaveClass('arco-btn-secondary');
    expect(button.closest('[class*="bg-white"], [class*="shadow"]')).toBeNull();
  });

  it('describes clearing browser data with its own copy instead of the in-chat footer', async () => {
    renderContent();
    await screen.findByText('/logs');
    expect(await screen.findByText('preview.browser.clearDataDescription')).toBeInTheDocument();
    expect(screen.queryByText('preview.sharedBrowser.scopeHint')).not.toBeInTheDocument();
  });
});
