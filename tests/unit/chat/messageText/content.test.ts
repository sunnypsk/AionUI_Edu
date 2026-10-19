import { describe, expect, it } from 'vitest';
import { buildMessage } from '@openuidev/react-lang';
import { splitOpenUiContent } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/content';
const NL = String.fromCharCode(10);
const fence = '```';
describe('OpenUI message segmentation', () => {
  it('preserves text around multiple library profiles', () => {
    const input = [
      'Before',
      fence + 'openui',
      'root = Stack([])',
      fence,
      'Middle',
      fence + 'openui-chat',
      'root = Card([])',
      fence,
      'After',
    ].join(NL);
    const result = splitOpenUiContent(input);
    expect(result.map((segment) => segment.kind)).toEqual(['markdown', 'openui', 'markdown', 'openui', 'markdown']);
    expect(result[1]).toMatchObject({ profile: 'openui', id: '0', closed: true });
    expect(result[3]).toMatchObject({ profile: 'openui-chat', id: '1' });
  });
  it('does not execute examples nested in an ordinary Markdown fence', () => {
    const input = ['````markdown', '```openui', 'root = Stack([])', '```', '````'].join(NL);
    expect(splitOpenUiContent(input)).toEqual([{ kind: 'markdown', content: input }]);
  });
  it('keeps an unfinished streaming program separate from text', () => {
    expect(splitOpenUiContent(['Before', '~~~openui', 'root = Stack(['].join(NL), true).at(-1)).toMatchObject({
      kind: 'openui',
      closed: false,
      content: 'root = Stack([',
    });
  });
  it('reads official persisted envelopes without rendering private form context', () => {
    const stored = buildMessage({
      content: 'root = Card([])',
      attributes: { library: 'openui-chat' },
      context: { secret: 'private' },
      end: true,
    });
    const result = splitOpenUiContent(stored);
    expect(result).toEqual([
      { kind: 'openui', profile: 'openui-chat', content: 'root = Card([])', id: '0', closed: true },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('accepts an official raw program with state and helper declarations before root', () => {
    const program = '# Lesson\n$topic = "Poetry"\nheading = TextContent($topic)\nroot = Stack([heading])';
    expect(splitOpenUiContent(program)).toEqual([
      { kind: 'openui', profile: 'openui', id: '0', content: program, closed: true },
    ]);
  });
  it('leaves ordinary code and prose unchanged', () => {
    const input = ['Example: root = Stack([])', '```typescript', 'const x = 1;', '```'].join(NL);
    expect(splitOpenUiContent(input)).toEqual([{ kind: 'markdown', content: input }]);
  });
});
