import React from 'react';
import { Button, Spin } from '@arco-design/web-react';
import { GoEnd, GoStart, PauseOne, PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { formatTimestamp } from '@/renderer/pages/listening/data/status';
import type { Player } from '@/renderer/pages/listening/playback/usePlayer';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Section starts in track time, from the first entry of each section's first play. */
function sectionStarts(player: Player): number[] {
  const seen = new Set<string>();
  return player.entries.flatMap((entry) => {
    if (seen.has(entry.sectionId)) return [];
    seen.add(entry.sectionId);
    return [entry.start];
  });
}

/** Play/pause, jump between sections, and the current position of the live preview. */
export function PlaybackControls({ player }: { player: Player }): React.ReactElement {
  const { t } = useTranslation();
  const starts = sectionStarts(player);
  const previous = starts.filter((start) => start < player.time - 0.5).pop() ?? 0;
  const next = starts.find((start) => start > player.time + 0.01);
  return (
    <div className={styles.playback}>
      <Button
        size='small'
        icon={<GoStart />}
        aria-label={t('messages.listening.player.prevSection')}
        onClick={() => player.seek(previous)}
      />
      <Button
        size='small'
        type='primary'
        icon={player.playing ? <PauseOne /> : <PlayOne />}
        aria-label={t(player.playing ? 'messages.listening.player.pause' : 'messages.listening.player.play')}
        disabled={!player.duration}
        onClick={player.toggle}
      />
      <Button
        size='small'
        icon={<GoEnd />}
        aria-label={t('messages.listening.player.nextSection')}
        disabled={next === undefined}
        onClick={() => next !== undefined && player.seek(next)}
      />
      <span className={styles.playbackTime}>
        {formatTimestamp(player.time)} / {formatTimestamp(player.duration)}
      </span>
      {player.buffering && <Spin size={12} tip={t('messages.listening.player.buffering')} />}
      {player.failed && (
        <span className={styles.qaWarning} role='alert'>
          {t('messages.listening.player.sourceError')}
        </span>
      )}
    </div>
  );
}
