import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Collapse, Message, Select, Space, Typography } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { SpecialistTask } from '@/common/types/platform/specialists';
import { specialistApi } from '@/renderer/services/runtime/specialists';
import type { useSpecialists } from './useSpecialists';

const Draft: React.FC<{ conversationId: string; task: SpecialistTask; cancel: () => Promise<void> }> = ({
  conversationId,
  task,
  cancel,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>();
  const [text, setText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const run = task.runs.find((value) => value.id === selected) ?? task.runs.at(-1)!;
  useEffect(() => {
    generation.current += 1;
    setText(undefined);
    setBusy(false);
    return () => {
      generation.current += 1;
    };
  }, [run.id, conversationId, task.id]);
  const running = ['initializing', 'running'].includes(task.runs.at(-1)?.status ?? '');
  const read = async (): Promise<void> => {
    const current = ++generation.current;
    setBusy(true);
    try {
      let offset: number | null = 0;
      let draft = '';
      while (offset !== null) {
        const page = await specialistApi.page(conversationId, task.id, run.id, offset);
        if (current !== generation.current) return;
        draft += page.text;
        offset = page.nextOffset;
      }
      if (current === generation.current) setText(draft);
    } catch {
      if (current === generation.current) Message.error(t('codex.specialists.actionFailed'));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  return (
    <div className='flex flex-col gap-8px'>
      <Select
        aria-label={t('codex.specialists.revision')}
        value={run.id}
        onChange={setSelected}
        options={task.runs.map((value, index) => ({
          value: value.id,
          label: `${index + 1} · ${t(`codex.specialists.status.${value.status}`)}`,
        }))}
      />
      {run.error && (
        <Alert
          type='warning'
          content={
            run.error === 'SPECIALIST_AUTH_REQUIRED'
              ? t('codex.specialists.authRequired')
              : t('codex.specialists.taskFailed')
          }
        />
      )}
      <Space wrap>
        <Button size='small' loading={busy} onClick={() => void read()}>
          {t('codex.specialists.readDraft')}
        </Button>
        {running && (
          <Button
            size='small'
            status='danger'
            onClick={() => void cancel().catch(() => Message.error(t('codex.specialists.actionFailed')))}
          >
            {t('common.cancel')}
          </Button>
        )}
      </Space>
      {text !== undefined && (
        <Typography.Paragraph copyable className='whitespace-pre-wrap break-words max-h-400px overflow-auto'>
          {text || t('codex.specialists.noDraft')}
        </Typography.Paragraph>
      )}
    </div>
  );
};

const SpecialistTasks: React.FC<{ conversationId: string; state: ReturnType<typeof useSpecialists> }> = ({
  conversationId,
  state,
}) => {
  const { t } = useTranslation();
  // Collapsed by default so finished specialists do not take reading space above the composer.
  const [expanded, setExpanded] = useState(false);
  if (!state.tasks.length) return null;
  const active = state.tasks.filter((task) =>
    ['initializing', 'running'].includes(task.runs.at(-1)?.status ?? '')
  ).length;
  return (
    <div className='mb-8px max-h-[50vh] shrink-0 overflow-auto rounded-12px bg-1 p-4px'>
      <Button
        type='text'
        size='small'
        long
        aria-expanded={expanded}
        icon={expanded ? <Down /> : <Right />}
        onClick={() => setExpanded((value) => !value)}
        className='!flex !items-center !text-left'
      >
        <Typography.Text bold>{t('codex.specialists.tasksTitle')}</Typography.Text>
        <span className='ml-8px text-12px text-t-secondary'>
          {active
            ? t('codex.specialists.summaryRunning', { running: active, count: state.tasks.length })
            : t('codex.specialists.summaryDone', { count: state.tasks.length })}
        </span>
      </Button>
      {state.error && <Alert type='warning' content={t('codex.specialists.actionFailed')} />}
      {expanded && (
        <Collapse bordered={false}>
          {state.tasks.map((task) => (
            <Collapse.Item
              key={task.id}
              name={task.id}
              header={`${new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${t(`codex.specialists.models.${task.specialist}`)} · ${task.model}${task.reasoningEffort ? ` · ${task.reasoningEffort}` : ''} · ${t(`codex.specialists.status.${task.runs.at(-1)!.status}`)}`}
            >
              <Draft conversationId={conversationId} task={task} cancel={() => state.cancel(task.id)} />
            </Collapse.Item>
          ))}
        </Collapse>
      )}
    </div>
  );
};
export default SpecialistTasks;
