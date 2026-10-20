import { z } from 'zod';
import { defineComponent, reactive, type ComponentRenderer, type Library } from '@openuidev/react-lang';

/** Upper bounds the schema enforces so a generated outline stays reviewable. */
export const SLIDE_LIMITS = { slides: 30, points: 8 } as const;

/** `points` is optional so a slide streamed in with only its title still validates. */
export const slideSchema = z.object({
  title: z.string(),
  points: z.array(z.string()).max(SLIDE_LIMITS.points).optional(),
  visual: z.string().optional(),
  notes: z.string().optional(),
});
export type Slide = z.infer<typeof slideSchema>;

const slideOutlineProps = z.object({
  name: z.string(),
  slides: z.array(slideSchema).max(SLIDE_LIMITS.slides),
  value: reactive(z.array(slideSchema).optional()),
});
export type SlideOutlineProps = z.infer<typeof slideOutlineProps>;

const fileCardProps = z.object({
  path: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
});
export type FileCardProps = z.infer<typeof fileCardProps>;

export type TeacherRenderers = {
  SlideOutline: ComponentRenderer<SlideOutlineProps>;
  FileCard: ComponentRenderer<FileCardProps>;
};

/** Content slots that accept the teacher components, keyed by each official library's root. */
export const TEACHER_SLOTS: Record<string, string[]> = {
  Stack: ['Card', 'TabItem', 'AccordionItem', 'Modal'],
  Card: ['Card', 'TabItem', 'AccordionItem', 'SectionItem'],
};

/**
 * Add the teacher components to an official library without overriding or removing anything.
 * The manifest generator passes renderers that return null; the WebUI passes real renderers,
 * so both sides derive the same schema and prompt from these contracts.
 */
export function withTeacherComponents<L extends Library>(library: L, renderers: TeacherRenderers): L {
  const slots = TEACHER_SLOTS[library.root ?? ''];
  if (!slots || !library.extend) throw new Error(`OpenUI library root ${library.root} cannot take teacher components`);
  const components = [
    defineComponent({
      name: 'SlideOutline',
      props: slideOutlineProps,
      description:
        'Editable slide outline the teacher reviews before a .pptx is produced; each slide has a title, points, an optional suggested visual and speaker notes. Pair with a confirm Button using @ToAssistant.',
      component: renderers.SlideOutline,
    }),
    defineComponent({
      name: 'FileCard',
      props: fileCardProps,
      description:
        'A file produced in this conversation, with preview and download. path is relative to the conversation workspace (no absolute paths, no "..").',
      component: renderers.FileCard,
    }),
  ];
  return library.extend({ components: { add: components.map((component) => ({ component, slots })) } }) as L;
}
