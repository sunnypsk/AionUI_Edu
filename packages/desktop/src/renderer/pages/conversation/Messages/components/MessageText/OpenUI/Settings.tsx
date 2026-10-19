import React from 'react';
import { Message, Switch, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { getClientBusinessSetting, setClientBusinessSetting } from '@/renderer/services/clientBusinessSettings';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { isCompatible, openUiCapabilities } from './api';

/** Control automatic generation; historical interfaces remain readable. */
export default function OpenUISettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const {
    data: capability,
    error: capabilityError,
    isLoading: loadingCapability,
  } = useSWR(user ? ['openui/capabilities', user.id] : null, openUiCapabilities);
  const {
    data: enabled = true,
    mutate,
    isLoading,
  } = useSWR(user ? ['openui/enabled', user.id] : null, () => getClientBusinessSetting('openuiEnabled'));
  const compatible = isCompatible(capability);
  return (
    <div className='flex flex-col items-end gap-8px'>
      <Tooltip content={compatible ? t('settings.openuiDescription') : t('messages.openui.unavailable')}>
        <Switch
          aria-label={t('settings.openuiTitle')}
          checked={enabled}
          loading={isLoading || loadingCapability}
          disabled={!compatible}
          onChange={(value) => {
            void mutate(
              async () => {
                await setClientBusinessSetting('openuiEnabled', value);
                return value;
              },
              { optimisticData: value, rollbackOnError: true }
            ).catch(() => Message.error(t('messages.openui.save')));
          }}
        />
      </Tooltip>
      {(capabilityError || (capability && !compatible)) && (
        <span role='status' className='text-12px text-t-secondary'>
          {t('messages.openui.unavailable')}
        </span>
      )}
    </div>
  );
}
