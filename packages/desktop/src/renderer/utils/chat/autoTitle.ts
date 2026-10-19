import type { TMessage } from '@/common/chat/chatLib';
import { readMessageContent } from '@/renderer/utils/chat/conversationExport';
import { parseFileMarker } from '@/renderer/pages/conversation/Messages/components/fileMarker';
import { hasThinkTags, stripThinkTags } from '@/renderer/utils/chat/thinkTagFilter';

export const buildAutoTitleFromContent = (content: string): string | null => {
  const withoutThinkTags = hasThinkTags(content) ? stripThinkTags(content) : content;
  const lines = withoutThinkTags
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line !== '```');

  const firstLine = lines[0] ?? '';
  const normalized = firstLine
    .replace(/^[#>*\-\d.\s]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);

  return normalized || null;
};

const fileBaseName = (filePath: string): string => filePath.split(/[\\/]/).filter(Boolean).pop() ?? '';

/** Title from the text of a user message; an attachment-only message falls back to its first file name. */
const buildAutoTitleFromUserContent = (content: string): string | null => {
  const { text, files } = parseFileMarker(content, true);
  const title = buildAutoTitleFromContent(text);
  if (title) {
    return title;
  }
  const firstFileName = files.length > 0 ? fileBaseName(files[0]) : '';
  return firstFileName ? firstFileName.slice(0, 50) : null;
};

/**
 * Pick the very first user prompt from conversation history.
 * Falls back to the current send-box content when history has no user prompt yet.
 */
export const deriveAutoTitleFromMessages = (messages: TMessage[], fallbackContent?: string): string | null => {
  for (const message of messages) {
    if (message.type !== 'text' || message.position !== 'right') {
      continue;
    }

    const title = buildAutoTitleFromUserContent(readMessageContent(message));
    if (title) {
      return title;
    }
  }

  if (fallbackContent) {
    return buildAutoTitleFromUserContent(fallbackContent);
  }

  return null;
};
