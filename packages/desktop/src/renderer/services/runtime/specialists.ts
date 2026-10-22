import { httpRequest } from '@/common/adapter/httpBridge';
import type { FactoryAccount, SpecialistPage, SpecialistTask } from '@/common/types/platform/specialists';

const request = <T>(route: string, input?: unknown): Promise<T> =>
  httpRequest<T>(input === undefined ? 'GET' : 'POST', `/api/edu/${route}`, input, { sensitive: true });
const taskRoute = (conversationId: string): string =>
  `specialists/tasks?conversation_id=${encodeURIComponent(conversationId)}`;

/** Account links and drafts bypass debug request logging. */
export const specialistApi = {
  account: (): Promise<FactoryAccount> => request('factory/account'),
  login: (): Promise<FactoryAccount> => request('factory/login', {}),
  cancelLogin: (): Promise<FactoryAccount> => request('factory/login/cancel', {}),
  logout: (): Promise<FactoryAccount> => request('factory/logout', {}),
  list: (id: string): Promise<SpecialistTask[]> => request(taskRoute(id)),
  page: (id: string, taskId: string, runId: string, offset = 0): Promise<SpecialistPage> =>
    request(
      `${taskRoute(id)}&task_id=${encodeURIComponent(taskId)}&run_id=${encodeURIComponent(runId)}&offset=${offset}`
    ),
  cancel: (id: string, taskId?: string): Promise<SpecialistTask[]> =>
    request(`specialists/cancel?conversation_id=${encodeURIComponent(id)}`, taskId ? { task_id: taskId } : {}),
};
