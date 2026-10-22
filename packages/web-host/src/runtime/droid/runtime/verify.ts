import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FactoryProvider } from '../provider/sdk.js';
import type { StoredTask } from '../types.js';
import type { SpecialistSettings } from '../../../../../desktop/src/common/types/platform/specialists.js';

/** Exercise create/resume/settings/isolation without credentials, prompts or inference. */
export async function verifyDroidCandidate(
  command: string,
  settings: SpecialistSettings,
  signal: AbortSignal
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aionui-droid-verify-'));
  const provider = new FactoryProvider(directory, command);
  try {
    for (const specialist of ['argon', 'opus'] as const) {
      const task: StoredTask = {
        id: randomUUID(),
        userId: 'verify',
        conversationId: 'verify',
        specialist,
        ...settings[specialist],
        epoch: 1,
        createdAt: Date.now(),
        disabledToolIds: [],
        runs: [],
      };
      for (const phase of ['create', 'resume']) {
        const session = await provider.open(task, AbortSignal.any([signal, AbortSignal.timeout(60000)]));
        try {
          if (phase === 'resume' && session.id !== task.sessionId) throw new Error('SPECIALIST_SESSION_UNAVAILABLE');
          task.sessionId = session.id;
          task.disabledToolIds = session.disabledToolIds;
        } finally {
          await session.close();
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
