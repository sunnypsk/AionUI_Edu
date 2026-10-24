import React, { useRef, useState } from 'react';
import { Button, Space, Switch, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { AudioPlayer, type AudioPlayerHandle } from '../../AudioPlayer';
import { formatTimestamp, roundTime } from '../status';
import styles from '../ListeningEditor.module.css';

export type RangeMarks = { start?: number; end?: number };
type Edge = keyof RangeMarks;

const NUDGE_SECONDS = 0.1;
/** Typing targets keep their own keys; shortcuts only apply while focus is on the player area. */
const TYPING = 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="textbox"]';

/**
 * Play a clip of the original recording and mark the start and end of the words to replace.
 * Shortcuts (while focus is inside the group but not in a text field): Space play/pause,
 * `[` / `]` mark start / end, Alt+←/→ move the last marked edge by 0.1 s.
 */
export function RangeMarker({
  url,
  clipStart,
  clipEnd,
  marks,
  disabled,
  onChange,
}: {
  url: string;
  clipStart: number;
  clipEnd: number;
  marks: RangeMarks;
  disabled: boolean;
  onChange: (marks: RangeMarks) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const player = useRef<AudioPlayerHandle>(null);
  const [now, setNow] = useState(clipStart);
  const [loop, setLoop] = useState(false);
  const [edge, setEdge] = useState<Edge>('start');
  const complete = marks.start !== undefined && marks.end !== undefined;
  const invalid = complete && marks.end! <= marks.start!;
  const looping = loop && complete && !invalid;
  // Round first, then clamp: rounding last could push a mark past a fractional clip bound (308.449 → 308.45).
  const clamp = (seconds: number) => Math.max(clipStart, Math.min(clipEnd, roundTime(seconds)));

  const mark = (which: Edge, seconds = player.current?.currentTime() ?? now) => {
    setEdge(which);
    onChange({ ...marks, [which]: clamp(seconds) });
  };
  const nudge = (which: Edge, offset: number) => {
    const base = marks[which] ?? now;
    const next = clamp(base + offset);
    setEdge(which);
    onChange({ ...marks, [which]: next });
    player.current?.seek(next);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled || (event.target as HTMLElement).closest(TYPING)) return;
    const onButton = (event.target as HTMLElement).closest('button');
    if (event.key === ' ' && !onButton) {
      event.preventDefault();
      void player.current?.toggle();
    } else if (event.key === '[' && !event.altKey) {
      event.preventDefault();
      mark('start');
    } else if (event.key === ']' && !event.altKey) {
      event.preventDefault();
      mark('end');
    } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      nudge(edge, event.key === 'ArrowLeft' ? -NUDGE_SECONDS : NUDGE_SECONDS);
    }
  };

  const edgeControls = (which: Edge) => (
    <div className={styles.markRow}>
      <Tooltip content={t(`messages.listening.replace.mark${which === 'start' ? 'Start' : 'End'}Shortcut`)}>
        <Button size='small' disabled={disabled} onClick={() => mark(which)}>
          {t(`messages.listening.replace.mark${which === 'start' ? 'Start' : 'End'}`)}
        </Button>
      </Tooltip>
      <span className={styles.markValue} aria-live='polite'>
        {marks[which] === undefined ? t('messages.listening.replace.unmarked') : formatTimestamp(marks[which]!)}
      </span>
      <Button
        size='mini'
        disabled={disabled || marks[which] === undefined}
        aria-label={t(`messages.listening.replace.${which}Earlier`)}
        onClick={() => nudge(which, -NUDGE_SECONDS)}
      >
        −0.1
      </Button>
      <Button
        size='mini'
        disabled={disabled || marks[which] === undefined}
        aria-label={t(`messages.listening.replace.${which}Later`)}
        onClick={() => nudge(which, NUDGE_SECONDS)}
      >
        +0.1
      </Button>
    </div>
  );

  return (
    <div
      className={styles.marker}
      role='group'
      aria-label={t('messages.listening.replace.markerLabel')}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <AudioPlayer
        url={url}
        start={looping ? marks.start : clipStart}
        end={looping ? marks.end : clipEnd}
        loop={looping}
        label={t('messages.listening.replace.sourceLabel')}
        playerRef={player}
        onTime={setNow}
      />
      <div className={styles.markNow}>{t('messages.listening.replace.now', { time: formatTimestamp(now) })}</div>
      {edgeControls('start')}
      {edgeControls('end')}
      <Space size={8} wrap>
        <Switch
          size='small'
          checked={looping}
          disabled={disabled || !complete || invalid}
          aria-label={t('messages.listening.replace.loop')}
          onChange={setLoop}
        />
        <span className={styles.markHint}>{t('messages.listening.replace.loop')}</span>
      </Space>
      {invalid && (
        <div className={styles.markError} role='alert'>
          {t('messages.listening.replace.invalidRange')}
        </div>
      )}
      <div className={styles.markHint}>{t('messages.listening.replace.shortcuts')}</div>
    </div>
  );
}
