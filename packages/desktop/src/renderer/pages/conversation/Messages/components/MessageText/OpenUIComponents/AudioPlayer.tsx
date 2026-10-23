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
export function AudioPlayer({
  url,
  compact = false,
  start = 0,
  end,
}: {
  url: string;
  compact?: boolean;
  start?: number;
  end?: number;
}): React.ReactElement {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | undefined>(undefined);
  const [blobUrl, setBlobUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const valid = Number.isFinite(start) && start >= 0 && (end === undefined || (Number.isFinite(end) && end > start));
  const bounds = (element: HTMLAudioElement): number =>
    Math.min(end ?? Infinity, Number.isFinite(element.duration) ? element.duration : Infinity);

  useEffect(() => {
    const element = audio.current;
    if (element?.getAttribute('src')) {
      element.pause();
      element.removeAttribute('src');
    }
    setBlobUrl(undefined);
    setLoading(false);
    setFailed(false);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    return () => {
      request.current?.abort();
      if (element?.getAttribute('src')) element.pause();
    };
  }, [url, start, end]);
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  const toggle = async (): Promise<void> => {
    const element = audio.current;
    if (!element || !valid) return;
    if (playing) {
      element.pause();
      return;
    }
    if (!blobUrl) {
      const controller = new AbortController();
      request.current?.abort();
      request.current = controller;
      setLoading(true);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`audio ${response.status}`);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        const next = URL.createObjectURL(blob);
        element.src = next;
        setBlobUrl(next);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
        return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    setFailed(false);
    if (element.currentTime < start || element.currentTime >= bounds(element)) element.currentTime = start;
    const signal = request.current?.signal;
    await element.play().catch(() => {
      if (!signal?.aborted) setFailed(true);
    });
  };

  const updatePosition = (element: HTMLAudioElement): void => {
    const stop = bounds(element);
    if (element.currentTime >= stop) {
      element.pause();
      if (element.currentTime > stop) element.currentTime = stop;
    } else if (element.currentTime < start) element.currentTime = start;
    setPosition(Math.max(0, Math.min(element.currentTime, stop) - start));
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
        onTimeUpdate={(event) => updatePosition(event.currentTarget)}
        onSeeked={(event) => updatePosition(event.currentTarget)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          const stop = bounds(element);
          if (!valid || !Number.isFinite(stop) || stop <= start) {
            element.pause();
            setFailed(true);
            return;
          }
          element.currentTime = start;
          setDuration(stop - start);
        }}
      />
      <Button
        size='mini'
        shape='circle'
        type={compact ? 'text' : 'secondary'}
        aria-label={t(playing ? 'messages.listening.player.pause' : 'messages.listening.player.play')}
        icon={playing ? <PauseOne /> : <PlayOne />}
        loading={loading}
        disabled={!valid}
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
              if (audio.current && typeof value === 'number') audio.current.currentTime = start + value;
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
