/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownView from '@/renderer/components/Markdown';

const copyTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/renderer/components/Markdown/ShadowView', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/components/Markdown/CodeBlock', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <code>{children}</code>,
}));

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

vi.mock('@/renderer/utils/chat/latexDelimiters', () => ({
  convertLatexDelimiters: (text: string) => text,
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/utils/ui/clipboard', () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button type='button' {...props}>
      {icon}
      {children}
    </button>
  ),
  Message: {
    error: vi.fn(),
  },
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@icon-park/react', () => ({
  Copy: () => <span data-testid='copy-icon' />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const renderMarkdown = (content: string) => render(<MarkdownView>{content}</MarkdownView>);

describe('MarkdownView CJK emphasis', () => {
  it('renders bold closed by full-width punctuation inside a list item', () => {
    const { container } = renderMarkdown('- **風勢：**東風2至3級');
    expect(container.querySelector('strong')?.textContent).toBe('風勢：');
    expect(container.textContent).not.toContain('**');
  });

  it('renders bold closed by full-width colon before digits', () => {
    const { container } = renderMarkdown('**相對濕度：**60–85%');
    expect(container.querySelector('strong')?.textContent).toBe('相對濕度：');
    expect(container.textContent).not.toContain('**');
  });

  it('keeps inline code literal', () => {
    const { container } = renderMarkdown('`**不是粗體：**`');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('**不是粗體：**');
  });

  it('keeps English bold unchanged', () => {
    const { container } = renderMarkdown('**English bold** text');
    expect(container.querySelector('strong')?.textContent).toBe('English bold');
  });
});
