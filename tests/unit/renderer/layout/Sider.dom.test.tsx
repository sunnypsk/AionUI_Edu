import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ isMobile: false }));
const router = vi.hoisted(() => ({ navigate: vi.fn(), pathname: '/guid' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: router.pathname, search: '', hash: '' }),
  useNavigate: () => router.navigate,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => layout }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), status: 'unauthenticated' }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: vi.fn(), clearPreviewForScope: vi.fn() }),
}));
vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({}),
}));
vi.mock('@/renderer/components/layout/Sider/SiderNav', () => ({
  SiderToolbar: () => <div>New chat</div>,
  SiderSearchEntry: () => <div>Search</div>,
  SiderAssistantEntry: () => <div>Assistants</div>,
  SiderScheduledEntry: () => <div>Scheduled tasks</div>,
  SiderStudioEntry: ({ isActive, onClick }: { isActive: boolean; onClick: () => void }) => (
    <div role='link' aria-current={isActive ? 'page' : undefined} onClick={onClick}>
      Audio Studio
    </div>
  ),
}));
vi.mock('@/renderer/components/layout/Sider/TeamSiderSection', () => ({
  default: () => <div>Teams</div>,
}));
vi.mock('@/renderer/components/layout/Sider/SiderFooter', () => ({ default: () => <div>Settings</div> }));
vi.mock('@/renderer/pages/conversation/GroupedHistory', () => ({
  default: ({ afterPinnedContent }: { afterPinnedContent?: React.ReactNode }) => (
    <div>
      {afterPinnedContent}
      Conversation history
    </div>
  ),
}));

import Sider from '@/renderer/components/layout/Sider';

describe('Sider navigation', () => {
  beforeEach(() => {
    layout.isMobile = false;
    router.pathname = '/guid';
    router.navigate.mockReset();
  });

  it('links to the audio studio and marks it active on studio pages', async () => {
    render(<Sider />);
    const entry = await screen.findByRole('link', { name: 'Audio Studio' });
    expect(entry).not.toHaveAttribute('aria-current');
    fireEvent.click(entry);
    expect(router.navigate).toHaveBeenCalledWith('/audio');
    cleanup();
    router.pathname = '/audio/p1';
    render(<Sider />);
    expect(await screen.findByRole('link', { name: 'Audio Studio' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([false, true])('omits assistants, scheduled tasks, and teams with collapsed=%s', async (collapsed) => {
    render(<Sider collapsed={collapsed} />);

    await screen.findByText('Conversation history');

    expect(screen.queryByText('Assistants')).not.toBeInTheDocument();
    expect(screen.queryByText('Scheduled tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Teams')).not.toBeInTheDocument();
  });

  it('keeps mobile search, new chat, and conversation history accessible', async () => {
    layout.isMobile = true;
    render(<Sider />);

    expect(await screen.findByText('Conversation history')).toBeInTheDocument();
    expect(screen.getByText('New chat')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });
});
