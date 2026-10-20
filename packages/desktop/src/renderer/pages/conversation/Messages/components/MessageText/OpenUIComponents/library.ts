import type { Library } from '@openuidev/react-lang';
import { withTeacherComponents } from '@/common/openui/components';
import { FileCardRenderer } from './FileCard';

/** Renders nothing until the SlideOutline renderer lands; the contract already parses. */
const SlideOutlineRenderer = (): null => null;

/** Extend an official library with the teacher components and their WebUI renderers. */
export function withRendererTeacherComponents(library: Library): Library {
  return withTeacherComponents(library, { SlideOutline: SlideOutlineRenderer, FileCard: FileCardRenderer });
}
