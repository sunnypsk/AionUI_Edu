/** Browser-safe contracts for host-owned Factory specialists. */
export type Specialist = 'argon' | 'opus';
export type SpecialistStatus = 'initializing' | 'running' | 'completed' | 'failed' | 'canceled';
export type SpecialistRun = {
  id: string;
  status: SpecialistStatus;
  text: string;
  createdAt: number;
  finishedAt?: number;
  error?: string;
  usage?: Record<string, number>;
};
export type SpecialistTask = {
  id: string;
  specialist: Specialist;
  model: string;
  reasoningEffort?: string | null;
  createdAt: number;
  runs: SpecialistRun[];
};
export type SpecialistSettings = Record<Specialist, { model: string; reasoningEffort: string | null }>;
export type DroidUpdateStatus = {
  installedVersion: string | null;
  latestVersion: string | null;
  checkedAt: string | null;
  updateAvailable: boolean | null;
  canInstall: boolean;
  installation: {
    phase: 'idle' | 'checking' | 'downloading' | 'verifying' | 'succeeded' | 'failed';
    targetVersion: string | null;
    error?: string;
  };
};
export type SpecialistPage = {
  task: SpecialistTask;
  runId: string;
  text: string;
  nextOffset: number | null;
  totalLength: number;
};
export type FactoryAccount = {
  available: boolean;
  version: string | null;
  authenticated: boolean;
  models: Record<Specialist, boolean>;
  error?: string;
  login: {
    state: 'idle' | 'starting' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
    url?: string;
    expiresAt?: number;
  };
};
