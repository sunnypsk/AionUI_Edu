import React, { useState } from 'react';
import { Alert, Button, Form, Message, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate as refresh } from 'swr';
import type { SpecialistSettings } from '@/common/types/platform/specialists';
import { isModelSelectionAvailable } from '@/common/types/platform/cliModels';
import { specialistApi } from '@/renderer/services/runtime/specialists';
import Fields from './Fields';
import SettingsSection from '../SettingsSection';

export default function FactoryModelSettings(): React.ReactElement {
  const { t } = useTranslation();
  const {
    data: saved,
    error: settingsError,
    mutate: saveCache,
  } = useSWR('edu.factory.settings', specialistApi.settings, { revalidateOnFocus: false, shouldRetryOnError: false });
  const { data, error, isValidating, mutate } = useSWR('edu.factory.models', () => specialistApi.models(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [draft, setDraft] = useState<SpecialistSettings>();
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;
  const valid =
    !!value &&
    !!data &&
    !error &&
    !settingsError &&
    Object.values(value).every((selection) => isModelSelectionAvailable(selection, data.models));
  const save = async (): Promise<void> => {
    if (!value || !valid || saving) return;
    setSaving(true);
    try {
      const result = await specialistApi.saveSettings(value);
      await saveCache(result, false);
      setDraft(undefined);
      void refresh('edu.factory.account');
      Message.success(t('common.saveSuccess'));
    } catch {
      Message.error(t('common.saveFailed'));
      void mutate();
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsSection
      id='factory-settings-title'
      title={t('codex.catalog.factoryTitle')}
      description={t('codex.catalog.newTasks')}
    >
      {(error || settingsError) && <Alert type='error' content={t('codex.catalog.loadFailed')} className='mb-12px' />}
      {data && !data.models.length && <Alert type='info' content={t('codex.catalog.empty')} className='mb-12px' />}
      <Form layout='vertical' onSubmit={() => void save()}>
        {value &&
          (['argon', 'opus'] as const).map((role) => (
            <div key={role} className='mb-16px'>
              <Typography.Paragraph bold>{t(`codex.specialists.models.${role}`)}</Typography.Paragraph>
              <Fields
                value={value[role]}
                models={data?.models ?? []}
                disabled={saving || !data || !!error || !!settingsError}
                onChange={(selection) => setDraft({ ...value, [role]: selection })}
              />
            </div>
          ))}
        <Space wrap className='flex justify-end w-full'>
          <Button
            loading={isValidating}
            disabled={saving}
            onClick={() =>
              void Promise.all([mutate(specialistApi.models(true), false), saveCache()]).catch(() =>
                Message.error(t('codex.catalog.loadFailed'))
              )
            }
          >
            {t('codex.account.refresh')}
          </Button>
          <Button type='primary' htmlType='submit' loading={saving} disabled={!valid}>
            {t('common.save')}
          </Button>
        </Space>
      </Form>
    </SettingsSection>
  );
}
