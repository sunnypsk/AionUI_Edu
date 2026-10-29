import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@arco-design/web-react';
import { Headset } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

type SiderStudioEntryProps = {
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  onClick: () => void;
};

/** Sidebar link to the audio studio project library. */
const SiderStudioEntry: React.FC<SiderStudioEntryProps> = ({
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  onClick,
}) => {
  const { t } = useTranslation();
  const label = t('messages.studio.nav');

  if (collapsed) {
    return (
      <Tooltip {...siderTooltipProps} content={label} position='right'>
        <div
          role='link'
          aria-label={label}
          className={classNames(
            'w-full h-34px flex items-center justify-center cursor-pointer transition-colors rd-8px text-t-primary',
            isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
          )}
          onClick={onClick}
        >
          <Headset theme='outline' size='18' fill='currentColor' className='block leading-none shrink-0' />
        </div>
      </Tooltip>
    );
  }

  return (
    <div
      role='link'
      className={classNames(
        'box-border h-34px w-full flex items-center justify-start gap-8px ps-10px pe-8px rd-0.5rem cursor-pointer shrink-0 transition-all text-t-primary',
        isMobile && 'sider-action-btn-mobile',
        isActive ? 'bg-fill-3' : 'hover:bg-fill-3 active:bg-fill-4'
      )}
      onClick={onClick}
    >
      <span className='size-22px flex items-center justify-center shrink-0 text-t-primary'>
        <Headset theme='outline' size='16' fill='currentColor' className='block leading-none' />
      </span>
      <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
    </div>
  );
};

export default SiderStudioEntry;
