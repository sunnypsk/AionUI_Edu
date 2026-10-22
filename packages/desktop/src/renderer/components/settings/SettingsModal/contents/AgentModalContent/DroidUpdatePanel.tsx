import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Message, Space, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate as refresh } from 'swr';
import { specialistApi } from '@/renderer/services/runtime/specialists';
import SettingsSection from './SettingsSection';

export default function DroidUpdatePanel(): React.ReactElement {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { data, error, mutate } = useSWR('edu.factory.version', specialistApi.version, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: (status) =>
      ['checking', 'downloading', 'verifying'].includes(status?.installation.phase ?? '') ? 1000 : 0,
  });
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data?.installedVersion && previous.current !== data.installedVersion) {
      if (previous.current) {
        void refresh('edu.factory.models');
        void refresh('edu.factory.account');
      }
      previous.current = data.installedVersion;
    }
  }, [data?.installedVersion]);
  const phase = data?.installation.phase;
  const installing = ['checking', 'downloading', 'verifying'].includes(phase ?? '');
  const action = async (install: boolean): Promise<void> => {
    if (busy || installing) return;
    setBusy(true);
    try {
      await mutate(await (install ? specialistApi.installUpdate() : specialistApi.checkUpdate()), false);
    } catch {
      Message.error(t('codex.catalog.updateFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      id='droid-updates-title'
      title={t('codex.catalog.updateTitle')}
      description={t('codex.catalog.updateHint')}
    >
      {(error || phase === 'failed') && (
        <Alert type='error' content={t('codex.catalog.updateFailed')} className='mb-12px' />
      )}
      {phase === 'succeeded' && <Alert type='success' content={t('codex.catalog.updateSuccess')} className='mb-12px' />}
      {installing && (
        <Alert
          type='info'
          content={t(
            phase === 'checking'
              ? 'codex.updates.checking'
              : phase === 'downloading'
                ? 'codex.catalog.updateDownloading'
                : 'codex.updates.verifying'
          )}
          className='mb-12px'
        />
      )}
      <Descriptions
        column={1}
        data={[
          { label: t('codex.updates.installed'), value: data?.installedVersion ?? t('codex.specialists.unavailable') },
          { label: t('codex.updates.latest'), value: data?.latestVersion ?? t('codex.updates.notChecked') },
        ]}
      />
      <Space wrap>
        <Button loading={busy} disabled={installing} onClick={() => void action(false)}>
          {t('codex.updates.check')}
        </Button>
        <Button
          type='primary'
          loading={installing}
          disabled={busy || !data?.canInstall || !data.updateAvailable}
          onClick={() => void action(true)}
        >
          {t('codex.catalog.updateInstall')}
        </Button>
      </Space>
      {data?.canInstall === false && (
        <Typography.Paragraph className='!mt-12px !mb-0' type='secondary'>
          {t('codex.catalog.updateUnsupported')}
        </Typography.Paragraph>
      )}
    </SettingsSection>
  );
}
