/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Form, Input, Message, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { CodexSettings } from '@/common/config/configKeys';
import {
  CODEX_REASONING_EFFORTS,
  configService,
  isCodexModelId,
  readCodexSettings,
} from '@/common/config/configService';
import LocalAgents from '@/renderer/pages/settings/AgentSettings/LocalAgents';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../../settingsViewContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import CodexAccountPanel from './CodexAccountPanel';
import CodexUpdatePanel from './CodexUpdatePanel';
import NetworkProxyPanel from './NetworkProxyPanel';
import SettingsSection from './SettingsSection';

const AgentModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { t } = useTranslation();
  const [settings, setSettings] = useState(readCodexSettings);
  const [saving, setSaving] = useState(false);
  const [invalidModel, setInvalidModel] = useState(false);

  const saveSettings = async () => {
    if (saving) return;
    const model = settings.model.trim();
    if (!isCodexModelId(model)) {
      setInvalidModel(true);
      return;
    }
    setSaving(true);
    try {
      const next = { ...settings, model };
      await configService.setConfirmed('codex.settings', next);
      setSettings(next);
      Message.success(t('common.saveSuccess'));
    } catch {
      Message.error(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='flex flex-col h-full w-full'>
      <AionScrollArea className='flex-1 min-h-0 pb-16px scrollbar-hide' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {!isElectronDesktop() && <CodexAccountPanel />}
          {!isElectronDesktop() && <CodexUpdatePanel />}
          <SettingsSection
            id='codex-settings-title'
            title={t('codex.settings.title')}
            description={t('codex.settings.description')}
          >
            <Form layout='vertical' onSubmit={() => void saveSettings()}>
              <Form.Item
                label={t('codex.settings.model')}
                validateStatus={invalidModel ? 'error' : undefined}
                help={invalidModel ? t('codex.settings.invalidModel') : undefined}
              >
                <Input
                  aria-label={t('codex.settings.model')}
                  value={settings.model}
                  disabled={saving}
                  onChange={(model) => {
                    setInvalidModel(false);
                    setSettings((previous) => ({ ...previous, model }));
                  }}
                />
              </Form.Item>
              <Form.Item label={t('codex.settings.reasoning')}>
                <Select
                  aria-label={t('codex.settings.reasoning')}
                  value={settings.reasoningEffort}
                  disabled={saving}
                  onChange={(reasoningEffort: CodexSettings['reasoningEffort']) =>
                    setSettings((previous) => ({ ...previous, reasoningEffort }))
                  }
                  options={CODEX_REASONING_EFFORTS.map((value) => ({
                    value,
                    label: t(`codex.settings.efforts.${value}`),
                  }))}
                />
              </Form.Item>
              <div className='flex justify-end'>
                <Button type='primary' htmlType='submit' loading={saving}>
                  {t('common.save')}
                </Button>
              </div>
            </Form>
          </SettingsSection>
          {!isElectronDesktop() && <NetworkProxyPanel />}
          <LocalAgents codexOnly />
        </div>
      </AionScrollArea>
    </div>
  );
};

export default AgentModalContent;
