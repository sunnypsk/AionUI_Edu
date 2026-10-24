import React from 'react';
import { Button, Slider } from '@arco-design/web-react';
import { CuttingOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { NewSegmentType } from '@/renderer/pages/listening/editing/draft';
import { ZOOM } from '@/renderer/pages/listening/timeline/useZoom';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

const INSERTS: NewSegmentType[] = ['speech', 'pause', 'chime', 'clip'];
const INSERT_KEYS: Record<NewSegmentType, string> = {
  speech: 'messages.listening.insert.speech',
  pause: 'messages.listening.insert.pause',
  chime: 'messages.listening.insert.chime',
  clip: 'messages.listening.insert.clip',
};

/** Bottom bar: playback controls (passed as children), insert and split, and timeline zoom. */
export function TransportBar({
  disabled,
  onInsert,
  onSplit,
  zoom,
  children,
}: {
  disabled: boolean;
  onInsert: (type: NewSegmentType) => void;
  onSplit: () => void;
  /** Present in the timeline view only. */
  zoom?: { pxPerSec: number; setPxPerSec: (value: number) => void };
  children?: React.ReactNode;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.transportBar}>
      {children}
      {INSERTS.map((type) => (
        <Button key={type} size='small' disabled={disabled} onClick={() => onInsert(type)}>
          {t(INSERT_KEYS[type])}
        </Button>
      ))}
      <Button size='small' icon={<CuttingOne />} disabled={disabled} onClick={onSplit}>
        {t('messages.listening.timeline.split')}
      </Button>
      {zoom && (
        <div className={styles.zoom}>
          <span>{t('messages.listening.timeline.zoom')}</span>
          <Slider
            aria-label={t('messages.listening.timeline.zoom')}
            min={ZOOM.MIN_PX_PER_SEC}
            max={ZOOM.MAX_PX_PER_SEC}
            value={zoom.pxPerSec}
            onChange={(value) => zoom.setPxPerSec(value as number)}
          />
        </div>
      )}
    </div>
  );
}
