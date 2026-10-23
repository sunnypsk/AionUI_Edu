import { readFile } from 'node:fs/promises';

export type CgroupTasks = { current: number; max: number };

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
