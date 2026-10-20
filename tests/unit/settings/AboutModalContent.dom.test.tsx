/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrlMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: mocks.openExternalUrlMock,
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

describe('AboutModalContent', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '2.1.13');
    mocks.openExternalUrlMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the app version without desktop update or bug report actions', () => {
    render(<AboutModalContent />);

    expect(screen.getByText('v2.1.13')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.checkForUpdates' })).not.toBeInTheDocument();
    expect(screen.queryByText('settings.includePrereleaseUpdates')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.bugReport')).not.toBeInTheDocument();
  });

  it('opens the help documentation link externally', () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByText('settings.helpDocumentation'));

    expect(mocks.openExternalUrlMock).toHaveBeenCalledWith('https://github.com/iOfficeAI/AionUi/wiki');
  });
});
