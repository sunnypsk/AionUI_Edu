/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { buildAutoTitleFromContent, deriveAutoTitleFromMessages } from '@/renderer/utils/chat/autoTitle';
import type { TMessage } from '@/common/chat/chatLib';

vi.mock('@/renderer/utils/chat/thinkTagFilter', () => ({
  hasThinkTags: (content: string) => content.includes('<think>'),
  stripThinkTags: (content: string) => content.replace(/<think>.*?<\/think>/g, ''),
}));

vi.mock('@/renderer/utils/chat/conversationExport', () => ({
  readMessageContent: (message: TMessage) => message.content || '',
}));

describe('autoTitle', () => {
  describe('buildAutoTitleFromContent', () => {
    it('returns first line of content', () => {
      const content = 'First line\nSecond line';
      expect(buildAutoTitleFromContent(content)).toBe('First line');
    });

    it('strips heading markdown', () => {
      expect(buildAutoTitleFromContent('## Heading')).toBe('Heading');
      expect(buildAutoTitleFromContent('# Title')).toBe('Title');
      expect(buildAutoTitleFromContent('### Another')).toBe('Another');
    });

    it('strips list markers', () => {
      expect(buildAutoTitleFromContent('* List item')).toBe('List item');
      expect(buildAutoTitleFromContent('- Dash item')).toBe('Dash item');
      expect(buildAutoTitleFromContent('1. Numbered item')).toBe('Numbered item');
    });

    it('strips blockquote markers', () => {
      expect(buildAutoTitleFromContent('> Quote')).toBe('Quote');
    });

    it('truncates to 50 characters', () => {
      const longText = 'a'.repeat(100);
      const result = buildAutoTitleFromContent(longText);
      expect(result).toHaveLength(50);
    });

    it('normalizes multiple spaces', () => {
      expect(buildAutoTitleFromContent('Text   with    spaces')).toBe('Text with spaces');
    });

    it('removes empty lines and code fence markers', () => {
      const content = '```\n\nFirst line\nSecond line';
      expect(buildAutoTitleFromContent(content)).toBe('First line');
    });

    it('handles CRLF line endings', () => {
      const content = 'First line\r\nSecond line';
      expect(buildAutoTitleFromContent(content)).toBe('First line');
    });

    it('strips think tags before processing', () => {
      const content = '<think>thinking</think>Main content';
      expect(buildAutoTitleFromContent(content)).toBe('Main content');
    });

    it('returns null for empty content', () => {
      expect(buildAutoTitleFromContent('')).toBeNull();
      expect(buildAutoTitleFromContent('   ')).toBeNull();
    });

    it('returns null for content with only markers', () => {
      expect(buildAutoTitleFromContent('```\n\n')).toBeNull();
      expect(buildAutoTitleFromContent('##')).toBeNull();
    });

    it('handles mixed whitespace', () => {
      expect(buildAutoTitleFromContent('  \n  First line  ')).toBe('First line');
    });

    it('handles content with only newlines', () => {
      expect(buildAutoTitleFromContent('\n\n\n')).toBeNull();
    });
  });

  describe('deriveAutoTitleFromMessages', () => {
    const mockUserMessage = (content: string): TMessage =>
      ({
        id: 'msg-1',
        type: 'text',
        position: 'right',
        content,
      }) as TMessage;

    const mockAssistantMessage = (content: string): TMessage =>
      ({
        id: 'msg-2',
        type: 'text',
        position: 'left',
        content,
      }) as TMessage;

    it('returns title from first user message', () => {
      const messages = [mockUserMessage('User question')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('User question');
    });

    it('skips assistant messages', () => {
      const messages = [mockAssistantMessage('Assistant response'), mockUserMessage('User question')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('User question');
    });

    it('returns fallback content when no user messages', () => {
      const messages = [mockAssistantMessage('Assistant response')];
      expect(deriveAutoTitleFromMessages(messages, 'Fallback title')).toBe('Fallback title');
    });

    it('returns null when no user messages and no fallback', () => {
      const messages = [mockAssistantMessage('Assistant response')];
      expect(deriveAutoTitleFromMessages(messages)).toBeNull();
    });

    it('skips empty user messages', () => {
      const messages = [mockUserMessage(''), mockUserMessage('Second message')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('Second message');
    });

    it('handles empty message list with fallback', () => {
      expect(deriveAutoTitleFromMessages([], 'Fallback')).toBe('Fallback');
    });

    it('handles empty message list without fallback', () => {
      expect(deriveAutoTitleFromMessages([])).toBeNull();
    });

    it('titles an attachment-only message by the file name, not the path or marker', () => {
      const messages = [mockUserMessage('[[AION_FILES]]\n/Users/t/Documents/學生成績表.xlsx')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('學生成績表.xlsx');
    });

    it('handles Windows paths and a leading blank line for attachment-only messages', () => {
      const messages = [mockUserMessage('\n[[AION_FILES]]\nC:\\docs\\notes.docx')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('notes.docx');
    });

    it('prefers the text over the attachment name', () => {
      const messages = [mockUserMessage('請幫我整理成績\n[[AION_FILES]]\n/tmp/a/成績.xlsx')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('請幫我整理成績');
    });

    it('keeps a plain greeting as the title', () => {
      expect(deriveAutoTitleFromMessages([mockUserMessage('你好')])).toBe('你好');
    });

    it('processes markdown in user messages', () => {
      const messages = [mockUserMessage('## Title')];
      expect(deriveAutoTitleFromMessages(messages)).toBe('Title');
    });
  });
});
