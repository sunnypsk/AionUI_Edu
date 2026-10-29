import type { StudioMediaBlocks } from '@/common/types/platform/audioStudio';
import type { ListeningProject, ListeningSegment } from '@/common/types/platform/listeningProject';
import { newId } from '@/renderer/pages/listening/editing/draft';

/** `count` ids unique within the project and among themselves. */
function freshIds(project: ListeningProject, prefix: string, count: number): string[] {
  const ids = new Set<string>();
  while (ids.size < count) ids.add(newId(project, prefix));
  return [...ids];
}

/** Clip segments for every block of an imported recording, carrying the automatic transcript. */
export function blockSegments(project: ListeningProject, media: StudioMediaBlocks): ListeningSegment[] {
  const ids = freshIds(project, 'clip', media.blocks.length);
  return media.blocks.map((block, index) => ({
    id: ids[index],
    type: 'clip',
    path: media.path,
    start: block.start,
    end: block.end,
    ...(block.text
      ? {
          transcript: {
            text: block.text,
            source: 'auto',
            verified: false,
            ...(block.cues?.length ? { cues: block.cues } : {}),
          },
        }
      : {}),
    ...(block.warnings?.length ? { warnings: block.warnings } : {}),
  }));
}

/** Speech segments for script blocks; audio is generated later with the project voice. */
export function textSegments(project: ListeningProject, blocks: string[]): ListeningSegment[] {
  const ids = freshIds(project, 'line', blocks.length);
  return blocks.map((text, index) => ({ id: ids[index], type: 'speech', text }));
}
