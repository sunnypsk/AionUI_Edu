import useSWR from 'swr';
import { useEffect } from 'react';
import { ipcBridge } from '@/common';
import type { SpecialistTask } from '@/common/types/platform/specialists';
import { specialistApi } from '@/renderer/services/runtime/specialists';

const hasActiveRun = (tasks?: SpecialistTask[]): boolean =>
  tasks?.some((task) => ['initializing', 'running'].includes(task.runs.at(-1)?.status ?? '')) ?? false;

/** Keep background tasks responsive while backing off polling for idle conversations. */
export function useSpecialists(conversationId: string, enabled = true) {
  const { data, error, mutate } = useSWR(
    enabled ? ['edu.specialists', conversationId] : null,
    () => specialistApi.list(conversationId),
    {
      refreshInterval: (tasks) => (hasActiveRun(tasks) ? 2000 : 30000),
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    }
  );
  useEffect(() => {
    if (!enabled || !conversationId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      // Many tool frames can describe one task. Bound event-driven reads to one
      // per two seconds, and cancel the pending read when switching conversations.
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void mutate().catch(() => {});
      }, 2000);
    };
    const offStream = ipcBridge.conversation.responseStream.on((event) => {
      if (
        event.conversation_id === conversationId &&
        ['start', 'tool_call', 'tool_group', 'acp_tool_call', 'finish', 'error'].includes(event.type)
      )
        refresh();
    });
    const offReconnect = ipcBridge.realtime.reconnected.on(refresh);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      offStream();
      offReconnect();
    };
  }, [conversationId, enabled, mutate]);
  return {
    tasks: data ?? [],
    error,
    running: hasActiveRun(data),
    cancel: async (taskId?: string): Promise<void> => {
      await mutate(await specialistApi.cancel(conversationId, taskId), false);
    },
  };
}
