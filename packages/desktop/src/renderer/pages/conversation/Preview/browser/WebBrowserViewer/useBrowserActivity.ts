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
    let timer: ReturnType<typeof setTimeout>;
    const seen = new Set<string>();
    const poll = async (): Promise<void> => {
      try {
        const state = await browserApi.state(id);
        if (stopped) return;
        const fresh = state.tabs.some((tab) => !seen.has(tab.id));
        state.tabs.forEach((tab) => seen.add(tab.id));
        if (fresh) openRef.current?.();
      } catch {
        /* The next poll retries after a transient server or session failure. */
      }
      if (!stopped) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, ready]);
}
