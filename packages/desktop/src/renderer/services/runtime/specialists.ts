import { httpRequest } from '@/common/adapter/httpBridge';
import type {
  FactoryAccount,
  SpecialistPage,
  SpecialistTask,
  SpecialistSettings,
  DroidUpdateStatus,
} from '@/common/types/platform/specialists';
import type { CliModelCatalog } from '@/common/types/platform/cliModels';

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
  models: (refresh = false): Promise<CliModelCatalog> => request(`factory/models${refresh ? '?refresh=1' : ''}`),
  settings: (): Promise<SpecialistSettings> => request('factory/settings'),
  saveSettings: (settings: SpecialistSettings): Promise<SpecialistSettings> => request('factory/settings', settings),
  version: (): Promise<DroidUpdateStatus> => request('factory/version'),
  checkUpdate: (): Promise<DroidUpdateStatus> => request('factory/check-update', {}),
  installUpdate: (): Promise<DroidUpdateStatus> => request('factory/install-update', {}),
  list: (id: string): Promise<SpecialistTask[]> => request(taskRoute(id)),
  page: (id: string, taskId: string, runId: string, offset = 0): Promise<SpecialistPage> =>
    request(
      `${taskRoute(id)}&task_id=${encodeURIComponent(taskId)}&run_id=${encodeURIComponent(runId)}&offset=${offset}`
    ),
  cancel: (id: string, taskId?: string): Promise<SpecialistTask[]> =>
    request(`specialists/cancel?conversation_id=${encodeURIComponent(id)}`, taskId ? { task_id: taskId } : {}),
};

export const codexModels = (refresh = false): Promise<CliModelCatalog> =>
  request(`codex/models${refresh ? '?refresh=1' : ''}`);
