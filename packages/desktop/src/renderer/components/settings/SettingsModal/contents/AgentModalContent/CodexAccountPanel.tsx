import { ipcBridge } from '@/common';
import type { CodexAccountStatus } from '@/common/types/platform/webRuntime';
import { Alert, Button, Link, Message, Space, Typography } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate as swrMutate } from 'swr';
import SettingsSection from './SettingsSection';

const CodexAccountPanel: React.FC = () => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(
    'edu.codex.account',
    () => ipcBridge.webRuntime.codexAccount.invoke(),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: (status) =>
        status?.login.state === 'pending' || (status?.login.state === 'succeeded' && !status.authenticated) ? 2000 : 0,
      onSuccess: (status) => {
        if (status.login.state === 'succeeded') void swrMutate('assistants.list');
      },
    }
  );
  const runAction = async (action: () => Promise<CodexAccountStatus>) => {
    if (busy) return;
    setBusy(true);
    try {
      await mutate(await action(), false);
    } catch {
      Message.error(t('codex.account.actionFailed'));
    } finally {
      setBusy(false);
    }
  };
  const pending = data?.login.state === 'pending';
  return (
    <SettingsSection
      id='codex-account-title'
      title={t('codex.account.title')}
      description={t('codex.account.description')}
    >
      {error && <Alert type='error' content={t('codex.account.unavailable')} className='mb-12px' />}
      {data && (
        <Typography.Paragraph>
          {data.authenticated ? t('codex.account.signedIn') : t('codex.account.signedOut')}
          {data.email ? ` · ${data.email}` : ''}
        </Typography.Paragraph>
      )}
      {pending && data.login.verificationUrl && data.login.userCode && (
        <div className='mb-16px rounded-12px bg-2 p-16px'>
          <Typography.Paragraph>{t('codex.account.enterCode')}</Typography.Paragraph>
          <Typography.Paragraph copyable className='!text-24px !font-semibold'>
            {data.login.userCode}
          </Typography.Paragraph>
          <Link href={data.login.verificationUrl} target='_blank' rel='noopener noreferrer'>
            {t('codex.account.openLogin')}
          </Link>
        </div>
      )}
      {data && ['failed', 'expired'].includes(data.login.state) && (
        <Alert type='warning' content={t('codex.account.loginFailed')} className='mb-12px' />
      )}
      <Space wrap>
        {pending ? (
          <Button
            type='secondary'
            disabled={busy}
            onClick={() => void runAction(() => ipcBridge.webRuntime.codexCancelLogin.invoke({}))}
          >
            {t('common.cancel')}
          </Button>
        ) : data?.authenticated ? (
          <Button
            type='secondary'
            status='danger'
            disabled={busy}
            onClick={() => void runAction(() => ipcBridge.webRuntime.codexLogout.invoke({}))}
          >
            {t('codex.account.signOut')}
          </Button>
        ) : (
          <Button
            type='primary'
            disabled={isLoading || Boolean(error)}
            loading={busy}
            onClick={() => void runAction(() => ipcBridge.webRuntime.codexLogin.invoke({}))}
          >
            {t('codex.account.signIn')}
          </Button>
        )}
        <Button
          type='secondary'
          disabled={busy || isLoading}
          onClick={() => {
            void mutate().catch(() => Message.error(t('codex.account.actionFailed')));
          }}
        >
          {t('codex.account.refresh')}
        </Button>
      </Space>
    </SettingsSection>
  );
};

export default CodexAccountPanel;
