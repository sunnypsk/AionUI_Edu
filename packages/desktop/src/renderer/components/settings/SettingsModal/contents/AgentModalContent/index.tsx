/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import LocalAgents from '@/renderer/pages/settings/AgentSettings/LocalAgents';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useSettingsViewMode } from '../../settingsViewContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import CodexAccountPanel from './CodexAccountPanel';
import FactoryAccountPanel from './FactoryAccountPanel';
import CodexUpdatePanel from './CodexUpdatePanel';
import NetworkProxyPanel from './NetworkProxyPanel';
import CodexModelSettings from './ModelSettings/CodexModelSettings';
import FactoryModelSettings from './ModelSettings/FactoryModelSettings';
import DroidUpdatePanel from './DroidUpdatePanel';

const AgentModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  return (
    <div className='flex flex-col h-full w-full'>
      <AionScrollArea className='flex-1 min-h-0 pb-16px scrollbar-hide' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {!isElectronDesktop() && <CodexAccountPanel />}
          {!isElectronDesktop() && <FactoryAccountPanel />}
          {!isElectronDesktop() && <CodexUpdatePanel />}
          <CodexModelSettings />
          {!isElectronDesktop() && <DroidUpdatePanel />}
          {!isElectronDesktop() && <FactoryModelSettings />}
          {!isElectronDesktop() && <NetworkProxyPanel />}
          <LocalAgents codexOnly />
        </div>
      </AionScrollArea>
    </div>
  );
};

export default AgentModalContent;
