import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Spin } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { createParser, Renderer, type ActionEvent, type OpenUIError } from '@openuidev/react-lang';
import {
  defaultDarkTheme,
  defaultLightTheme,
  openuiLibrary,
  openuiChatLibrary,
  ThemeProvider,
  type Theme,
} from '@openuidev/react-ui';
import '@openuidev/react-ui/styles/index.css';
import { uuid } from '@/common/utils';
import MarkdownView from '@/renderer/components/Markdown';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { emitter } from '@/renderer/utils/emitter';
import { openExternalUrl } from '@/renderer/utils/platform';
import { parseHttpUrl } from '@/renderer/utils/url';
import { callTool, isCompatible, listTools, openUiCapabilities, resolveMessageId, statePath } from './api';
import { splitOpenUiContent } from './content';
import { useSavedState } from './useSavedState';
import type { OpenUiBlock } from './types';
import styles from './OpenUI.module.css';
import { withWebUiAdapters } from './runtimeLibrary';
import FieldScope from './FieldScope';

const fullLibrary = withWebUiAdapters(openuiLibrary);
const chatLibrary = withWebUiAdapters(openuiChatLibrary);

const tint = (token: string, percent: number, base = 'transparent') =>
  `color-mix(in srgb, var(--${token}) ${percent}%, ${base})`;

/** Status colors darkened (light) or lightened (dark) toward the text color so they stay readable as text. */
const statusTokens = (token: string, name: 'Success' | 'Alert' | 'Danger' | 'Info') => ({
  [`text${name}Primary`]: tint(token, 70, 'var(--text-primary)'),
  [`${name.toLowerCase()}Background`]: tint(token, 12),
  [`border${name}`]: tint(token, 20),
  [`border${name}Emphasis`]: `var(--${token})`,
});

/** Mode-independent mapping of OpenUI tokens onto the app's semantic tokens. */
const sharedTheme: Theme = {
  textNeutralPrimary: 'var(--text-primary)',
  textNeutralSecondary: 'var(--text-secondary)',
  textNeutralTertiary: 'var(--bg-6)',
  textNeutralLink: 'var(--primary)',
  textBrand: 'var(--primary)',
  textAccentPrimary: 'var(--text-white)',
  ...statusTokens('success', 'Success'),
  ...statusTokens('warning', 'Alert'),
  ...statusTokens('danger', 'Danger'),
  ...statusTokens('info', 'Info'),
  interactiveAccentDefault: 'var(--primary)',
  interactiveAccentHover: tint('primary', 80),
  interactiveAccentPressed: 'var(--primary)',
  interactiveAccentDisabled: tint('primary', 40),
  interactiveDestructiveAccentDefault: 'var(--danger)',
  interactiveDestructiveAccentHover: tint('danger', 80),
  interactiveDestructiveAccentPressed: 'var(--danger)',
  interactiveDestructiveAccentDisabled: tint('danger', 40),
  borderDefault: 'var(--border-base)',
  borderInteractiveSelected: 'var(--primary)',
  borderAccent: tint('primary', 20),
  borderAccentEmphasis: 'var(--primary)',
};

const LIBRARY_FONTS = [
  ['"Inter", sans-serif', 'var(--font-sans)'],
  ['"SFMono-Regular", Menlo, monospace', 'var(--font-mono)'],
] as const;

/**
 * OpenUI bakes its font stacks into the family tokens and every composite `font` shorthand
 * (e.g. `textBodySm`), so swap the family inside each default while keeping its size and weight.
 */
const appFonts = (defaults: Theme): Theme =>
  Object.fromEntries(
    Object.entries(defaults).flatMap(([key, value]) => {
      if (typeof value !== 'string') return [];
      const next = LIBRARY_FONTS.reduce((font, [from, to]) => font.replaceAll(from, to), value);
      return next === value ? [] : [[key, next]];
    })
  );

// The app's bg scale runs lightest-first in light mode and darkest-first in dark mode,
// so cards (foreground) need a different step per mode to stand out from the page.
export const OPENUI_LIGHT_THEME: Theme = {
  ...appFonts(defaultLightTheme),
  ...sharedTheme,
  background: 'var(--bg-1)',
  foreground: 'var(--bg-base)',
  popoverBackground: 'var(--bg-base)',
};
export const OPENUI_DARK_THEME: Theme = {
  ...appFonts(defaultDarkTheme),
  ...sharedTheme,
  background: 'var(--bg-base)',
  foreground: 'var(--bg-1)',
  popoverBackground: 'var(--bg-2)',
};

type BlockProps = {
  block: OpenUiBlock;
  conversation: string;
  message: string;
  sourceMessage?: string;
  streaming: boolean;
};

