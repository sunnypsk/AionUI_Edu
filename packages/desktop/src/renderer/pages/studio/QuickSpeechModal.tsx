import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Message, Modal, Radio, Select, Space } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import {
  QUICK_SPEECH_FORMATS,
  QUICK_SPEECH_MAX_CHARS,
  type QuickSpeechFormat,
  type QuickSpeechInput,
} from '@/common/types/platform/audioStudio';
import { AUDIO_VOICES, type AudioVoice } from '@/common/types/platform/audioTools';
import { listeningError } from '@/renderer/pages/listening/data/api';
import { errorKey } from '@/renderer/pages/listening/data/status';
import { RATE_OPTIONS } from '@/renderer/pages/listening/editing/draft';
import { studioApi } from '@/renderer/pages/studio/data/studioApi';
import styles from '@/renderer/pages/studio/StudioPage.module.css';

/** Generated audio and the exact request it was made from, so later edits mark it as outdated. */
type Result = { url: string; request: string; format: QuickSpeechFormat };

const offset = (value: number | undefined, unit: '%' | 'Hz'): string => {
  const next = value ?? 0;
  return `${next >= 0 ? '+' : ''}${next}${unit}`;
};
const pad = (value: number): string => String(value).padStart(2, '0');
/** Local timestamp for download names, e.g. `20261029-163000`. */
const stamp = (date = new Date()): string => {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

/** Project-free text-to-speech: type text, pick a Cantonese voice, then play or download the audio. */
export function QuickSpeechModal({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const { t } = useTranslation();
  const [message, messageHolder] = Message.useMessage();
  const [input, setInput] = useState<QuickSpeechInput>({
    text: '',
    voice: 'HiuMaan',
    rate: '+0%',
    volume: '+0%',
    pitch: '+0Hz',
    format: 'mp3',
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result>();
  const pending = useRef<AbortController | undefined>(undefined);
  const text = input.text.trim();
  const request = JSON.stringify({ ...input, text });
  const current = result?.request === request;

  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result]
  );
  useEffect(() => () => pending.current?.abort(), []);

  const update = (change: Partial<QuickSpeechInput>) => setInput((previous) => ({ ...previous, ...change }));
  const generate = async () => {
    if (!text) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const audio = await studioApi.speech({ ...input, text }, controller.signal);
      setResult({ url: URL.createObjectURL(audio), request, format: input.format });
    } catch (failure) {
      if (!controller.signal.aborted) message.error?.(t(errorKey(listeningError(failure).code)));
    } finally {
      if (pending.current === controller) {
        pending.current = undefined;
        setLoading(false);
      }
    }
  };
  const download = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = `speech-${stamp()}.${result.format}`;
    link.click();
  };
  const close = () => {
    pending.current?.abort();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      className={styles.speechModal}
      title={t('messages.studio.speech.title')}
      onCancel={close}
      footer={
        <>
          {result && current && (
            <Button icon={<Download />} onClick={download}>
              {t('messages.studio.speech.download', { format: result.format.toUpperCase() })}
            </Button>
          )}
          <Button type='primary' loading={loading} disabled={!text} onClick={() => void generate()}>
            {t('messages.studio.speech.generate')}
          </Button>
        </>
      }
    >
      {messageHolder}
      <div className={styles.speech}>
        <Input.TextArea
          autoFocus
          aria-label={t('messages.studio.speech.textLabel')}
          placeholder={t('messages.studio.speech.placeholder', { max: QUICK_SPEECH_MAX_CHARS })}
          value={input.text}
          maxLength={QUICK_SPEECH_MAX_CHARS}
          showWordLimit
          autoSize={{ minRows: 6, maxRows: 14 }}
          onChange={(value) => update({ text: value })}
        />
        <Space size={8} wrap>
          <Select
            size='small'
            className={styles.speechSetting}
            aria-label={t('messages.listening.fields.voice')}
            prefix={t('messages.listening.fields.voice')}
            value={input.voice}
            options={AUDIO_VOICES.map((voice) => ({ value: voice, label: t(`messages.listening.voices.${voice}`) }))}
            onChange={(voice: AudioVoice) => update({ voice })}
          />
          <Select
            size='small'
            className={styles.speechSetting}
            aria-label={t('messages.listening.fields.defaultRate')}
            prefix={t('messages.listening.fields.defaultRate')}
            value={input.rate}
            options={RATE_OPTIONS.map((rate) => ({
              value: rate,
              label: rate === '+0%' ? t('messages.listening.fields.rateNormal') : rate,
            }))}
            onChange={(rate: string) => update({ rate })}
          />
          <InputNumber
            size='small'
            className={styles.speechSetting}
            aria-label={t('messages.listening.fields.volume')}
            prefix={t('messages.listening.fields.volume')}
            suffix='%'
            step={5}
            min={-100}
            max={100}
            precision={0}
            value={Number.parseFloat(input.volume)}
            onChange={(value) => update({ volume: offset(value, '%') })}
          />
          <InputNumber
            size='small'
            className={styles.speechSetting}
            aria-label={t('messages.listening.fields.pitch')}
            prefix={t('messages.listening.fields.pitch')}
            suffix='Hz'
            step={5}
            min={-100}
            max={100}
            precision={0}
            value={Number.parseFloat(input.pitch)}
            onChange={(value) => update({ pitch: offset(value, 'Hz') })}
          />
          <Radio.Group
            type='button'
            size='small'
            aria-label={t('messages.studio.speech.format')}
            value={input.format}
            options={QUICK_SPEECH_FORMATS.map((format) => ({ value: format, label: format.toUpperCase() }))}
            onChange={(format: QuickSpeechFormat) => update({ format })}
          />
        </Space>
        {result && current ? (
          <audio
            controls
            className={styles.speechPlayer}
            src={result.url}
            aria-label={t('messages.studio.speech.player')}
          />
        ) : (
          <div className={styles.hint}>
            {t(result ? 'messages.studio.speech.outdated' : 'messages.studio.speech.hint')}
          </div>
        )}
      </div>
    </Modal>
  );
}
