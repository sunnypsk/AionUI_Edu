import React, { useEffect, useRef, useState } from 'react';
import { Button, Slider } from '@arco-design/web-react';
import { PauseOne, PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from './ListeningEditor/draft';
import styles from './OpenUIComponents.module.css';

/**
 * Minimal audio player built from Arco controls. The file is fetched on first play and kept as a blob
 * URL, so seeking works without relying on HTTP range support from the file stream endpoint.
 */
export function AudioPlayer({ url, compact = false }: { url: string; compact?: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [blobUrl, setBlobUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    setBlobUrl(undefined);
    setFailed(false);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
  }, [url]);
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  const toggle = async (): Promise<void> => {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      return;
    }
    if (!blobUrl) {
      setLoading(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`audio ${response.status}`);
        const next = URL.createObjectURL(await response.blob());
        element.src = next;
        setBlobUrl(next);
      } catch {
        setFailed(true);
        return;
      } finally {
        setLoading(false);
      }
    }
    await element.play().catch(() => setFailed(true));
  };

  return (
    <div className={compact ? styles.audioPlayerCompact : styles.audioPlayer}>
      {/* No native controls: the element is driven entirely by the Arco controls below. */}
      <audio
        ref={audio}
        preload='none'
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
      />
      <Button
        size='mini'
        shape='circle'
        type={compact ? 'text' : 'secondary'}
        aria-label={t(playing ? 'messages.listening.player.pause' : 'messages.listening.player.play')}
        icon={playing ? <PauseOne /> : <PlayOne />}
        loading={loading}
        status={failed ? 'warning' : undefined}
        onClick={() => void toggle()}
      />
      {!compact && (
        <>
          <Slider
            className={styles.audioSlider}
            min={0}
            max={duration || 1}
            step={0.1}
            value={position}
            disabled={!duration}
            formatTooltip={(value) => formatDuration(Number(value))}
            onChange={(value) => {
              if (audio.current && typeof value === 'number') audio.current.currentTime = value;
            }}
          />
          <span className={styles.audioTime}>
            {formatDuration(position)} / {formatDuration(duration)}
          </span>
        </>
      )}
      {failed && <span className={styles.fileStatus}>{t('messages.listening.player.loadFailed')}</span>}
    </div>
  );
}
