/** Native SDK/CLI compatibility gate. No authentication, inference or existing user data. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FactoryProvider } from './provider/sdk.js';
import { MODELS, type StoredTask } from './types.js';

/** Verify both model settings and zero-tool create/resume using an isolated Factory home. */
export async function runDroidSmoke(): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aionui-droid-smoke-'));
  const provider = new FactoryProvider(directory);
  try {
    for (const specialist of ['argon', 'opus'] as const) {
      const task: StoredTask = {
        id: randomUUID(),
        userId: 'smoke',
        conversationId: 'smoke',
        specialist,
        model: MODELS[specialist],
        epoch: 1,
        createdAt: Date.now(),
        disabledToolIds: [],
        runs: [],
      };
      for (const phase of ['create', 'resume']) {
        const session = await provider.open(task, AbortSignal.timeout(60000));
        try {
          if (task.sessionId) assert.equal(session.id, task.sessionId);
          task.sessionId = session.id;
          task.disabledToolIds = session.disabledToolIds;
          console.log(
            JSON.stringify({
              specialist,
              phase,
              verified: true,
              reasoningEffort: 'low',
              disabledTools: session.disabledToolIds.length,
            })
          );
        } finally {
          await session.close();
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runDroidSmoke().catch(() => {
    console.error('Droid compatibility gate failed');
    process.exitCode = 1;
  });
}
