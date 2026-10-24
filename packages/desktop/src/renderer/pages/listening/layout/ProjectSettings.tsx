import React from 'react';
import { Collapse, InputNumber, Select, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { AUDIO_VOICES, type AudioVoice } from '@/common/types/platform/audioTools';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { draft as edits, RATE_OPTIONS } from '@/renderer/pages/listening/editing/draft';
import { LexiconPanel } from '@/renderer/pages/listening/panels/LexiconPanel';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/** Project-wide voice defaults and pronunciation fixes, shown in the inspector when nothing is selected. */
export function ProjectSettings({
  project,
  disabled,
  lexiconOpen,
  onLexiconOpen,
  onEdit,
}: {
  project: ListeningProject;
  disabled: boolean;
  lexiconOpen: string[];
  onLexiconOpen: (keys: string[]) => void;
  onEdit: (change: (project: ListeningProject) => ListeningProject) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className={styles.projectSettings}>
      <Space size={8} wrap>
        <Select
          size='small'
          className={styles.defaultSelect}
          aria-label={t('messages.listening.fields.defaultVoice')}
          prefix={t('messages.listening.fields.defaultVoice')}
          value={project.defaults.voice}
          disabled={disabled}
          options={AUDIO_VOICES.map((voice) => ({ value: voice, label: t(`messages.listening.voices.${voice}`) }))}
          onChange={(voice: AudioVoice) =>
            onEdit((current) => ({ ...current, defaults: { ...current.defaults, voice } }))
          }
        />
        <Select
          size='small'
          className={styles.defaultSelect}
          aria-label={t('messages.listening.fields.defaultRate')}
          prefix={t('messages.listening.fields.defaultRate')}
          value={project.defaults.rate}
          disabled={disabled}
          options={[...new Set([...RATE_OPTIONS, project.defaults.rate])].map((rate) => ({
            value: rate,
            label: rate === '+0%' ? t('messages.listening.fields.rateNormal') : rate,
          }))}
          onChange={(rate: string) => onEdit((current) => ({ ...current, defaults: { ...current.defaults, rate } }))}
        />
        {(['volume', 'pitch'] as const).map((field) => (
          <InputNumber
            key={field}
            size='small'
            className={styles.defaultSelect}
            aria-label={t(`messages.listening.fields.${field}`)}
            prefix={t(`messages.listening.fields.${field}`)}
            suffix={field === 'pitch' ? 'Hz' : '%'}
            step={5}
            precision={0}
            value={Number.parseFloat(project.defaults[field])}
            disabled={disabled}
            onChange={(value) => {
              const next = value ?? 0;
              onEdit((current) => ({
                ...current,
                defaults: {
                  ...current.defaults,
                  [field]: `${next >= 0 ? '+' : ''}${next}${field === 'pitch' ? 'Hz' : '%'}`,
                },
              }));
            }}
          />
        ))}
      </Space>
      <Collapse activeKey={lexiconOpen} onChange={(_key, keys) => onLexiconOpen(keys)} bordered={false}>
        <Collapse.Item name='lexicon' header={t('messages.listening.lexicon.title', { count: project.lexicon.length })}>
          <LexiconPanel
            lexicon={project.lexicon}
            disabled={disabled}
            onChange={(lexicon) => onEdit((current) => edits.setLexicon(current, lexicon))}
          />
        </Collapse.Item>
      </Collapse>
    </div>
  );
}
