/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolCall } from '@/common/chat/chatLib';
import type { NormalizedToolCall } from '@/common/chat/normalizeToolCall';
import MessageToolGroupSummary, {
  describeStep,
} from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import MessageToolCall from '@/renderer/pages/conversation/Messages/components/MessageToolCall';

const mockDownloadFileFromRef = vi.fn().mockResolvedValue(undefined);
const mockDownloadFileFromPath = vi.fn().mockResolvedValue(undefined);
const mockMessageSuccess = vi.fn();
const mockMessageError = vi.fn();

vi.mock('@/renderer/components/media/LocalImageView', () => ({
  __esModule: true,
  default: ({ src, alt, className }: { src: string; alt: string; className?: string }) => (
    <img src={src} alt={alt} className={className} data-testid='local-image' />
  ),
}));

vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromRef: (...args: unknown[]) => mockDownloadFileFromRef(...args),
  downloadFileFromPath: (...args: unknown[]) => mockDownloadFileFromPath(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');

  return {
    ...actual,
    Message: {
      useMessage: () => [{ success: mockMessageSuccess, error: mockMessageError }, null],
    },
  };
});

describe('MessageToolGroupSummary ACP image output', () => {
  beforeEach(() => {
    mockDownloadFileFromRef.mockReset();
    mockDownloadFileFromRef.mockResolvedValue(undefined);
    mockDownloadFileFromPath.mockReset();
    mockDownloadFileFromPath.mockResolvedValue(undefined);
    mockMessageSuccess.mockClear();
    mockMessageError.mockClear();
  });

  it('renders generated image preview when an ACP image tool call is expanded', () => {
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
          content: [
            {
              type: 'content',
              content: {
                type: 'text',
                text: 'Revised prompt: 一张小猫照片',
              },
            },
          ],
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));

    const image = screen.getByTestId('local-image');
    expect(image).toHaveAttribute('src', '/Users/test/.codex/generated_images/session/ig_test_image.png');
    expect(image).toHaveAttribute('alt', 'ig_test_image.png');
  });

  it('downloads the generated image from its local path', () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: imagePath,
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));

    expect(mockDownloadFileFromPath).toHaveBeenCalledWith(imagePath, 'ig_test_image.png');
  });

  it('shows an error when generated image download fails', async () => {
    const imagePath = '/Users/test/.codex/generated_images/session/ig_test_image.png';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDownloadFileFromPath.mockRejectedValueOnce(new Error('denied'));
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: imagePath,
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));

    await waitFor(() => {
      expect(mockMessageError).toHaveBeenCalledWith('acp.image.download_error');
    });
    expect(consoleError).toHaveBeenCalledWith('[MessageToolGroupSummary] Failed to download image:', expect.any(Error));
    expect(mockMessageSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('uses i18n keys for the image download control', () => {
    const message: IMessageAcpToolCall = {
      id: 'ig_test_image',
      conversation_id: 'conv-1',
      type: 'acp_tool_call',
      content: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'tool_call_update',
          tool_call_id: 'ig_test_image',
          status: 'completed',
          title: 'Image generation',
          kind: 'execute',
          raw_output: {
            image: {
              path: '/Users/test/.codex/generated_images/session/ig_test_image.png',
            },
          },
        },
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));

    expect(screen.getByLabelText('acp.image.download_aria')).toBeInTheDocument();
  });

  it('does not render image controls for tool calls without image output', () => {
    const message: IMessageToolCall = {
      id: 'tool-1',
      conversation_id: 'conv-1',
      type: 'tool_call',
      content: {
        call_id: 'tool-1',
        name: 'Shell Command',
        args: {},
        status: 'completed',
      },
    };

    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));

    expect(screen.queryByTestId('local-image')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('acp.image.download_aria')).not.toBeInTheDocument();
  });
});

