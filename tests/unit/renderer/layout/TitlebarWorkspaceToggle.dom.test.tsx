import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/conversation/test', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/common', () => ({
  ipcBridge: { conversation: { get: { invoke: vi.fn() } } },
}));
vi.mock('@/common/config/constants', () => ({ TEAM_MODE_ENABLED: false }));
vi.mock('@renderer/pages/conversation/GroupedHistory/ConversationSearchPopover', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar/MobileConversationBrand', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));
vi.mock('@/renderer/hooks/context/NavigationHistoryContext', () => ({
  useNavigationHistory: () => null,
}));

import Titlebar from '@/renderer/components/layout/Titlebar';
import { WORKSPACE_STATE_EVENT } from '@/renderer/utils/workspace/workspaceEvents';

describe('Titlebar workspace toggle', () => {
  it('renders the workspace toggle as the last toolbar action without report or window controls', () => {
    render(<Titlebar workspaceAvailable />);

    const workspace = screen.getByRole('button', { name: 'common.expandMore' });

    expect(workspace.nextElementSibling).toBeNull();
    expect(screen.queryByRole('button', { name: 'conversation.welcome.quickActionFeedback' })).not.toBeInTheDocument();
  });

  it('updates the workspace action when the panel becomes expanded', () => {
    render(<Titlebar workspaceAvailable />);

    act(() => {
      window.dispatchEvent(new CustomEvent(WORKSPACE_STATE_EVENT, { detail: { collapsed: false } }));
    });

    expect(screen.getByRole('button', { name: 'common.collapse' })).toBeInTheDocument();
  });

  it('omits the workspace toggle when no workspace is available', () => {
    render(<Titlebar workspaceAvailable={false} />);

    expect(screen.queryByRole('button', { name: 'common.expandMore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.collapse' })).not.toBeInTheDocument();
  });
});
