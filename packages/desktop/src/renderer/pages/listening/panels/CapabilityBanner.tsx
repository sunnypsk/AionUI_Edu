import React, { useState } from 'react';
import { Alert, Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { AudioCapabilities } from '@/common/types/platform/audioTools';
import { errorKey } from '@/renderer/pages/listening/data/status';
import styles from '@/renderer/pages/listening/ListeningPage.module.css';

/**
 * Explain which audio tools are ready. A missing transcription key is informational: teachers can
 * still keep the original audio, replace ranges by hand and make the MP3 without it.
 */
export function CapabilityBanner({
  capabilities,
  onOpenSettings,
}: {
  capabilities?: AudioCapabilities;
  onOpenSettings: () => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  if (!capabilities) return null;
  const { tools, transcription, tts, render } = capabilities;
  const problems = [
    !tools.available && ['tools', tools.reason],
    !tts.available && ['tts', tts.reason],
    !render.available && ['render', render.reason],
  ].filter((item): item is [string, string | undefined] => !!item);
  if (!problems.length && transcription.available && transcription.hasKey) return null;
  return (
    <div className={styles.banners}>
      <Button size='mini' type='text' onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        {t(collapsed ? 'messages.listening.capability.show' : 'messages.listening.capability.hide')}
      </Button>
      {!collapsed && (
        <>
          {problems.map(([area, reason]) => (
            <Alert
              key={area}
              type='warning'
              title={t(`messages.listening.capability.${area}`)}
              content={t(errorKey(reason ?? 'AUDIO_UNAVAILABLE'))}
            />
          ))}
          {!transcription.hasKey ? (
            <Alert
              type='info'
              content={t('messages.listening.capability.noKey')}
              action={
                <Button size='mini' onClick={onOpenSettings}>
                  {t('messages.listening.capability.openSettings')}
                </Button>
              }
            />
          ) : (
            !transcription.available && (
              <Alert
                type='info'
                content={`${t('messages.listening.capability.transcriptionUnavailable')} ${t(errorKey(transcription.reason))}`}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
