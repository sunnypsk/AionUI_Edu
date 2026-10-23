import { httpRequest } from '@/common/adapter/httpBridge';
import type { AudioModelCatalog, AudioSettings, AudioSettingsInput } from '@/common/types/platform/audioTools';

/** Keep API keys out of request debug logs. CSRF is resolved by the bridge on each write. */
export const audioToolsApi = {
  settings: (): Promise<AudioSettings> => httpRequest('GET', '/api/edu/audio/settings', undefined, { sensitive: true }),
  save: (value: AudioSettingsInput): Promise<AudioSettings> =>
    httpRequest('POST', '/api/edu/audio/settings', value, { sensitive: true }),
  models: (refresh = false): Promise<AudioModelCatalog> =>
    httpRequest('GET', `/api/edu/audio/models${refresh ? '?refresh=1' : ''}`, undefined, { sensitive: true }),
};
