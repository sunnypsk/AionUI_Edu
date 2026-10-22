import React, { useState } from 'react';
import { Alert, Button, Form, Message, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { configService, readCodexSettings } from '@/common/config/configService';
import { isModelSelectionAvailable } from '@/common/types/platform/cliModels';
import { codexModels } from '@/renderer/services/runtime/specialists';
import Fields from './Fields';
import SettingsSection from '../SettingsSection';

export default function CodexModelSettings(): React.ReactElement {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(readCodexSettings);
  const [saving, setSaving] = useState(false);
  const { data, error, isValidating, mutate } = useSWR('edu.codex.models', () => codexModels(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const save = async (): Promise<void> => {
    if (saving || !data || error || !isModelSelectionAvailable(settings, data.models)) return;
    setSaving(true);
    try {
      const fresh = await codexModels(true);
      await mutate(fresh, false);
      if (!isModelSelectionAvailable(settings, fresh.models)) {
        Message.error(t('codex.catalog.invalidSelection'));
        return;
      }
      await configService.setConfirmed('codex.settings', settings);
      Message.success(t('common.saveSuccess'));
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsSection
      id='codex-settings-title'
      title={t('codex.settings.title')}
      description={t('codex.settings.description')}
    >
      {error && <Alert type='error' content={t('codex.catalog.loadFailed')} className='mb-12px' />}
      {data && !data.models.length && <Alert type='info' content={t('codex.catalog.empty')} className='mb-12px' />}
      <Form layout='vertical' onSubmit={() => void save()}>
        <Fields
          value={settings}
          models={data?.models ?? []}
          disabled={saving || !data || !!error}
          onChange={setSettings}
        />
        <Space wrap className='flex justify-end w-full'>
          <Button
            loading={isValidating}
            disabled={saving}
            onClick={() =>
              void mutate(codexModels(true), false).catch(() => Message.error(t('codex.catalog.loadFailed')))
            }
          >
            {t('codex.account.refresh')}
          </Button>
          <Button
            type='primary'
            htmlType='submit'
            loading={saving}
            disabled={!data || !!error || !isModelSelectionAvailable(settings, data.models)}
          >
            {t('common.save')}
          </Button>
        </Space>
      </Form>
    </SettingsSection>
  );
}
