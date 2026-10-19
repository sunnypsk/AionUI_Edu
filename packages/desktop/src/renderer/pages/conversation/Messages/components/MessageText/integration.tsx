import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { flushOpenUiDrafts, hasOpenUiDrafts } from './OpenUI/useSavedState';

/** Lightweight WebUI integration entry; it does not load conversation rendering. */
const LazyOpenUISettings = lazy(() => import('./OpenUI/Settings'));
export const OpenUISettings = () => (
  <Suspense fallback={null}>
    <LazyOpenUISettings />
  </Suspense>
);
export { isCompatible as isOpenUiCompatible, openUiCapabilities as getOpenUiCapabilities } from './OpenUI/api';

/** Wait for saves before replacing the visible conversation; failed drafts remain recoverable. */
export function useOpenUiNavigationReady(scope?: string): boolean {
  const { user } = useAuth();
  const { t } = useTranslation();
  const key = user?.id + ':' + scope;
  const [ready, setReady] = useState<string>();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (user) await flushOpenUiDrafts(user.id);
      } catch {
        if (active) Message.warning(t('messages.openui.save'));
      } finally {
        if (active) setReady(key);
      }
    })();
    return () => {
      active = false;
    };
  }, [key, user, t]);
  return ready === key || !hasOpenUiDrafts(user?.id);
}
