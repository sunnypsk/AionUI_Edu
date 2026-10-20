/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IMessageTips } from '@/common/chat/chatLib';
import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isElectronDesktop = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock('@renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@renderer/components/base/ButlerDiagnoseButton', () => ({ default: () => null }));

vi.mock('@renderer/components/chat/CollapsibleContent', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MessageTips from '@/renderer/pages/conversation/Messages/components/MessageTips';

const tip = (code: string): IMessageTips =>
  ({
    id: code,
    type: 'tips',
    position: 'center',
    conversation_id: 'c',
    content: { content: `body for ${code}`, type: 'info', code },
  }) as unknown as IMessageTips;

describe('MessageTips CLI version notices', () => {
  beforeEach(() => isElectronDesktop.mockReset());

  it('hides the newer-than-verified notice in the web runtime', () => {
    isElectronDesktop.mockReturnValue(false);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_NEWER')} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps the newer-than-verified notice on desktop', () => {
    isElectronDesktop.mockReturnValue(true);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_NEWER')} />);
    expect(container.textContent).toContain('body for CLI_VERSION_NEWER');
  });

  it('keeps the older-than-verified notice in the web runtime', () => {
    isElectronDesktop.mockReturnValue(false);
    const { container } = render(<MessageTips message={tip('CLI_VERSION_OLDER')} />);
    expect(container.textContent).toContain('body for CLI_VERSION_OLDER');
  });
});
