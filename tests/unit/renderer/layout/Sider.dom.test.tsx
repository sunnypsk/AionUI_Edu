import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const layout = vi.hoisted(() => ({ isMobile: false }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/guid', search: '', hash: '' }),
  useNavigate: () => vi.fn(),
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
