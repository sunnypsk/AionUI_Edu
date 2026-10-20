import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Link, Result, Spin, Upload } from '@arco-design/web-react';
import { ArrowLeft, ArrowRight, Close, Plus, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { BrowserAction, BrowserResult } from '@/common/types/platform/webRuntime';
import { useCurrentConversation } from '../../../explorer/currentConversationStore';
import {
  BROWSER_BLANK_URL,
  browserTabAddress,
  browserTabLabelFromUrl,
  isBrowserErrorUrl,
  resolveAddressBarInput,
} from '../constants';
import { browserApi } from './api';
import { useTouchScroll } from './useTouchScroll';
import styles from './WebBrowserViewer.module.css';

/** A viewport of the server's Chromium page. Input and MCP commands reach the same page and control lock. */
const WebBrowserViewer: React.FC<{ visible: boolean }> = ({ visible }) => {
  const id = useCurrentConversation();
  const { t } = useTranslation();
  const [result, setResult] = useState<BrowserResult>();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [dialogText, setDialogText] = useState('');
  const composing = useRef(false);
  const compositionCommit = useRef('');
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  const currentId = useRef(id);
  currentId.current = id;
  const state = result?.state;
  const tab = state?.tabs.find((item) => item.id === state.activeTabId);
  const human = state?.control === 'human' && !state.takingOver;
  const tabAddress = tab ? browserTabAddress(tab) : '';
  const loadFailed = Boolean(tab && isBrowserErrorUrl(tab.url));

  const accept = useCallback((value: BrowserResult): void => {
    setResult((previous) =>
      previous && previous.state.revision > value.state.revision
        ? previous
        : {
            ...value,
            image: value.frameError
              ? undefined
              : (value.image ??
                (previous?.state.activeTabId === value.state.activeTabId &&
                previous?.state.viewport.width === value.state.viewport.width &&
                previous?.state.viewport.height === value.state.viewport.height &&
                previous?.state.tabs.find((item) => item.id === value.state.activeTabId)?.url ===
                  value.state.tabs.find((item) => item.id === value.state.activeTabId)?.url
                  ? previous.image
                  : undefined)),
          }
    );
  }, []);
  useEffect(() => {
    setAddress(tabAddress === BROWSER_BLANK_URL ? '' : tabAddress);
  }, [tabAddress, tab?.id]);
  useEffect(() => {
    generation.current++;
    setResult(undefined);
    setError('');
    queue.current = Promise.resolve();
  }, [id]);
  useEffect(() => {
    if (!id || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      if (!document.hidden) {
        try {
          const value = await browserApi.frame(id);
          if (!stopped) {
            accept(value);
            setError('');
          }
        } catch (failure) {
          if (!stopped) setError(failure instanceof Error ? failure.message : 'BROWSER_UNAVAILABLE');
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, visible, accept]);

  const action = useCallback(
    (value: BrowserAction): Promise<void> => {
      const taskId = id;
      const version = generation.current;
      const pending = queue.current.then(async () => {
        if (!taskId || currentId.current !== taskId || generation.current !== version) return;
        try {
          accept(await browserApi.action(taskId, value));
          setError('');
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'BROWSER_UNAVAILABLE');
        }
      });
      queue.current = pending.catch(() => {});
      return pending;
    },
    [id, accept]
  );

  useEffect(() => {
    if (!human || !tab || !viewport.current || !visible) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(([entry]) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const width = Math.min(1920, Math.max(320, Math.round(entry.contentRect.width) - 16));
        const height = Math.min(1600, Math.max(240, Math.round(entry.contentRect.height) - 16));
        void action({ kind: 'resize', tabId: tab.id, width, height });
      }, 150);
    });
    observer.observe(viewport.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [human, tab?.id, visible, action]);

  const control = async (mode: 'human' | 'agent'): Promise<void> => {
    if (!id || busy) return;
    setBusy(true);
    try {
      if (mode === 'agent') await queue.current;
      const value = await browserApi.control(id, mode);
      accept(value);
      setError('');
      if (!value.state.running && mode === 'human') await action({ kind: 'open' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'BROWSER_UNAVAILABLE');
    } finally {
      setBusy(false);
    }
  };
  const touch = useTouchScroll(tab?.id, Boolean(human), (x, y) => {
    if (tab) void action({ kind: 'scroll', tabId: tab.id, x, y });
  });
  const navigate = (): void => {
    const url = resolveAddressBarInput(address);
    if (url && tab) void action({ kind: 'navigate', tabId: tab.id, url });
  };
  const key = (event: React.KeyboardEvent): void => {
    if (
      !human ||
      !tab ||
      event.nativeEvent.isComposing ||
      composing.current ||
      event.key === 'Process' ||
      event.key === 'Dead'
    )
      return;
    // Printable text and IME go through the textarea's input path; paste retains the browser's native event.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return;
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    event.preventDefault();
    const modifiers = [
      event.ctrlKey || event.metaKey ? 'ControlOrMeta' : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    void action({ kind: 'key', tabId: tab.id, key: [...modifiers, event.key === ' ' ? 'Space' : event.key].join('+') });
  };
  const point = (event: React.MouseEvent<HTMLDivElement>): { x: number; y: number } => {
    const bounds =
      event.currentTarget.querySelector('img')?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(((event.clientX - bounds.left) * (state?.viewport.width ?? 1280)) / bounds.width),
      y: Math.round(((event.clientY - bounds.top) * (state?.viewport.height ?? 800)) / bounds.height),
    };
  };
  const upload = async (file: File): Promise<boolean> => {
    if (!tab || !human || file.size > 30 * 1024 * 1024) {
      setError('BROWSER_FILE_TOO_LARGE');
      return false;
    }
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('error', reject, { once: true });
      reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]), { once: true });
      reader.readAsDataURL(file);
    });
    await action({
      kind: 'upload',
      tabId: tab.id,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: encoded,
    });
    return false;
  };
  const tabLabel = (item: { title: string; url: string; requestedUrl?: string }): string => {
    const shown = browserTabAddress(item);
    // Chrome titles its error page with a host that may not match the requested page.
    if (item.title && !isBrowserErrorUrl(item.url)) return item.title;
    return !shown || shown === BROWSER_BLANK_URL ? t('preview.browser.newTab') : browserTabLabelFromUrl(shown);
  };
  const retry = (): void => {
    if (tab && tabAddress) void action({ kind: 'navigate', tabId: tab.id, url: tabAddress });
  };
  const errorKeys = {
    INVALID_BROWSER_URL: 'invalidUrl',
    BROWSER_FILE_TOO_LARGE: 'fileTooLarge',
    BROWSER_HUMAN_CONTROL: 'controlChanged',
    BROWSER_AGENT_CONTROL: 'controlChanged',
    BROWSER_PROFILE_LOCKED: 'profileLocked',
    BROWSER_RESOURCES_UNAVAILABLE: 'resourcesUnavailable',
    BROWSER_START_FAILED: 'startFailed',
    BROWSER_TIMEOUT: 'timeout',
  } as const;
  const errorKey = errorKeys[error as keyof typeof errorKeys] ?? 'unavailable';

  return (
    <div className={styles.root} ref={root} data-testid='shared-browser'>
      <div className={styles.status}>
        <span>
          {t(
            !state?.running
              ? 'preview.sharedBrowser.ready'
              : state.takingOver
                ? 'preview.sharedBrowser.takingOver'
                : human
                  ? 'preview.sharedBrowser.humanControl'
                  : 'preview.sharedBrowser.agentControl'
          )}
        </span>
        <Button
          size='small'
          type={human && state?.running ? 'secondary' : 'primary'}
          loading={busy}
          disabled={human && state?.running && state?.agentEnabled === false}
          onClick={() => void control(human && state?.running ? 'agent' : 'human')}
        >
          {t(human && state?.running ? 'preview.sharedBrowser.returnToAi' : 'preview.sharedBrowser.takeOver')}
        </Button>
      </div>
      {error && <Alert type='error' content={t(`preview.sharedBrowser.${errorKey}`)} />}
      {!error && result?.frameError && <Alert type='warning' content={t('preview.sharedBrowser.frameUnavailable')} />}
      {state?.running && (
        <>
          <div className={styles.tabs}>
            {state.tabs.map((item) => (
              <div key={item.id} className={`${styles.tab} ${item.id === tab?.id ? styles.active : ''}`}>
                <Button
                  type='text'
                  size='small'
                  disabled={!human}
                  onClick={() => void action({ kind: 'select', tabId: item.id })}
                >
                  {tabLabel(item)}
                </Button>
                <Button
                  type='text'
                  size='mini'
                  aria-label={t('common.close')}
                  disabled={!human}
                  onClick={() => void action({ kind: 'close', tabId: item.id })}
                >
                  <Close size={12} />
                </Button>
              </div>
            ))}
            <Button
              type='text'
              size='small'
              aria-label={t('preview.browser.newTab')}
              disabled={!human || state.tabs.length >= 8}
              onClick={() => void action({ kind: 'open' })}
            >
              <Plus size={16} />
            </Button>
          </div>
          <div className={styles.toolbar}>
            <Button
              type='text'
              size='small'
              aria-label={t('preview.sharedBrowser.back')}
              disabled={!human || !tab}
              onClick={() => tab && void action({ kind: 'back', tabId: tab.id })}
            >
              <ArrowLeft size={16} />
            </Button>
            <Button
              type='text'
              size='small'
              aria-label={t('preview.sharedBrowser.forward')}
              disabled={!human || !tab}
              onClick={() => tab && void action({ kind: 'forward', tabId: tab.id })}
            >
              <ArrowRight size={16} />
            </Button>
            <Button
              type='text'
              size='small'
              aria-label={t('preview.sharedBrowser.reload')}
              disabled={!human || !tab}
              onClick={() => tab && void action({ kind: 'reload', tabId: tab.id })}
            >
              <Refresh size={16} />
            </Button>
            <Input
              className={styles.address}
              value={address}
              aria-label={t('preview.browser.addressPlaceholder')}
              placeholder={t('preview.browser.addressPlaceholder')}
              disabled={!human}
              onChange={setAddress}
              onPressEnter={navigate}
            />
            <Button size='small' disabled={!human} onClick={navigate}>
              {t('preview.sharedBrowser.go')}
            </Button>
          </div>
        </>
      )}
      {tab?.dialog && (
        <div className={styles.dialog}>
          <span>{tab.dialog.message}</span>
          {tab.dialog.type === 'prompt' && <Input value={dialogText} onChange={setDialogText} disabled={!human} />}
          <Button
            disabled={!human}
            onClick={() => void action({ kind: 'dialog', tabId: tab.id, accept: true, text: dialogText })}
          >
            {t('common.confirm')}
          </Button>
          <Button disabled={!human} onClick={() => void action({ kind: 'dialog', tabId: tab.id, accept: false })}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {tab?.fileChooser && (
        <div className={styles.dialog}>
          <Upload showUploadList={false} beforeUpload={upload} disabled={!human}>
            <Button disabled={!human}>{t('preview.sharedBrowser.upload')}</Button>
          </Upload>
        </div>
      )}
      <div className={styles.viewport} ref={viewport}>
        {tab && loadFailed ? (
          <Result
            status='warning'
            title={t('preview.browser.loadFailed')}
            subTitle={t('preview.browser.loadFailedHint')}
            extra={
              <Button type='primary' disabled={!human || !tabAddress} onClick={retry}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : result?.image && tab ? (
          <div
            className={styles.surface}
            ref={surface}
            onPointerDown={(event) => {
              touch.onPointerDown(event);
              if (human && tab && event.pointerType === 'touch')
                void action({ kind: 'move', tabId: tab.id, ...point(event) });
            }}
            onPointerMove={touch.onPointerMove}
            onPointerUp={touch.onPointerUp}
            onPointerCancel={touch.onPointerCancel}
            onClick={(event) => {
              if (touch.consumeClick()) return;
              if (human) {
                void action({ kind: 'click', tabId: tab.id, ...point(event) });
                surface.current?.querySelector('textarea')?.focus({ preventScroll: true });
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (human) void action({ kind: 'click', tabId: tab.id, ...point(event), button: 'right' });
            }}
            onWheel={(event) => {
              if (human) {
                void action({ kind: 'move', tabId: tab.id, ...point(event) });
                void action({
                  kind: 'scroll',
                  tabId: tab.id,
                  x: Math.round(event.deltaX),
                  y: Math.round(event.deltaY),
                });
              }
            }}
          >
            <img
              className={styles.frame}
              src={`data:image/jpeg;base64,${result.image}`}
              alt={t('preview.sharedBrowser.viewport')}
              draggable={false}
            />
            <Input.TextArea
              className={styles.keyboard}
              aria-label={t('preview.sharedBrowser.keyboard')}
              value={input}
              disabled={!human}
              autoComplete='off'
              onKeyDown={key}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={(event) => {
                composing.current = false;
                const text = (event.target as HTMLTextAreaElement).value;
                compositionCommit.current = text;
                if (text) void action({ kind: 'text', tabId: tab.id, text });
                setInput('');
              }}
              onChange={(value) => {
                setInput(value);
                if (!composing.current && value) {
                  if (compositionCommit.current !== value) void action({ kind: 'text', tabId: tab.id, text: value });
                  compositionCommit.current = '';
                  setInput('');
                }
              }}
              onPaste={(event) => {
                event.preventDefault();
                const text = event.clipboardData.getData('text/plain');
                if (text) void action({ kind: 'text', tabId: tab.id, text });
              }}
            />
          </div>
        ) : (
          <div className={styles.notice}>
            {!state || state.running ? <Spin /> : t('preview.sharedBrowser.startHint')}
          </div>
        )}
      </div>
      <div className={styles.notice}>{t('preview.sharedBrowser.scopeHint')}</div>
      {state && state.downloads.length > 0 && (
        <div className={styles.downloads}>
          {state.downloads.map((download) => (
            <div key={download.id}>
              {download.state === 'ready' ? (
                <Link
                  href={`/api/edu/browser/${encodeURIComponent(id!)}/download?id=${encodeURIComponent(download.id)}`}
                  download
                >
                  {download.name}
                </Link>
              ) : (
                <span>
                  {download.name} ·{' '}
                  {t(
                    download.state === 'failed'
                      ? 'preview.sharedBrowser.downloadFailed'
                      : 'preview.sharedBrowser.downloading'
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WebBrowserViewer;
