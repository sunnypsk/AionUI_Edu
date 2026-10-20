import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createParser } from '@openuidev/react-lang';
import { openuiLibrary, openuiChatLibrary } from '@openuidev/react-ui';
import { SLIDE_LIMITS, withTeacherComponents } from '@/common/openui/components';
import { TEACHER_RULES } from '@/common/openui/guidance';
const none = () => null;
const teacher = (library: typeof openuiLibrary) =>
  withTeacherComponents(library, { SlideOutline: none, FileCard: none });
const manifest = JSON.parse(readFileSync('packages/web-host/openui/manifest.json', 'utf8'));
describe('pinned official OpenUI runtime contracts', () => {
  it.each([
    ['openui', openuiLibrary],
    ['openui-chat', openuiChatLibrary],
  ] as const)('ships every official %s entry plus the teacher components', (id, library) => {
    expect(manifest.libraries[id].components).toEqual(
      [...Object.keys(library.components), 'FileCard', 'SlideOutline'].toSorted()
    );
    expect(teacher(library).toJSONSchema()).toEqual(manifest.libraries[id].schema);
    expect(manifest.libraries[id].prompt).toContain('## Query');
    expect(manifest.libraries[id].prompt).toContain('## Mutation');
    expect(manifest.libraries[id].prompt).toContain('@Run');
  });
  it.each(['openui', 'openui-chat'] as const)('carries the teacher contracts and every rule in the %s prompt', (id) => {
    const prompt: string = manifest.libraries[id].prompt;
    expect(prompt).toContain('SlideOutline(');
    expect(prompt).toContain('FileCard(');
    for (const rule of TEACHER_RULES) expect(prompt).toContain(rule);
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

const parse = (library: typeof openuiLibrary, program: string) =>
  createParser(library.toJSONSchema(), library.root).parse(program);
describe('teacher component contracts', () => {
  it.each([
    ['openui', openuiLibrary],
    ['openui-chat', openuiChatLibrary],
  ] as const)('extends %s without losing official entries', (_id, library) => {
    const extended = teacher(library);
    expect(Object.keys(extended.components).toSorted()).toEqual(
      [...Object.keys(library.components), 'FileCard', 'SlideOutline'].toSorted()
    );
    expect(extended.root).toBe(library.root);
  });
  it.each([
    ['Stack', openuiLibrary],
    ['Card', openuiChatLibrary],
  ] as const)('parses each component directly under the %s root and inside a Card', (root, library) => {
    const extended = teacher(library);
    for (const child of [
      'SlideOutline("outline", [{title: "引入", points: ["朗讀"]}])',
      'FileCard("簡報/背影.pptx", "背影簡報")',
    ]) {
      for (const program of [`root = ${root}([${child}])`, `root = ${root}([Card([${child}])])`]) {
        const result = parse(extended, program);
        expect([program, result.meta.errors]).toEqual([program, []]);
        expect(JSON.stringify(result.root)).toContain(child.slice(0, child.indexOf('(')));
      }
    }
  });
  it('accepts a partially streamed slide with only a title', () => {
    const result = parse(teacher(openuiLibrary), 'root = Stack([SlideOutline("outline", [{title: "引入"}])])');
    expect(result.meta.errors).toEqual([]);
  });
  it('states the slide and point limits in the schema the model receives', () => {
    expect(SLIDE_LIMITS).toEqual({ slides: 30, points: 8 });
    const outline = teacher(openuiLibrary).toJSONSchema().$defs?.SlideOutline as {
      properties: { slides: { maxItems: number; items: { properties: { points: { maxItems: number } } } } };
    };
    expect(outline.properties.slides.maxItems).toBe(SLIDE_LIMITS.slides);
    expect(outline.properties.slides.items.properties.points.maxItems).toBe(SLIDE_LIMITS.points);
  });
  it('defines seven rules that point to the new components and the teaching-design skill', () => {
    expect(TEACHER_RULES).toHaveLength(7);
    const all = TEACHER_RULES.join('\n');
    for (const term of ['SlideOutline', 'FileCard', 'teaching-design', '@ToAssistant', 'Hong Kong'])
      expect(all).toContain(term);
  });
});
