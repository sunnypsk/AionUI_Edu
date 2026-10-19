/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';

afterEach(() => cleanup());

describe('SiderFooter', () => {
  it('keeps the back label untruncated and lets the logout label shrink', () => {
    render(
      <SiderFooter
        isMobile={false}
        isSettings
        theme='light'
        siderTooltipProps={{}}
        onSettingsClick={vi.fn()}
        onThemeToggle={vi.fn()}
        showLogout
        onLogoutClick={vi.fn()}
      />
    );
    const back = screen.getByText('common.back');
    expect(back.className).not.toContain('truncate');
    expect(back.parentElement?.className).toContain('shrink-0');
    const logout = screen.getByText('settings.googleLogout');
    expect(logout.parentElement?.className).toContain('min-w-0');
  });
});
