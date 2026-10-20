/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Divider, Typography } from '@arco-design/web-react';
import { Github, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import { openExternalUrl } from '@/renderer/utils/platform';

// __APP_VERSION__ is injected by the renderer Vite config `define:` from the
// repo-root package.json. The previous `import packageJson from
// '../../../../../../package.json'` resolved to packages/desktop/package.json
// which is a workspace placeholder permanently pinned at "0.0.0".
declare const __APP_VERSION__: string;

type LinkItem = { title: string; url: string; icon: React.ReactNode };

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const openLink = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.log('Failed to open link:', error);
    }
  };

  const linkItems: LinkItem[] = [
    {
      title: t('settings.helpDocumentation'),
      url: 'https://github.com/iOfficeAI/AionUi/wiki',
      icon: <Right theme='outline' size='16' className='rtl-mirror' />,
    },
    {
      title: t('settings.updateLog'),
      url: 'https://github.com/iOfficeAI/AionUi/releases',
      icon: <Right theme='outline' size='16' className='rtl-mirror' />,
    },
    {
      title: t('settings.contactMe'),
      url: 'https://x.com/WailiVery',
      icon: <Right theme='outline' size='16' className='rtl-mirror' />,
    },
    {
      title: t('settings.officialWebsite'),
      url: 'https://www.aionui.com',
      icon: <Right theme='outline' size='16' className='rtl-mirror' />,
    },
  ];

  return (
    <div className='flex flex-col h-full w-full'>
      {/* Content Area */}
      <div
        className={classNames(
          'flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px',
          isPageMode && 'px-0 overflow-visible'
        )}
      >
        <div className='flex flex-col max-w-500px mx-auto'>
          {/* App Info Section */}
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='text-24px font-bold text-t-primary mb-8px'>
              AionUi
            </Typography.Title>
            <Typography.Text className='text-14px text-t-secondary mb-12px text-center'>
              {t('settings.appDescription')}
            </Typography.Text>
            <div className='flex items-center justify-center gap-8px mb-16px'>
              <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>
                v{__APP_VERSION__}
              </span>
              <div
                className='text-t-primary cursor-pointer hover:text-t-secondary transition-colors p-4px'
                onClick={() =>
                  openLink('https://github.com/iOfficeAI/AionUi').catch((error) =>
                    console.error('Failed to open link:', error)
                  )
                }
              >
                <Github theme='outline' size='20' />
              </div>
            </div>
          </div>

          {/* Divider */}
          <Divider className='my-16px' />

          {/* Links Section */}
          <div className='flex flex-col gap-4px pt-8px'>
            {linkItems.map((item, index) => (
              <div
                key={index}
                className='flex items-center justify-between px-16px py-12px rd-8px hover:bg-fill-2 transition-all cursor-pointer group'
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openLink(item.url).catch((error) => console.error('Failed to open link:', error));
                }}
              >
                <Typography.Text className='text-14px text-t-primary'>{item.title}</Typography.Text>
                <div className='text-t-secondary group-hover:text-t-primary transition-colors'>{item.icon}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
