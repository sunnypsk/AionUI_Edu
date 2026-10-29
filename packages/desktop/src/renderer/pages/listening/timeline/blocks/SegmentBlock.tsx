import React, { useState } from 'react';
import { Spin } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ListeningTarget } from '@/renderer/pages/listening/data/api';
import type { TimelineBlock } from '@/renderer/pages/listening/timeline/blocks';
import { usePeaks } from '@/renderer/pages/listening/timeline/peaks';
import type { DragHandlers } from '@/renderer/pages/listening/timeline/useTimelineDrag';
import { Waveform } from '@/renderer/pages/listening/timeline/Waveform';
import { GenerateButton, type GenerationContext } from '@/renderer/pages/listening/panels/GenerateButton';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

type SegmentTimelineBlock = Extract<TimelineBlock, { kind: 'segment' }>;
/** Range endpoints closer than this to a clip edge snap to it. */
const SNAP_PX = 6;

export type SegmentBlockProps = {
  block: SegmentTimelineBlock;
  target?: ListeningTarget;
  pxPerSec: number;
  height: number;
  selected: boolean;
  /** Selected source range inside this clip, in source seconds. */
  range?: { start: number; end: number };
  status: 'idle' | 'running' | 'failed';
  qaWarning: boolean;
  /** Briefly highlighted while the preview plays silence for this ungenerated line. */
  flashing?: boolean;
  generation?: GenerationContext;
  drag: (event: React.MouseEvent, handlers: DragHandlers) => void;
  onSelect: (extend: boolean) => void;
  onRange: (start: number, end: number) => void;
  onTrim: (edge: 'start' | 'end', value: number, sourceDuration: number) => void;
  onResize: (seconds: number) => void;
  /** Dropped after moving by `dx` pixels; `grab` is where in the block the drag began. */
  onMove: (dx: number, grab: number) => void;
};

/** One segment on the timeline: a grip to move it, a body (waveform for clips) and edge handles. */
export function SegmentBlock(props: SegmentBlockProps): React.ReactElement {
  const { t } = useTranslation();
  const { block, pxPerSec, drag } = props;
  const segment = block.segment;
  const clip = segment.type === 'clip' ? segment : undefined;
  const { peaks } = usePeaks(clip ? props.target : undefined, clip?.path);
  const sourceDuration = peaks ? (peaks.min.length * peaks.bucketMs) / 1000 : (clip?.end ?? 0);
  const [preview, setPreview] = useState<{ start: number; end: number }>();
  const label =
    segment.type === 'speech'
      ? segment.text
      : segment.type === 'pause'
        ? t('messages.listening.timeline.pause', { seconds: segment.seconds })
        : segment.type === 'chime'
          ? t('messages.listening.types.chime')
          : // Show what is said, so a block can be found without listening; fall back to the file name.
            segment.transcript?.text.trim() || segment.note || segment.path.split('/').pop();

  const grip = (event: React.MouseEvent) => {
    const grab = event.clientX - event.currentTarget.getBoundingClientRect().left;
    drag(event, { end: (dx, moved, up) => (moved ? props.onMove(dx, grab) : props.onSelect(up.shiftKey)) });
  };
  const body = (event: React.MouseEvent) => {
    if (!clip) return grip(event);
    const left = event.currentTarget.getBoundingClientRect().left;
    const at = (clientX: number) => {
      const x = clientX - left;
      if (x <= SNAP_PX) return clip.start;
      if (block.width - x <= SNAP_PX) return clip.end;
      return Math.min(clip.end, Math.max(clip.start, clip.start + x / pxPerSec));
    };
    const from = at(event.clientX);
    const range = (clientX: number) => {
      const to = at(clientX);
      return { start: Math.min(from, to), end: Math.max(from, to) };
    };
    drag(event, {
      move: (_dx, move) => setPreview(range(move.clientX)),
      end: (_dx, moved, up) => {
        setPreview(undefined);
        if (!moved) return props.onSelect(up.shiftKey);
        const value = range(up.clientX);
        if (value.end > value.start) props.onRange(value.start, value.end);
      },
    });
  };
  const handle = (edge: 'start' | 'end') => (event: React.MouseEvent) =>
    drag(event, {
      end: (dx) => {
        if (clip) props.onTrim(edge, (edge === 'start' ? clip.start : clip.end) + dx / pxPerSec, sourceDuration);
        else if (segment.type === 'pause') props.onResize(segment.seconds + dx / pxPerSec);
      },
    });
  const shown = preview ?? props.range;
  return (
    <div
      className={styles.block}
      data-block={segment.id}
      data-kind={segment.type}
      data-selected={props.selected ? 'true' : 'false'}
      data-estimated={block.estimated ? 'true' : 'false'}
      data-status={props.status}
      data-flash={props.flashing ? 'true' : 'false'}
      style={{ left: `${block.x}px`, width: `${block.width}px`, height: `${props.height}px` }}
    >
      <div className={styles.blockGrip} data-grip title={t('messages.listening.timeline.move')} onMouseDown={grip}>
        {props.status === 'running' && <Spin size={10} />}
        {props.qaWarning && <Attention size={12} className={styles.qaWarning} />}
        <span className={styles.blockLabel}>{label}</span>
      </div>
      <div className={styles.blockBody} data-body onMouseDown={body}>
        {segment.type === 'speech' && block.estimated && (
          <div className={styles.blockGenerate}>
            <GenerateButton id={segment.id} generated={false} context={props.generation} />
            {props.flashing && <span>{t('messages.listening.segment.notRendered')}</span>}
          </div>
        )}
        {clip && (
          <Waveform peaks={peaks} start={clip.start} end={clip.end} width={block.width} height={props.height - 18} />
        )}
        {clip && shown && (
          <div
            className={styles.blockRange}
            style={{
              left: `${(shown.start - clip.start) * pxPerSec}px`,
              width: `${(shown.end - shown.start) * pxPerSec}px`,
            }}
          />
        )}
      </div>
      {clip && (
        <div
          className={styles.blockHandle}
          data-handle='start'
          aria-label={t('messages.listening.timeline.trimStart')}
          onMouseDown={handle('start')}
        />
      )}
      {(clip || segment.type === 'pause') && (
        <div
          className={`${styles.blockHandle} ${styles.blockHandleEnd}`}
          data-handle='end'
          aria-label={t('messages.listening.timeline.trimEnd')}
          onMouseDown={handle('end')}
        />
      )}
    </div>
  );
}
