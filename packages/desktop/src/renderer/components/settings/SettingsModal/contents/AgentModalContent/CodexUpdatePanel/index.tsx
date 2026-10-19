import { ipcBridge } from '@/common';
import { Alert, Button, Descriptions, Space, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { gt, valid } from 'semver';
import useSWR from 'swr';
import CodexVersionsPanel from './CodexVersionsPanel';

const CodexUpdatePanel: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [startingInstall, setStartingInstall] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    'edu.codex.version',
    () => ipcBridge.webRuntime.codexVersion.invoke(),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: (status) =>
        ['checking', 'downloading', 'verifying'].includes(status?.installation?.phase ?? '') ? 1000 : 0,
    }
  );
  const phase = data?.installation?.phase ?? 'idle';
  const installing = startingInstall || ['checking', 'downloading', 'verifying'].includes(phase);
  const install = async () => {
    if (installing) return;
    setStartingInstall(true);
    setInstallFailed(false);
    try {
      await mutate(await ipcBridge.webRuntime.codexInstallUpdate.invoke({}), false);
    } catch {
      setInstallFailed(true);
    } finally {
      setStartingInstall(false);
    }
  };
  const check = async () => {
    if (checking) return;
    setChecking(true);
    setCheckFailed(false);
    try {
      await mutate(await ipcBridge.webRuntime.codexCheckUpdate.invoke({}), false);
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className='mb-24px rounded-16px border border-border-2 bg-1 p-20px' aria-labelledby='codex-updates-title'>
      <Typography.Title id='codex-updates-title' heading={5} className='!mt-0'>
        {t('codex.updates.title')}
      </Typography.Title>
      <Typography.Paragraph type='secondary'>{t('codex.updates.description')}</Typography.Paragraph>
      {(error || checkFailed) && <Alert type='error' content={t('codex.updates.checkFailed')} className='mb-12px' />}
      {(installFailed || phase === 'failed') && (
        <Alert type='error' content={t('codex.updates.installFailed')} className='mb-12px' />
      )}
      {phase === 'succeeded' && (
        <Alert type='success' content={t('codex.updates.installSuccess')} className='mb-12px' />
      )}
      {['checking', 'downloading', 'verifying'].includes(phase) && (
        <Alert
          type='info'
          className='mb-12px'
          content={t(
            phase === 'checking'
              ? 'codex.updates.checking'
              : phase === 'downloading'
                ? 'codex.updates.downloading'
                : 'codex.updates.verifying'
          )}
        />
      )}
      {data && (
        <>
          <Descriptions
            column={1}
            data={[
              { label: t('codex.updates.installed'), value: data.installedVersion },
              { label: t('codex.updates.latest'), value: data.latestVersion ?? t('codex.updates.notChecked') },
              {
                label: t('codex.updates.checkedAt'),
                value: data.checkedAt
                  ? new Date(data.checkedAt).toLocaleString(i18n.language)
                  : t('codex.updates.notChecked'),
              },
            ]}
          />
          {data.verifiedVersion &&
            valid(data.installedVersion) &&
            valid(data.verifiedVersion) &&
            gt(data.installedVersion, data.verifiedVersion) && (
              <Alert type='info' content={t('codex.update.newerThanVerified')} className='mb-12px mt-12px' />
            )}
          {data.updateAvailable !== null && !installing && (
            <Alert
              type={data.updateAvailable ? 'info' : 'success'}
              content={t(data.updateAvailable ? 'codex.updates.available' : 'codex.updates.upToDate')}
              className='mb-12px mt-12px'
            />
          )}
        </>
      )}
      <Space wrap>
        <Button loading={checking} disabled={isLoading || installing || cleaning} onClick={() => void check()}>
          {t('codex.updates.check')}
        </Button>
        <Button
          type='primary'
          loading={installing}
          disabled={checking || cleaning || !data?.canInstall || !data.updateAvailable}
          onClick={() => void install()}
        >
          {t('codex.updates.install')}
        </Button>
      </Space>
      {data?.canInstall === false && (
        <Typography.Paragraph type='secondary' className='!mb-0 !mt-12px'>
          {t('codex.updates.unsupported')}
        </Typography.Paragraph>
      )}
      <Typography.Paragraph type='secondary' className='!mb-0 !mt-12px'>
        {t('codex.updates.installHint')}
      </Typography.Paragraph>
      <CodexVersionsPanel
        installedVersion={data?.installedVersion}
        installing={installing}
        onBusyChange={setCleaning}
      />
    </section>
  );
};

export default CodexUpdatePanel;
