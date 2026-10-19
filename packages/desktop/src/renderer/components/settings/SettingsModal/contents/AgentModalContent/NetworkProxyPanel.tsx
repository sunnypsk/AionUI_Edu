import { ipcBridge } from '@/common';
import type { NetworkProxyProbeResult, NetworkProxyTestResult } from '@/common/types/platform/webRuntime';
import { Alert, Button, Form, Input, Message, Switch, Typography } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import SettingsSection from './SettingsSection';

const NetworkProxyPanel: React.FC = () => {
  const { t } = useTranslation();
  const { data, error, mutate } = useSWR('edu.networkProxy', () => ipcBridge.webRuntime.networkProxy.invoke(), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [enabled, setEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NetworkProxyTestResult | null>(null);
  const [testFailed, setTestFailed] = useState(false);
  const busyRef = useRef(false);
  const clearTest = () => {
    setTestResult(null);
    setTestFailed(false);
  };
  useEffect(() => {
    if (data) setEnabled(data.enabled);
  }, [data?.enabled]);
  useEffect(clearTest, [data?.enabled, data?.endpoint, data?.active, data?.pendingRestart]);
  const save = async () => {
    if (!data || busyRef.current || data.managedByEnvironment) return;
    busyRef.current = true;
    clearTest();
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
      busyRef.current = false;
      setSaving(false);
    }
  };
  const test = async () => {
    if (!data || busyRef.current) return;
    busyRef.current = true;
    clearTest();
    setTesting(true);
    try {
      setTestResult(
        await ipcBridge.webRuntime.testNetworkProxy.invoke(proxyUrl.trim() ? { proxyUrl: proxyUrl.trim() } : {})
      );
    } catch {
      setTestFailed(true);
    } finally {
      busyRef.current = false;
      setTesting(false);
    }
  };
  const renderTestResult = (result: NetworkProxyProbeResult, label: string) => (
    <Alert
      type={result.state === 'success' ? 'success' : result.state === 'failed' ? 'error' : 'info'}
      title={label}
      content={
        <span>
          {result.state === 'success' ? t('codex.proxy.testSuccess') : t(`codex.proxy.testReasons.${result.reason}`)}
          {result.state !== 'skipped' && ` · ${t('codex.proxy.testDuration', { duration: result.elapsedMs })}`}
        </span>
      }
      className='mt-12px'
    />
  );
  return (
    <SettingsSection id='network-proxy-title' title={t('codex.proxy.title')} description={t('codex.proxy.description')}>
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
            disabled={!data || saving || testing || data.managedByEnvironment}
            onChange={(value) => {
              setEnabled(value);
              clearTest();
            }}
          />
        </Form.Item>
        <Form.Item label={t('codex.proxy.url')} help={t('codex.proxy.urlHint')}>
          <Input.Password
            aria-label={t('codex.proxy.url')}
            value={proxyUrl}
            onChange={(value) => {
              setProxyUrl(value);
              clearTest();
            }}
            disabled={!enabled || saving || testing || !data || data.managedByEnvironment}
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
        <div className='flex flex-col-reverse sm:flex-row sm:justify-end gap-12px'>
          <Button
            type='secondary'
            htmlType='button'
            loading={testing}
            disabled={!data || saving}
            onClick={() => void test()}
          >
            {testing ? t('codex.proxy.testing') : t('codex.proxy.test')}
          </Button>
          <Button
            type='primary'
            htmlType='submit'
            loading={saving}
            disabled={!data || testing || data.managedByEnvironment}
          >
            {t('codex.proxy.save')}
          </Button>
        </div>
      </Form>
      <Typography.Paragraph type='secondary' className='!mt-12px !mb-0'>
        {t('codex.proxy.testHint')}
      </Typography.Paragraph>
      <div aria-live='polite' aria-busy={testing}>
        {testFailed && <Alert type='error' content={t('codex.proxy.testFailed')} className='mt-12px' />}
        {testResult && (
          <>
            {renderTestResult(testResult.current, t('codex.proxy.testCurrent'))}
            {renderTestResult(testResult.configured, t(`codex.proxy.testSources.${testResult.configuredSource}`))}
          </>
        )}
      </div>
    </SettingsSection>
  );
};

export default NetworkProxyPanel;
