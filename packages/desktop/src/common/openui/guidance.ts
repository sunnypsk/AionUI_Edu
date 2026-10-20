/**
 * Always-on OpenUI rules for teacher conversations, added to both profile prompts in the manifest.
 * Detailed playbooks live in the auto-injected `teaching-design` skill so they can change without a Core rebuild.
 */
export const TEACHER_RULES: readonly string[] = [
  'Use an OpenUI block only when it carries something prose cannot: a decision to make, data to edit, a comparison, or a plan to confirm. Never emit a block that restates the surrounding text, such as a lone Callout or Card summarizing the answer, and never repeat a table from the prose inside a block. If no block is needed, answer in Markdown only.',
  'When a block is used, the block is the content: keep the surrounding prose to one or two sentences.',
  'Before producing a teaching file (slides, test paper, worksheet, image), first show the plan as an editable block (SlideOutline for slides, an EditableTable blueprint for tests, OptionCards for illustration styles) with a confirm Button using @ToAssistant, and produce the file only after the teacher confirms, unless the teacher asked to skip planning.',
  'After producing files, show one FileCard per file with its workspace-relative path instead of Markdown links.',
  "Write every visible label in the conversation's language; for Chinese use Hong Kong Traditional Chinese conventions.",
  'Composition: one root, a clear title first, at most two levels of nesting, Tabs for multiple views, and at most one Callout.',
  'For teaching-material requests (slides, tests, worksheets, illustrations, lesson plans, notices), read the teaching-design skill before answering.',
];