function InterfaceBlock({ block, conversation, message, sourceMessage, streaming }: BlockProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const preview = useOptionalPreviewContext();
  const [errors, setErrors] = useState<OpenUIError[]>([]);
  const [actionFailed, setActionFailed] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  );
  const operation = useRef<{ id: string; ordinal: number } | null>(null);
  const mutationPending = useRef(false);
  const actionPending = useRef(false);
  const controller = useMemo(() => new AbortController(), [conversation, message, block.id]);
  useEffect(() => () => controller.abort(), [controller]);
  useEffect(() => {
    const sync = () => setMode(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
    return () => observer.disconnect();
  }, []);
  const { data: capability, error: capabilityError } = useSWR(
    user ? ['openui/capabilities', user.id] : null,
    openUiCapabilities
  );
  const compatible = isCompatible(capability);
  const complete = !streaming && block.closed;
  const {
    data: persistedMessage,
    error: messageError,
    mutate: retryMessage,
  } = useSWR(
    compatible && !streaming ? ['openui/message', user?.id, conversation, message, sourceMessage] : null,
    () => resolveMessageId(conversation, message, sourceMessage),
    { errorRetryCount: 3, errorRetryInterval: 500 }
  );
  const {
    data: tools,
    error: toolsError,
    mutate: retryTools,
  } = useSWR(compatible && complete && persistedMessage ? ['openui/tools', user?.id, conversation] : null, () =>
    listTools(conversation)
  );
  const state = useSavedState(
    compatible && complete && persistedMessage ? statePath(conversation, persistedMessage, block.id) : null,
    block.content,
    user?.id
  );
  // The pinned runtime emits form-store changes while hydrating an existing instance.
  // A fresh store prevents stale reactive values from being saved over a remote snapshot.
  const restoration = useMemo(() => ({ initial: state.restored, key: uuid() }), [state.restored]);
  const library = block.profile === 'openui-chat' ? chatLibrary : fullLibrary;
  const parsed = useMemo(() => {
    try {
      return createParser(library.toJSONSchema(), library.root).parse(block.content);
    } catch {
      return null;
    }
  }, [library, block.content]);
  const unsafeQuery = useMemo(() => {
    if (!tools || !parsed) return false;
    return parsed.queryStatements.some(
      ({ toolAST }) => toolAST?.k !== 'Str' || !tools.some((tool) => tool.key === toolAST.v && tool.read_only)
    );
  }, [parsed, tools]);
  const validProgram =
    parsed !== null &&
    !parsed.meta.incomplete &&
    parsed.meta.errors.length === 0 &&
    parsed.meta.unresolved.length === 0 &&
    Boolean(parsed.root);
  const ready =
    compatible &&
    complete &&
    validProgram &&
    Boolean(persistedMessage) &&
    Boolean(state.saved) &&
    Boolean(tools) &&
    !state.error &&
    !messageError &&
    !toolsError &&
    !unsafeQuery;
  const toolContext = useRef({ ready, tools, saved: state.saved, message: persistedMessage });
  toolContext.current = { ready, tools, saved: state.saved, message: persistedMessage };
  const toolProvider = useMemo(
    () => ({
      async callTool(request: { name: string; arguments?: Record<string, unknown> }) {
        const current = toolContext.current;
        if (!current.ready || !current.saved || !current.message || controller.signal.aborted)
          throw new Error('OPENUI_NOT_READY');
        const tool = current.tools?.find((item) => item.key === request.name);
        if (!tool) throw new Error('OPENUI_TOOL_NOT_FOUND');
        const action = operation.current;
        if (!tool.read_only && !action) throw new Error('OPENUI_USER_ACTION_REQUIRED');
        if (!tool.read_only && mutationPending.current) throw new Error('OPENUI_OPERATION_IN_PROGRESS');
        const operationId = tool.read_only ? uuid() : action!.id + ':' + ++action!.ordinal;
        if (!tool.read_only) mutationPending.current = true;
        try {
          await state.flush();
          return await callTool(
            conversation,
            {
              tool_key: tool.key,
              mode: tool.read_only ? 'query' : 'mutation',
              arguments: request.arguments ?? {},
              message_id: current.message,
              block_id: block.id,
              program_hash: current.saved.program_hash,
              operation_id: operationId,
            },
            controller.signal
          );
        } finally {
          if (!tool.read_only) mutationPending.current = false;
        }
      },
    }),
    [conversation, message, block.id, controller, state.flush]
  );
  const onAction = useCallback(
    (event: ActionEvent) => {
      if (!ready || !persistedMessage || actionPending.current) return;
      actionPending.current = true;
      const formState = structuredClone({ ...state.current(), ...event.formState });
      setActionFailed(false);
      void (async () => {
        await state.flush();
        if (event.type === 'open_url') {
          const url = typeof event.params.url === 'string' ? parseHttpUrl(event.params.url) : null;
          if (!url) throw new Error('INVALID_OPENUI_URL');
          if (preview) preview.openBrowserTab(url);
          else await openExternalUrl(url);
        } else if (event.type === 'continue_conversation') {
          await new Promise<void>((resolve, reject) => {
            const delivered = emitter.emit('openui.followUp', {
              conversation_id: conversation,
              input: event.humanFriendlyMessage || t('messages.openui.followUp'),
              ui_action: {
                message_id: persistedMessage,
                block_id: block.id,
                form_state: formState,
                form_name: event.formName,
                context: event.params.context,
              },
              resolve,
              reject,
            });
            if (!delivered) reject(new Error('OPENUI_CONVERSATION_UNAVAILABLE'));
          });
        } else throw new Error('OPENUI_ACTION_NOT_REGISTERED');
      })()
        .catch(() => setActionFailed(true))
        .finally(() => {
          actionPending.current = false;
        });
    },
    [ready, state.flush, state.current, conversation, persistedMessage, block.id, preview, t]
  );
  const requestRepair = () => {
    if (!compatible || streaming || !persistedMessage || actionPending.current) return;
    actionPending.current = true;
    setActionFailed(false);
    void new Promise<void>((resolve, reject) => {
      const delivered = emitter.emit('openui.followUp', {
        conversation_id: conversation,
        input: t('messages.openui.repairRequest'),
        ui_action: {
          message_id: persistedMessage,
          block_id: block.id,
          form_state: state.current(),
          context: { kind: 'repair_openui', profile: block.profile, program: block.content },
        },
        resolve,
        reject,
      });
      if (!delivered) reject(new Error('OPENUI_CONVERSATION_UNAVAILABLE'));
    })
      .catch(() => setActionFailed(true))
      .finally(() => {
        actionPending.current = false;
      });
  };
  const invalid = !streaming && (!block.closed || !validProgram || errors.length > 0);
  const canRepair = Boolean(invalid && compatible && persistedMessage);
  const showUnavailable = Boolean(capabilityError || (capability && !compatible));
  const status = messageError
    ? 'load'
    : showUnavailable
      ? 'unavailable'
      : unsafeQuery
        ? 'unsafeQuery'
        : toolsError
          ? 'toolsFailed'
          : state.error
            ? state.error
            : actionFailed
              ? 'submitFailed'
              : null;
  return (
    <div
      className={styles.root}
      data-openui-block={block.id}
      onClickCapture={() => {
        operation.current = { id: uuid(), ordinal: 0 };
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' || event.key === ' ') operation.current = { id: uuid(), ordinal: 0 };
      }}
    >
      {status && <Alert type='warning' content={t(('messages.openui.' + status) as 'messages.openui.unavailable')} />}
      {!capability && !capabilityError && <Spin />}
      {compatible && (
        <ThemeProvider
          mode={mode}
          lightTheme={OPENUI_LIGHT_THEME}
          darkTheme={OPENUI_DARK_THEME}
          cssSelector='[data-openui-block]'
        >
          <FieldScope disabled={!ready}>
            <Renderer
              key={restoration.key}
              library={library}
              response={block.content}
              isStreaming={!ready}
              initialState={restoration.initial}
              onStateUpdate={ready ? state.update : undefined}
              onAction={onAction}
              toolProvider={ready ? toolProvider : null}
              onError={(next) =>
                setErrors((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
              }
              queryLoader={<Spin />}
            />
          </FieldScope>
        </ThemeProvider>
      )}
      {invalid && <Alert type='warning' content={t('messages.openui.invalid')} />}
      {(canRepair || toolsError || messageError || state.error) && (
        <div className={styles.controls} data-openui-controls>
          {canRepair && (
            <Button size='mini' onClick={requestRepair}>
              {t('messages.openui.repair')}
            </Button>
          )}
          {toolsError && (
            <Button
              size='mini'
              onClick={() => {
                void retryTools();
              }}
            >
              {t('common.retry')}
            </Button>
          )}
          {messageError && (
            <Button
              size='mini'
              onClick={() => {
                void retryMessage();
              }}
            >
              {t('common.retry')}
            </Button>
          )}
          {state.error && (
            <Button size='mini' onClick={state.reload}>
              {t(state.error === 'conflict' ? 'messages.openui.reapply' : 'common.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Render each official library profile separately, outside Markdown's Shadow DOM. */
export default function OpenUIMessage({
  content,
  conversation,
  message,
  sourceMessage,
  streaming,
  onLocalFileLink,
}: {
  content: string;
  conversation: string;
  message: string;
  sourceMessage?: string;
  streaming: boolean;
  onLocalFileLink?: React.ComponentProps<typeof MarkdownView>['onLocalFileLink'];
}) {
  const { user } = useAuth();
  const segments = useMemo(() => splitOpenUiContent(content, streaming), [content, streaming]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'markdown' ? (
          <MarkdownView key={'markdown-' + index} onLocalFileLink={onLocalFileLink}>
            {segment.content}
          </MarkdownView>
        ) : (
          <InterfaceBlock
            key={'openui-' + user?.id + '-' + segment.id}
            block={segment}
            conversation={conversation}
            message={message}
            sourceMessage={sourceMessage}
            streaming={streaming}
          />
        )
      )}
    </>
  );
}
