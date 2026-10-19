import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createParser } from '@openuidev/react-lang';
import { openuiLibrary, openuiChatLibrary } from '@openuidev/react-ui';
const manifest = JSON.parse(readFileSync('packages/web-host/openui/manifest.json', 'utf8'));
describe('pinned official OpenUI runtime contracts', () => {
  it.each([
    ['openui', openuiLibrary],
    ['openui-chat', openuiChatLibrary],
  ] as const)('ships every %s registry entry without a local allowlist', (id, library) => {
    expect(Object.keys(library.components).toSorted()).toEqual(manifest.libraries[id].components);
    expect(library.toJSONSchema()).toEqual(manifest.libraries[id].schema);
    expect(manifest.libraries[id].prompt).toContain('## Query');
    expect(manifest.libraries[id].prompt).toContain('## Mutation');
    expect(manifest.libraries[id].prompt).toContain('@Run');
  });
  it('binds the schema and generated prompts to the compatibility hash', () => {
    const { hash, ...data } = manifest;
    expect(createHash('sha256').update(JSON.stringify(data)).digest('hex')).toBe(hash);
  });
  it.each([
    ['openui', openuiLibrary, 'Stack'],
    ['openui-chat', openuiChatLibrary, 'Card'],
  ] as const)('parses an interactive form for %s', (_id, library, root) => {
    const program =
      'root = ' +
      root +
      '([form])\nform = Form("lesson", Buttons([Button("Continue", @ToAssistant("Continue"))]), [FormControl("Topic", Input("topic", "Enter topic", "text", {required: true}, $topic))])\n$topic = "Poetry"';
    const result = createParser(library.toJSONSchema(), library.root).parse(program);
    expect(result.meta.errors).toEqual([]);
    expect(result.root?.props.children).toBeDefined();
  });
});
