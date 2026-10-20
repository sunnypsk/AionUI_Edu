import type { IPlatformServices } from './IPlatformServices';

let _services: IPlatformServices | null = null;

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.AIONUI_MULTI_INSTANCE === '1';
  return isMultiInstance ? 'AionUi-Dev-2' : 'AionUi-Dev';
}

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

/** Return the explicitly registered services; browser/server code never loads Electron. */
export function getPlatformServices(): IPlatformServices {
  if (!_services) {
    throw new Error('[Platform] Services not registered. Call registerPlatformServices() before using platform APIs.');
  }
  return _services;
}

export type {
  IPlatformServices,
  IPlatformPaths,
  IWorkerProcess,
  IWorkerProcessFactory,
  IPowerManager,
  INotificationService,
  INetworkService,
} from './IPlatformServices';
