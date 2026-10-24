import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ListeningProject, ListeningState } from '@/common/types/platform/listeningProject';
import { layoutTimeline, sequenceTrack, type DurationLookup } from '@/common/types/platform/listeningTimeline';
import type { ListeningTarget } from '@/renderer/pages/listening/data/api';
import { moveSectionTo, moveSegment, resizePause, trimClip } from '@/renderer/pages/listening/editing/operations';
import type { Selection } from '@/renderer/pages/listening/editing/useSelection';
import {
  authoredBlocks,
  authoredToTime,
  timeToAuthored,
  type TimelineBlock,
} from '@/renderer/pages/listening/timeline/blocks';
import { SegmentBlock } from '@/renderer/pages/listening/timeline/blocks/SegmentBlock';
import { SpacerBlock } from '@/renderer/pages/listening/timeline/blocks/SpacerBlock';
import { useTimelineDrag } from '@/renderer/pages/listening/timeline/useTimelineDrag';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

const BLOCK_HEIGHT = 72;
/** jsdom and hidden containers report no width; assume a typical viewport so something renders. */
const FALLBACK_VIEWPORT = 1200;

export type TimelineProps = {
  project: ListeningProject;
  state: ListeningState;
  target?: ListeningTarget;
  selection: Selection;
  disabled: boolean;
  pxPerSec: number;
  /** Rendered-track time of the playhead, in seconds. */
  playhead: number;
  /** Ungenerated line the preview is currently playing silence for. */
  flashing?: string;
  onSeek: (seconds: number) => void;
  onWheel: (event: React.WheelEvent) => void;
  onSelect: (selection: Selection) => void;
  onSelectSegment: (sectionId: string, segmentId: string, extend: boolean) => void;
  onEdit: (change: (project: ListeningProject) => ListeningProject) => void;
};

/** Generated line lengths from the editor state; everything else uses its own length or an estimate. */
export const stateDurations =
  (state: ListeningState): DurationLookup =>
  (segment) =>
    segment.type === 'speech' ? state.segments[segment.id]?.duration : undefined;

/** Ids of lines a running or failed `segments` task covers, for per-block status. */
function generationStatus(state: ListeningState): Map<string, 'running' | 'failed'> {
  const status = new Map<string, 'running' | 'failed'>();
  const tasks = state.tasks.filter((task) => task.kind === 'segments').toSorted((a, b) => a.createdAt - b.createdAt);
  for (const task of tasks)
    for (const id of task.segmentIds ?? []) {
      if (task.status === 'queued' || task.status === 'running') status.set(id, 'running');
      else if (task.status === 'failed') status.set(id, 'failed');
      else status.delete(id);
    }
  return status;
}

/** Drop position for a block dragged to content x: the section and index (counted after removal). */
function dropTarget(
  project: ListeningProject,
  blocks: TimelineBlock[],
  segmentId: string,
  x: number
): { sectionId: string; index: number } | undefined {
  const segments = blocks.filter(
    (block): block is Extract<TimelineBlock, { kind: 'segment' }> => block.kind === 'segment'
  );
  const over =
    segments.find((block) => x >= block.x && x < block.x + block.width) ??
    segments.toSorted((a, b) => Math.abs(a.x + a.width / 2 - x) - Math.abs(b.x + b.width / 2 - x))[0];
  if (!over || over.segment.id === segmentId) return undefined;
  const section = project.sections.find((item) => item.id === over.sectionId)!;
  let index = section.segments.findIndex((segment) => segment.id === over.segment.id);
  if (x > over.x + over.width / 2) index++;
  const from = section.segments.findIndex((segment) => segment.id === segmentId);
  if (from >= 0 && from < index) index--;
  return { sectionId: section.id, index };
}

