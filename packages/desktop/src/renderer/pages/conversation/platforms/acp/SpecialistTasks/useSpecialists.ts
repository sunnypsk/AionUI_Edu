import useSWR from 'swr';
import { specialistApi } from '@/renderer/services/runtime/specialists';

/** Poll independently of the parent turn so background specialists remain visible and stoppable. */
export function useSpecialists(conversationId: string, enabled = true) {
  const { data, error, mutate } = useSWR(
    enabled ? ['edu.specialists', conversationId] : null,
    () => specialistApi.list(conversationId),
    { refreshInterval: 2000, revalidateOnFocus: true, shouldRetryOnError: false }
  );
  return {
    tasks: data ?? [],
    error,
    running: data?.some((task) => ['initializing', 'running'].includes(task.runs.at(-1)?.status ?? '')) ?? false,
    cancel: async (taskId?: string): Promise<void> => {
      await mutate(await specialistApi.cancel(conversationId, taskId), false);
    },
  };
}
