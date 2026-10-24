import React, { useState } from 'react';
import { Alert, Button, Form, Input, Message, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { DEFAULT_TRANSCRIPTION_MODEL } from '@/common/types/platform/audioTools';
import AionSelect from '@/renderer/components/base/AionSelect';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import SettingsSection from '../AgentModalContent/SettingsSection';
import { audioToolsApi } from './api';

/** Per-user credentials and the multimodal model used by the agent's audio tools. */
export default function AudioToolsSettings(): React.ReactElement {
  const { user } = useAuth();
  return <UserAudioToolsSettings key={user?.id ?? 'anonymous'} userId={user?.id} />;
}

function UserAudioToolsSettings({ userId }: { userId?: string }): React.ReactElement {
  const { t } = useTranslation();
  const {
    data: saved,
    error: settingsError,
    mutate,
  } = useSWR(userId ? ['edu.audio.settings', userId] : null, audioToolsApi.settings, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const {
    data: catalog,
    error: catalogError,
    isValidating,
    mutate: refresh,
  } = useSWR('edu.audio.models', () => audioToolsApi.models(), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [draftModel, setDraftModel] = useState<string>();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const model = draftModel ?? saved?.model ?? DEFAULT_TRANSCRIPTION_MODEL;
  const suggestions = catalog?.models.filter((item) => item.audioInput || item.id === model) ?? [];
  const options = suggestions.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }));
  if (!options.some((item) => item.value === model)) options.unshift({ value: model, label: model });
  const save = async (clearApiKey = false): Promise<void> => {
    if (!saved || saving || !model.trim()) return;
    setSaving(true);
    try {
      const value = await audioToolsApi.save({
        model: model.trim(),
        ...(clearApiKey ? { clearApiKey: true } : apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      await mutate(value, false);
      setDraftModel(undefined);
      setApiKey('');
      Message.success(t('common.saveSuccess'));
    } catch {
      Message.error(t('settings.audioTools.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsSection
      id='audio-tools-title'
      title={t('settings.audioTools.title')}
      description={t('settings.audioTools.description')}
    >
      {settingsError && <Alert type='error' content={t('settings.audioTools.loadFailed')} className='mb-12px' />}
      {catalogError && <Alert type='warning' content={t('settings.audioTools.catalogFailed')} className='mb-12px' />}
      <Form layout='vertical' onSubmit={() => void save()}>
        <Form.Item label={t('settings.audioTools.model')} help={t('settings.audioTools.modelHelp')}>
          <AionSelect
            aria-label={t('settings.audioTools.model')}
            value={model}
            options={options}
            showSearch
            allowCreate
            disabled={saving || !saved}
            onChange={setDraftModel}
          />
        </Form.Item>
        <Form.Item
          label={t('settings.audioTools.apiKey')}
          help={saved?.hasApiKey ? t('settings.audioTools.keyConfigured') : t('settings.audioTools.keyMissing')}
        >
          <Input.Password
            aria-label={t('settings.audioTools.apiKey')}
            value={apiKey}
            onChange={setApiKey}
            disabled={saving || !saved}
            autoComplete='new-password'
            placeholder={t('settings.audioTools.keyPlaceholder')}
          />
        </Form.Item>
        {saved && !saved.hasApiKey && (
          <Alert type='info' className='mb-12px' content={t('settings.audioTools.withoutKey')} />
        )}
        <Typography.Paragraph type='secondary'>{t('settings.audioTools.newTasks')}</Typography.Paragraph>
        <Space wrap>
          <Button
            loading={isValidating}
            disabled={saving}
            onClick={() =>
              void refresh(audioToolsApi.models(true), false).catch(() =>
                Message.error(t('settings.audioTools.catalogFailed'))
              )
            }
          >
            {t('settings.audioTools.refresh')}
          </Button>
          <Button disabled={saving || !saved?.hasApiKey} onClick={() => void save(true)}>
            {t('settings.audioTools.clearKey')}
          </Button>
          <Button type='primary' htmlType='submit' loading={saving} disabled={!saved || !model.trim()}>
            {t('common.save')}
          </Button>
        </Space>
      </Form>
      <Typography.Paragraph className='!mt-20px !mb-0' type='secondary'>
        {t('settings.audioTools.ttsDescription')}
      </Typography.Paragraph>
    </SettingsSection>
  );
}
