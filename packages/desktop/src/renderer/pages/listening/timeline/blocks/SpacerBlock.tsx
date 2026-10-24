import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TimelineBlock } from '@/renderer/pages/listening/timeline/blocks';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** The repeat summary or the gap after a section: not editable here, sized to its real length. */
export function SpacerBlock({
  block,
  height,
}: {
  block: Exclude<TimelineBlock, { kind: 'segment' }>;
  height: number;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={block.kind === 'repeat' ? styles.repeatBlock : styles.gapBlock}
      data-kind={block.kind}
      style={{ left: `${block.x}px`, width: `${block.width}px`, height: `${height}px` }}
    >
      <span className={styles.blockLabel}>
        {block.kind === 'repeat'
          ? t('messages.listening.timeline.repeat', { plays: block.plays, gap: block.gap })
          : t('messages.listening.timeline.gap')}
      </span>
    </div>
  );
}
