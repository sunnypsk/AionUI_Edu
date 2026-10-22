import { Alert, Button, Link, Message, Space, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { FactoryAccount } from '@/common/types/platform/specialists';
import { specialistApi } from '@/renderer/services/runtime/specialists';
import SettingsSection from './SettingsSection';

const FactoryAccountPanel: React.FC = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useSWR('edu.factory.account', specialistApi.account, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    refreshInterval: (value) => (value && ['starting', 'pending'].includes(value.login.state) ? 2000 : 0),
  });
  const pending = data && ['starting', 'pending'].includes(data.login.state);
  const action = async (run: () => Promise<FactoryAccount>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await mutate(await run(), false);
    } catch {
      Message.error(t('codex.specialists.actionFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      id='factory-account-title'
      title={t('codex.specialists.accountTitle')}
      description={t('codex.specialists.accountDescription')}
    >
      {(error || (data && !data.available)) && (
        <Alert type='warning' content={t('codex.specialists.unavailable')} className='mb-12px' />
      )}
      {data && (
        <Typography.Paragraph>
          {data.authenticated ? t('codex.specialists.signedIn') : t('codex.specialists.signedOut')}
          {data.version ? ` · ${data.version}` : ''}
        </Typography.Paragraph>
      )}
      {data && (
        <div className='mb-12px flex flex-col gap-4px'>
          {(['argon', 'opus'] as const).map((name) => (
            <Typography.Text key={name}>
              {t(`codex.specialists.models.${name}`)} ·{' '}
              {data.models[name] ? t('codex.specialists.available') : t('codex.specialists.unavailable')}
            </Typography.Text>
          ))}
        </div>
      )}
      {pending && data.login.url && (
        <div className='mb-12px rounded-12px bg-2 p-12px'>
          <Typography.Paragraph>{t('codex.specialists.loginInstructions')}</Typography.Paragraph>
          <Link href={data.login.url} target='_blank' rel='noopener noreferrer'>
            {t('codex.specialists.openLogin')}
          </Link>
        </div>
      )}
      {data?.login.state === 'failed' && (
        <Alert type='error' content={t('codex.specialists.loginFailed')} className='mb-12px' />
      )}
      <Space wrap>
        {pending ? (
          <Button disabled={busy} onClick={() => void action(specialistApi.cancelLogin)}>
            {t('common.cancel')}
          </Button>
        ) : data?.authenticated ? (
          <Button status='danger' disabled={busy} onClick={() => void action(specialistApi.logout)}>
            {t('codex.specialists.signOut')}
          </Button>
        ) : (
          <Button
            type='primary'
            loading={busy}
            disabled={isLoading || !data?.available}
            onClick={() => void action(specialistApi.login)}
          >
            {t('codex.specialists.signIn')}
          </Button>
        )}
        <Button
          disabled={busy || isLoading}
          onClick={() => void mutate().catch(() => Message.error(t('codex.specialists.actionFailed')))}
        >
          {t('codex.account.refresh')}
        </Button>
      </Space>
    </SettingsSection>
  );
};
export default FactoryAccountPanel;
