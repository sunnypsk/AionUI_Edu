import { readFile } from 'node:fs/promises';

export type CgroupTasks = { current: number; max: number };
export const DEFAULT_STARTUP_TASK_RESERVE = 256;

/** Keep the reserve bounded; malformed overrides use the measured default. */
export function startupTaskReserve(value?: string): number {
  const parsed = value?.trim() ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 128 && parsed <= 1024 ? parsed : DEFAULT_STARTUP_TASK_RESERVE;
}

/** Best-effort admission only: concurrent launches and tools can still race. */
export function assertStartupHeadroom(tasks: CgroupTasks | undefined, reserve = DEFAULT_STARTUP_TASK_RESERVE): void {
  if (tasks && tasks.max - tasks.current < reserve) {
    throw Object.assign(new Error('CODEX_RESOURCES_UNAVAILABLE'), { code: 'EAGAIN' });
  }
}

/** Read bounded task counts only; unavailable or unlimited cgroups are omitted. */
export async function readCgroupTasks(root = '/sys/fs/cgroup'): Promise<CgroupTasks | undefined> {
  try {
    const [currentText, maxText] = await Promise.all([
      readFile(`${root}/pids.current`, 'utf8'),
      readFile(`${root}/pids.max`, 'utf8'),
    ]);
    if (!currentText.trim() || !maxText.trim()) return undefined;
    const current = Number(currentText.trim());
    const max = Number(maxText.trim());
    if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(max) || max < 1) return undefined;
    return { current, max };
  } catch {
    return undefined;
  }
}
