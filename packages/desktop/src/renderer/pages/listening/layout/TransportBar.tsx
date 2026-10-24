import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { NewSegmentType } from '@/renderer/pages/listening/editing/draft';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

const INSERTS: NewSegmentType[] = ['speech', 'pause', 'chime', 'clip'];
const INSERT_KEYS: Record<NewSegmentType, string> = {
  speech: 'messages.listening.insert.speech',
  pause: 'messages.listening.insert.pause',
  chime: 'messages.listening.insert.chime',
  clip: 'messages.listening.insert.clip',
};

/** Bottom bar: insert controls now; playback controls join it with live preview. */
export function TransportBar({
  disabled,
  onInsert,
  children,
}: {
  disabled: boolean;
  onInsert: (type: NewSegmentType) => void;
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
    </div>
  );
}