/** The timeline view: sections as bands over authored-order blocks, a ruler to seek, and the playhead. */
export function Timeline(props: TimelineProps): React.ReactElement {
  const { t } = useTranslation();
  const { project, state, pxPerSec, selection } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ left: 0, width: FALLBACK_VIEWPORT });
  const drag = useTimelineDrag(props.disabled);
  const lookup = useMemo(() => stateDurations(state), [state]);
  const blocks = useMemo(() => authoredBlocks(project, lookup, pxPerSec), [project, lookup, pxPerSec]);
  const entries = useMemo(() => layoutTimeline(sequenceTrack(project), project, lookup).entries, [project, lookup]);
  const status = useMemo(() => generationStatus(state), [state]);
  const width = blocks.length ? blocks[blocks.length - 1].x + blocks[blocks.length - 1].width : 0;
  const visible = blocks.filter(
    (block) => block.x + block.width >= viewport.left - viewport.width && block.x <= viewport.left + 2 * viewport.width
  );
  const playhead = timeToAuthored(props.playhead, entries, blocks, pxPerSec);
  const contentX = (clientX: number) =>
    clientX - (scroller.current?.getBoundingClientRect().left ?? 0) + (scroller.current?.scrollLeft ?? 0);
  const bands = project.sections.map((section) => {
    const own = blocks.filter((block) => block.sectionId === section.id && block.kind !== 'gap');
    const start = own[0]?.x ?? 0;
    const last = own[own.length - 1];
    return { section, start, width: last ? last.x + last.width - start : 0 };
  });

  return (
    <div
      ref={scroller}
      className={styles.timeline}
      role='region'
      aria-label={t('messages.listening.view.timeline')}
      onScroll={(event) =>
        setViewport({
          left: event.currentTarget.scrollLeft,
          width: event.currentTarget.clientWidth || FALLBACK_VIEWPORT,
        })
      }
      onWheel={props.onWheel}
    >
      <div className={styles.timelineContent} style={{ width: `${Math.max(width, 1)}px` }}>
        <div
          className={styles.ruler}
          onMouseDown={(event) => props.onSeek(authoredToTime(contentX(event.clientX), entries, blocks, pxPerSec))}
        />
        <div className={styles.bands}>
          {bands.map(({ section, start, width: bandWidth }, index) => (
            <div
              key={section.id}
              className={styles.band}
              data-section={section.id}
              data-selected={selection.kind === 'section' && selection.sectionId === section.id ? 'true' : 'false'}
              style={{ left: `${start}px`, width: `${bandWidth}px` }}
              onMouseDown={(event) =>
                drag(event, {
                  end: (dx, moved) => {
                    if (!moved) return props.onSelect({ kind: 'section', sectionId: section.id });
                    const x = start + dx;
                    const toIndex = bands.filter(
                      (band) => band.section.id !== section.id && band.start + band.width / 2 < x
                    ).length;
                    if (toIndex !== index) props.onEdit((current) => moveSectionTo(current, section.id, toIndex));
                  },
                })
              }
            >
              {section.label || t('messages.listening.fields.sectionLabelPlaceholder', { index: index + 1 })}
              {section.plays > 1 && ` ×${section.plays}`}
            </div>
          ))}
        </div>
        <div className={styles.lane} style={{ height: `${BLOCK_HEIGHT}px` }}>
          {visible.map((block) =>
            block.kind === 'segment' ? (
              <SegmentBlock
                key={block.segment.id}
                block={block}
                target={props.target}
                pxPerSec={pxPerSec}
                height={BLOCK_HEIGHT}
                selected={
                  selection.kind === 'segments'
                    ? selection.ids.includes(block.segment.id)
                    : selection.kind === 'range' && selection.clipId === block.segment.id
                }
                range={selection.kind === 'range' && selection.clipId === block.segment.id ? selection : undefined}
                status={status.get(block.segment.id) ?? 'idle'}
                qaWarning={(() => {
                  const qa = state.segments[block.segment.id]?.qa;
                  return !!qa && !qa.accepted && qa.similarity < state.qaThreshold;
                })()}
                flashing={props.flashing === block.segment.id}
                drag={drag}
                onSelect={(extend) => props.onSelectSegment(block.sectionId, block.segment.id, extend)}
                onRange={(start, end) => props.onSelect({ kind: 'range', clipId: block.segment.id, start, end })}
                onTrim={(edge, value, sourceDuration) =>
                  props.onEdit((current) => trimClip(current, block.segment.id, edge, value, sourceDuration))
                }
                onResize={(seconds) => props.onEdit((current) => resizePause(current, block.segment.id, seconds))}
                onMove={(dx, grab) => {
                  const drop = dropTarget(project, blocks, block.segment.id, block.x + grab + dx);
                  if (drop)
                    props.onEdit((current) => moveSegment(current, block.segment.id, drop.sectionId, drop.index));
                }}
              />
            ) : (
              <SpacerBlock key={`${block.kind}-${block.sectionId}`} block={block} height={BLOCK_HEIGHT} />
            )
          )}
        </div>
        {playhead && (
          <div className={styles.playhead} style={{ left: `${playhead.x}px` }}>
            {playhead.play > 1 && (
              <span className={styles.playBadge}>
                {t('messages.listening.timeline.playBadge', { play: playhead.play })}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
