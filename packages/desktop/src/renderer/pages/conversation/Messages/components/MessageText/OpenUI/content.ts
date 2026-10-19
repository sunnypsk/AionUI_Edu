import { parseMessage } from '@openuidev/react-lang';
import type { MessageSegment, OpenUiBlock, OpenUiProfile } from './types';

/** Identify generated interfaces without interpreting ordinary Markdown code. */
export function hasOpenUiContent(text: string): boolean {
  return /^(?: {0,3}(?:`{3,}|~{3,})openui(?:-chat)?(?:\s|$)|\s*root\s*=|\]\]>openui:content)/m.test(text);
}

/** Preserve Markdown and fence boundaries, including unfinished streaming programs. */
export function splitOpenUiContent(input: string, streaming = false): MessageSegment[] {
  const parsed = parseMessage(input, { streaming });
  const text = parsed.content;
  const firstLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^(?:#|\/\/)/.test(line)) ?? '';
  const rawProgram = /^\$?[A-Za-z_]\w*\s*=/.test(firstLine) && /^\s*root\s*=/m.test(text);
  if (rawProgram) {
    const profile: OpenUiProfile = parsed.attributes.library === 'openui-chat' ? 'openui-chat' : 'openui';
    return [{ kind: 'openui', id: '0', profile, content: text, closed: !streaming }];
  }
  const segments: MessageSegment[] = [];
  let markdown = '';
  let fence: { character: string; length: number; block: OpenUiBlock | null } | null = null;
  let blockIndex = 0;
  const flushMarkdown = () => {
    if (markdown) segments.push({ kind: 'markdown', content: markdown });
    markdown = '';
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?\n?$/.exec(line);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) {
        if (fence.block) {
          fence.block.closed = true;
          segments.push(fence.block);
        } else markdown += line;
        fence = null;
      } else if (fence.block) fence.block.content += line;
      else markdown += line;
      continue;
    }
    const start = /^ {0,3}(`{3,}|~{3,})([^\n]*)/.exec(line);
    if (!start) {
      markdown += line;
      continue;
    }
    const language = start[2].trim();
    const profile = language === 'openui' || language === 'openui-chat' ? language : null;
    if (profile) flushMarkdown();
    else markdown += line;
    fence = {
      character: start[1][0],
      length: start[1].length,
      block: profile ? { kind: 'openui', id: String(blockIndex++), profile, content: '', closed: false } : null,
    };
  }
  if (fence?.block) segments.push(fence.block);
  flushMarkdown();
  return segments;
}