describe('native Codex image output', () => {
  const imageMessage = (status: IMessageToolCall['content']['status'] = 'completed'): IMessageToolCall => ({
    id: 'native-image',
    conversation_id: 'conv-1',
    type: 'tool_call',
    content: {
      call_id: 'native-image',
      name: 'imageGen',
      args: {},
      status,
      images: [{ path: '/owned/original.png', mime_type: 'image/png' }],
    },
  });

  it('shows the image immediately with collapsed steps and no assistant final', () => {
    const message = imageMessage();
    const { rerender } = render(<MessageToolGroupSummary messages={[message]} />);
    expect(screen.getByRole('img', { name: 'original.png' })).toHaveAttribute(
      'src',
      expect.stringContaining('/api/fs/stream?kind=local&path=')
    );
    expect(screen.getByText('messages.toolSummary.viewSteps')).toBeInTheDocument();
    expect(screen.getAllByTestId('tool-image-gallery')).toHaveLength(1);
    // Replayed metadata and a history reload must still render one preview.
    rerender(<MessageToolGroupSummary messages={[message, structuredClone(message)]} />);
    expect(screen.getAllByRole('img', { name: 'original.png' })).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));
    expect(mockDownloadFileFromRef).toHaveBeenCalledWith(
      { kind: 'local', path: '/owned/original.png' },
      'original.png'
    );
  });

  it.each(['running', 'error', 'canceled'] as const)('hides partial images when %s', (status) => {
    render(<MessageToolGroupSummary messages={[imageMessage(status)]} />);
    expect(screen.queryByTestId('tool-image-gallery')).not.toBeInTheDocument();
  });

  it('keeps native generation results visible after expanding their tool steps without duplicating images', () => {
    const message = imageMessage();
    message.content.name = 'imageGeneration';
    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    expect(screen.getAllByRole('img', { name: 'original.png' })).toHaveLength(1);
  });

  it('reveals browser screenshots only when their individual tool details are expanded', () => {
    const message = imageMessage();
    message.content.name = 'mcpToolCall';
    message.content.input = { type: 'mcpToolCall', server: 'aionui_browser', tool: 'browser' };
    render(<MessageToolGroupSummary messages={[message]} />);
    expect(screen.queryByRole('img', { name: 'original.png' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    expect(screen.queryByRole('img', { name: 'original.png' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('messages.toolSummary.names.browser'));
    expect(screen.getByRole('img', { name: 'original.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    expect(screen.queryByRole('img', { name: 'original.png' })).not.toBeInTheDocument();
  });

  it('keeps screenshots hidden while another tool in the group is running', () => {
    const screenshot = imageMessage();
    screenshot.content.name = 'mcpToolCall';
    const running = imageMessage('running');
    running.content.call_id = 'running-tool';
    render(<MessageToolGroupSummary messages={[screenshot, running]} />);
    expect(screen.getByRole('button', { name: 'messages.toolSummary.viewSteps' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.queryByRole('img', { name: 'original.png' })).not.toBeInTheDocument();
  });

  it('does not hide generated results when the same group also contains screenshot observations', () => {
    const screenshot = imageMessage();
    screenshot.content.call_id = 'screenshot';
    screenshot.content.name = 'imageView';
    screenshot.content.images = [{ path: '/owned/screenshot.png', mime_type: 'image/png' }];
    render(<MessageToolGroupSummary messages={[screenshot, imageMessage()]} />);
    expect(screen.queryByRole('img', { name: 'screenshot.png' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'original.png' })).toBeInTheDocument();
  });

  it('preserves preview and download for an image-only observation without text output', () => {
    const message = imageMessage();
    message.content.name = 'imageView';
    render(<MessageToolGroupSummary messages={[message]} />);
    fireEvent.click(screen.getByText('messages.toolSummary.viewSteps'));
    fireEvent.click(screen.getByText('messages.toolSummary.names.viewImage'));
    fireEvent.click(screen.getByLabelText('acp.image.download_aria'));
    expect(mockDownloadFileFromRef).toHaveBeenCalledWith(
      { kind: 'local', path: '/owned/original.png' },
      'original.png'
    );
  });

  it('also collapses read-image results when rendered as a standalone tool', () => {
    const message = imageMessage();
    message.content.name = 'imageView';
    render(<MessageToolCall message={message} />);
    expect(screen.queryByRole('img', { name: 'original.png' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('imageView'));
    expect(screen.getByRole('img', { name: 'original.png' })).toBeInTheDocument();
  });
});

const step = (item: Partial<NormalizedToolCall>): NormalizedToolCall => ({
  key: 'k',
  name: 'tool',
  status: 'completed',
  ...item,
});

describe('describeStep', () => {
  it.each([
    ['cat /data/skills/teaching-design/SKILL.md', 'inspectFiles'],
    ['pdftotext paper.pdf -', 'inspectFiles'],
    ['cd /work && python3 build_quiz.py', 'runScript'],
    ['officecli help docx paragraph | rg -A 4 pageBreak', 'editDocument'],
    ['LANG=C make docs', 'shell'],
  ])('labels the command %j by what it does', (command, label) => {
    expect(describeStep(step({ command }))).toEqual({ labelKey: `messages.toolSummary.names.${label}` });
  });

  it('names MCP tools without exposing the raw call type', () => {
    expect(describeStep(step({ name: 'mcpToolCall', mcp: { server: 'docs', tool: 'read_text' } }))).toEqual({
      labelKey: 'messages.toolSummary.names.useTool',
      detail: 'read_text',
    });
    expect(describeStep(step({ name: 'mcpToolCall', mcp: { server: 'aionui_browser' } }))).toEqual({
      labelKey: 'messages.toolSummary.names.browser',
    });
  });

  it('keeps known tool names with their description and falls back to the raw name', () => {
    expect(describeStep(step({ name: 'webSearch', description: 'hk weather' }))).toEqual({
      labelKey: 'messages.toolSummary.names.webSearch',
      detail: 'hk weather',
    });
    expect(describeStep(step({ name: 'custom', description: 'custom' }))).toEqual({ label: 'custom' });
  });
});
