import { useEffect, useRef } from 'react';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { browserApi } from './api';

/** Reveal the shared browser when an agent first opens a page, without repeatedly reopening a collapsed panel. */
export function useBrowserActivity(
  id: string | undefined,
  ready: boolean,
  openBrowserTab?: (url?: string) => void
): void {
  const openRef = useRef(openBrowserTab);
  openRef.current = openBrowserTab;
  useEffect(() => {
    if (isElectronDesktop() || !id || !ready || !openRef.current) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let refreshPending = false;
    const seen = new Set<string>();
    const poll = async (): Promise<void> => {
      clearTimeout(timer);
      timer = undefined;
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const state = await browserApi.state(id);
        if (stopped || document.hidden || refreshPending) return;
        const fresh = state.tabs.some((tab) => !seen.has(tab.id));
        state.tabs.forEach((tab) => seen.add(tab.id));
        if (fresh) openRef.current?.();
      } catch {
        /* The next poll retries after a transient server or session failure. */
      } finally {
        inFlight = false;
        const delay = refreshPending ? 0 : 2000;
        refreshPending = false;
        if (!stopped && !document.hidden) timer = setTimeout(() => void poll(), delay);
      }
    };
    const onVisibilityChange = (): void => {
      clearTimeout(timer);
      timer = undefined;
      refreshPending = !document.hidden && inFlight;
      if (!document.hidden && !inFlight) void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [id, ready]);
}
