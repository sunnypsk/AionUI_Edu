// Core types for @aionui/web-host (M3 interface contract, locked for M4-M8)

/**
 * App metadata injected by host environment (Electron or Node)
 */
export type AppMetadata = {
  version: string;
  isPackaged: boolean;
  resourcesPath: string;
  userDataPath: string;
  /** Bundled additions to AionCore's built-in skill corpus. */
  builtinSkillsDir?: string;
};

/**
 * Backend binary resolver function injected by host environment
 */
export type BackendBinaryResolver = () => string;

/**
 * System dirs exported to the backend via AIONUI_{CACHE,WORK,LOG}_DIR env.
 * Backend surfaces these on `/api/system/info`. Omit and the backend inherits
 * process.env, which may carry stale values from the parent shell — better to
 * be explicit.
 */
export type BackendSystemDirs = {
  cacheDir: string;
  workDir: string;
  logDir: string;
};

/**
 * Options for starting WebHost
 */
export type WebHostOptions = {
  app: AppMetadata;
  staticDir: string;
  port?: number;
  allowRemote?: boolean;
  dataDir?: string;
  logDir?: string;
  dirs?: BackendSystemDirs;
  /** Enable authenticated Codex account and container proxy controls for the standalone WebUI. */
  enableRuntimeControls?: boolean;
  backend: { kind: 'ownBackend'; resolveBackend: BackendBinaryResolver } | { kind: 'useExistingBackend'; port: number };
};

/**
 * Handle returned by startWebHost
 */
export type WebHostHandle = {
  port: number;
  backendPort: number;
  url: string;
  localUrl: string;
  networkUrl?: string;
  lanIP?: string;
  stop: () => Promise<void>;
};

/** Web-host controls share the same Codex account and network policy per installation. */
export type CodexAccountStatus = {
  authenticated: boolean;
  email?: string;
  authType?: string;
  login: {
    state: 'idle' | 'starting' | 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
    verificationUrl?: string;
    userCode?: string;
  };
};

export type NetworkProxySettings = { enabled: boolean; proxyUrl?: string };

export type NetworkProxyTestRequest = { proxyUrl?: string };

export type NetworkProxyProbeResult =
  | { state: 'success'; elapsedMs: number }
  | {
      state: 'failed';
      elapsedMs: number;
      reason:
        | 'timeout'
        | 'authentication'
        | 'connection'
        | 'tls'
        | 'invalidResponse'
        | 'unavailable'
        | 'invalidProxy'
        | 'settingsUnavailable';
    }
  | { state: 'skipped'; reason: 'proxyInactive' | 'containerOnly' | 'notConfigured' };

export type NetworkProxyTestResult = {
  current: NetworkProxyProbeResult;
  configured: NetworkProxyProbeResult;
  configuredSource: 'input' | 'saved' | 'environment';
};

export type CodexUpdateStatus = {
  installedVersion: string;
  /** Newest version AionUi has verified; null when the runtime cannot report it. */
  verifiedVersion?: string | null;
  latestVersion: string | null;
  checkedAt: string | null;
  updateAvailable: boolean | null;
  canInstall: boolean;
  installation: CodexInstallStatus;
};

export type CodexInstallStatus = {
  phase: 'idle' | 'checking' | 'downloading' | 'verifying' | 'succeeded' | 'failed';
  targetVersion: string | null;
};

export type CodexInstalledVersion = {
  id: string;
  version: string | null;
  installedAt: string | null;
  protection: 'selected' | 'latest' | 'previous' | 'inUse' | 'unverified' | 'bundled' | null;
  removable: boolean;
};

export type CodexVersionInventory = {
  versions: CodexInstalledVersion[];
  inspectionComplete: boolean;
  supported: boolean;
  busy: boolean;
};

export type CodexCleanupResult = {
  removed: string[];
  retained: string[];
  inventory: CodexVersionInventory;
};

export type NetworkProxyStatus = {
  enabled: boolean;
  endpoint: string;
  hasCredentials: boolean;
  active: boolean;
  pendingRestart: boolean;
  managedByEnvironment: boolean;
  containerSupported: boolean;
};
