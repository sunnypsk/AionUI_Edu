import { ipcBridge } from '@/common';
import { Alert, Button, Form, Input, Message, Switch, Typography } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const NetworkProxyPanel: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, mutate } = useSWR('edu.networkProxy', () => ipcBridge.webRuntime.networkProxy.invoke(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [enabled, setEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setEnabled(data.enabled);
  }, [data?.enabled]);
  const save = async () => {
    if (!data || saving || data.managedByEnvironment) return;
    setSaving(true);
    try {
      const status = await ipcBridge.webRuntime.saveNetworkProxy.invoke({
        enabled,
        ...(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {}),
      });
      await mutate(status, false);
      setProxyUrl('');
      Message.success(t('codex.proxy.saved'));
    } catch {
      Message.error(t('codex.proxy.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className='mb-24px rounded-16px border border-border-2 bg-1 p-20px' aria-labelledby='network-proxy-title'>
      <Typography.Title id='network-proxy-title' heading={5} className='!mt-0'>
        {t('codex.proxy.title')}
      </Typography.Title>
      <Typography.Paragraph type='secondary'>{t('codex.proxy.description')}</Typography.Paragraph>
      {error && <Alert type='error' content={t('codex.proxy.loadFailed')} className='mb-12px' />}
      {data && (
        <>
          <Typography.Paragraph>
            {data.active ? t('codex.proxy.active') : t('codex.proxy.inactive')}
          </Typography.Paragraph>
          {!data.containerSupported && (
            <Alert type='info' content={t('codex.proxy.containerOnly')} className='mb-12px' />
          )}
          {data.pendingRestart && (
            <Alert type='warning' content={t('codex.proxy.restartRequired')} className='mb-12px' />
          )}
          {data.managedByEnvironment && (
            <Alert type='info' content={t('codex.proxy.environmentManaged')} className='mb-12px' />
          )}
        </>
      )}
      <Form layout='vertical' onSubmit={() => void save()}>
        <Form.Item label={t('codex.proxy.enable')}>
          <Switch
            aria-label={t('codex.proxy.enable')}
            checked={enabled}
            disabled={!data || saving || data.managedByEnvironment}
            onChange={setEnabled}
          />
        </Form.Item>
        <Form.Item label={t('codex.proxy.url')} help={t('codex.proxy.urlHint')}>
          <Input.Password
            aria-label={t('codex.proxy.url')}
            value={proxyUrl}
            onChange={setProxyUrl}
            disabled={!enabled || saving || !data || data.managedByEnvironment}
            placeholder={data?.endpoint || t('codex.proxy.placeholder')}
            autoComplete='new-password'
          />
        </Form.Item>
        {data?.endpoint && (
          <Typography.Paragraph type='secondary'>
            {t('codex.proxy.savedEndpoint', { endpoint: data.endpoint })}
            {data.hasCredentials ? ` · ${t('codex.proxy.credentialsStored')}` : ''}
          </Typography.Paragraph>
        )}
        <Button type='primary' htmlType='submit' loading={saving} disabled={!data || data.managedByEnvironment}>
          {t('codex.proxy.save')}
        </Button>
      </Form>
    </section>
  );
};

export default NetworkProxyPanel;
