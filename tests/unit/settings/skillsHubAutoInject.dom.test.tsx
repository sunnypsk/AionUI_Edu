import React from 'react';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * The auto-injected skills section explains how to turn those skills off.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  getSkillPaths: vi.fn(),
  getSkillImportLimits: vi.fn(),
  listSkillImportHistory: vi.fn(),
  importSkills: vi.fn(),
  deleteSkill: vi.fn(),
  showOpen: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  modalConfirm: vi.fn(),
}));

const searchParamsMock = vi.hoisted(() => ({
  current: new URLSearchParams(),
  setSearchParams: vi.fn(),
  pathname: '/settings/capabilities',
  state: undefined as unknown,
  navigate: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: mocks.listAvailableSkills },
      getSkillPaths: { invoke: mocks.getSkillPaths },
      getSkillImportLimits: { invoke: mocks.getSkillImportLimits },
      listSkillImportHistory: { invoke: mocks.listSkillImportHistory },
      importSkills: { invoke: mocks.importSkills },
      deleteSkill: { invoke: mocks.deleteSkill },
    },
    dialog: {
      showOpen: { invoke: mocks.showOpen },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: mocks.messageError,
      success: mocks.messageSuccess,
      warning: mocks.messageWarning,
    },
    Modal: {
      ...actual.Modal,
      confirm: mocks.modalConfirm,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: searchParamsMock.pathname, state: searchParamsMock.state }),
  useNavigate: () => searchParamsMock.navigate,
  useSearchParams: () => [searchParamsMock.current, searchParamsMock.setSearchParams],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

import SkillsHubSettings from '@/renderer/pages/settings/SkillsSettings/SkillsHubSettings';

describe('SkillsHubSettings auto-injected section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsMock.current = new URLSearchParams();
    searchParamsMock.state = { skillsTab: 'official' };
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'humanizer-zh',
        description: 'Auto injected skill.',
        location: '/tmp/builtin-skills/auto-inject/humanizer-zh/SKILL.md',
        is_auto_inject: true,
        is_custom: false,
        source: 'builtin',
      },
    ]);
    mocks.getSkillPaths.mockResolvedValue({ user_skills_dir: '/tmp/u', builtin_skills_dir: '/tmp/b' });
    mocks.getSkillImportLimits.mockResolvedValue({ max_file_bytes: 1, max_total_bytes: 1 });
    mocks.listSkillImportHistory.mockResolvedValue([]);
  });

  it('shows visible text explaining how to turn auto-applied skills off', async () => {
    render(<SkillsHubSettings withWrapper={false} />);
    const section = await screen.findByTestId('auto-skills-section');
    expect(within(section).getByText('settings.autoInjectedSkillsOptOutHint')).toBeInTheDocument();
  });
});
