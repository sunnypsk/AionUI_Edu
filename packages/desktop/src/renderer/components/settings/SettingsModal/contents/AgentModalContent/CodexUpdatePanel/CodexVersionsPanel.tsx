import { ipcBridge } from '@/common';
import type { CodexInstalledVersion } from '@/common/types/platform/webRuntime';
import { Alert, Button, Checkbox, Space, Table, Tag, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const STATUS_KEYS = {
  selected: 'codex.versions.selected',
  latest: 'codex.versions.latest',
  previous: 'codex.versions.previous',
  inUse: 'codex.versions.inUse',
  unverified: 'codex.versions.unverified',
  bundled: 'codex.versions.bundled',
} as const;

type Props = { installedVersion?: string; installing: boolean; onBusyChange: (busy: boolean) => void };

const CodexVersionsPanel: React.FC<Props> = ({ installedVersion, installing, onBusyChange }) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [cleaning, setCleaning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [outcome, setOutcome] = useState<{ count: number; retained: boolean } | null>(null);
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    'edu.codex.versions',
    () => ipcBridge.webRuntime.codexVersions.invoke(),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const disabled = installing || cleaning || isLoading || isValidating || !!data?.busy || !data?.inspectionComplete;

  useEffect(() => {
    if (!installing) void mutate();
  }, [installedVersion, installing, mutate]);
  useEffect(() => {
    setSelected((previous) =>
      previous.filter((id) => data?.versions.some((entry) => entry.id === id && entry.removable))
    );
  }, [data]);

  const cleanup = async () => {
    if (disabled || !selected.length) return;
    setCleaning(true);
    onBusyChange(true);
    setFailed(false);
    setOutcome(null);
    try {
      const result = await ipcBridge.webRuntime.codexCleanupVersions.invoke({ ids: selected });
      await mutate(result.inventory, false);
      setSelected([]);
      setOutcome({ count: result.removed.length, retained: result.retained.length > 0 });
    } catch {
      setFailed(true);
      await mutate().catch(() => {});
    } finally {
      setCleaning(false);
      onBusyChange(false);
    }
  };

  if (data?.supported === false) return null;
  return (
    <section className='mt-24px' aria-labelledby='codex-versions-title'>
      <Typography.Title heading={6} id='codex-versions-title'>
        {t('codex.versions.title')}
      </Typography.Title>
      <Typography.Paragraph type='secondary'>{t('codex.versions.policy')}</Typography.Paragraph>
      {(error || failed) && <Alert type='error' className='mb-12px' content={t('codex.versions.failed')} />}
      {data && !data.inspectionComplete && (
        <Alert type='warning' className='mb-12px' content={t('codex.versions.inspectionFailed')} />
      )}
      {outcome && (
        <Alert
          className='mb-12px'
          type={outcome.retained ? 'warning' : 'success'}
          content={
            outcome.retained ? t('codex.versions.retained') : t('codex.versions.cleaned', { count: outcome.count })
          }
        />
      )}
      <Table<CodexInstalledVersion>
        rowKey='id'
        size='small'
        pagination={false}
        loading={isLoading}
        data={data?.versions ?? []}
        noDataElement={t('codex.versions.empty')}
        columns={[
          {
            width: 48,
            title: '',
            render: (_value: unknown, entry) => (
              <Checkbox
                aria-label={t('codex.versions.selectVersion', {
                  version: entry.version ?? t('codex.versions.unknownVersion'),
                })}
                checked={selected.includes(entry.id)}
                disabled={disabled || !entry.removable}
                onChange={(checked) =>
                  setSelected((previous) =>
                    checked ? [...previous, entry.id] : previous.filter((id) => id !== entry.id)
                  )
                }
              />
            ),
          },
          {
            title: t('codex.versions.version'),
            render: (_value: unknown, entry) => entry.version ?? t('codex.versions.unknownVersion'),
          },
          {
            title: t('codex.versions.status'),
            render: (_value: unknown, entry) => (
              <Tag>{entry.protection ? t(STATUS_KEYS[entry.protection]) : t('codex.versions.available')}</Tag>
            ),
          },
        ]}
      />
      <Space wrap className='mt-12px'>
        <Button loading={isValidating} disabled={installing || cleaning} onClick={() => void mutate().catch(() => {})}>
          {t('codex.versions.refresh')}
        </Button>
        <Button
          status='danger'
          loading={cleaning}
          disabled={disabled || !selected.length}
          onClick={() => void cleanup()}
        >
          {t('codex.versions.cleanup')}
        </Button>
      </Space>
    </section>
  );
};

export default CodexVersionsPanel;
