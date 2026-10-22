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
  createdAt: number;
  runs: SpecialistRun[];
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
