import { z } from 'zod';
import type { Specialist, SpecialistTask } from '../../../../desktop/src/common/types/platform/specialists.js';

export type {
  FactoryAccount,
  Specialist,
  SpecialistTask,
  SpecialistRun,
  SpecialistPage,
} from '../../../../desktop/src/common/types/platform/specialists.js';
export type Owner = { userId: string; conversationId: string; workspace: string };
export const MODELS: Record<Specialist, string> = { argon: 'gemini-4-argon', opus: 'claude-opus-5-5' };
export const DROID_VERSION = '0.245.1';
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const prompt = z.string().trim().min(1).max(200_000);
const files = z.array(z.string().min(1).max(4096)).max(32).optional();
export const toolSchemas = {
  specialist_start: z
    .object({
      specialist: z
        .enum(['argon', 'opus'])
        .describe(
          'argon: writer for student-, parent- or colleague-facing text. opus: teaching designer for lesson and curriculum plans.'
        ),
      prompt,
      files,
    })
    .strict(),
  specialist_reply: z.object({ task_id: z.string().uuid(), prompt, files }).strict(),
  specialist_wait: z
    .object({ task_ids: z.array(z.string().uuid()).min(1).max(32), wait_sec: z.number().min(0).max(50).default(50) })
    .strict(),
  specialist_get: z
    .object({
      task_id: z.string().uuid().optional(),
      run_id: z.string().uuid().optional(),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  specialist_cancel: z.object({ task_id: z.string().uuid() }).strict(),
};
export type ToolName = keyof typeof toolSchemas;
export type StoredTask = SpecialistTask & {
  userId: string;
  conversationId: string;
  epoch: number;
  sessionId?: string;
  disabledToolIds: string[];
};
export type Gate = { epoch: number; open: boolean; threadId?: string; eventId?: string; turns: Record<string, number> };
export type State = { version: 1; tasks: StoredTask[]; gates: Record<string, Gate> };
export const active = (task: SpecialistTask): boolean =>
  ['initializing', 'running'].includes(task.runs.at(-1)?.status ?? '');

/** Never expose provider diagnostics, prompts, credentials or local paths as errors. */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/^(SPECIALIST_[A-Z_]+|FACTORY_[A-Z_]+|UNAUTHORIZED|INVALID_REQUEST)$/.test(message)) return message;
  if (/auth|unauthori[sz]ed|sign.?in|api.?key|401/i.test(message)) return 'SPECIALIST_AUTH_REQUIRED';
  return 'SPECIALIST_UNAVAILABLE';
}
