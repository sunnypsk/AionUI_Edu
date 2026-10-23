import { ipcBridge } from '@/common';
import type {
  EnsureConversationRuntimeResponse,
  GetConversationRuntimeResponse,
} from '@/common/types/platform/acpTypes';

const ensureRuntimeByConversation = new Map<string, Promise<EnsureConversationRuntimeResponse>>();
type RuntimeRead = { promise: Promise<GetConversationRuntimeResponse>; superseded: boolean };
const runtimeReads = new Map<string, RuntimeRead>();

/** Read existing runtime state without creating or waking an agent. */
export function getConversationRuntimeSnapshot(conversation_id: string): Promise<GetConversationRuntimeResponse> {
  const ensuring = ensureRuntimeByConversation.get(conversation_id);
  if (ensuring) return ensuring.then(({ config_options, runtime }) => ({ config_options, runtime }));
  const existing = runtimeReads.get(conversation_id);
  if (existing) return existing.promise;
  let entry: RuntimeRead;
  const promise = ipcBridge.conversation.getRuntime
    .invoke({ conversation_id })
    .then((snapshot) => (entry.superseded ? getConversationRuntimeSnapshot(conversation_id) : snapshot))
    .finally(() => {
      if (runtimeReads.get(conversation_id) === entry) runtimeReads.delete(conversation_id);
    });
  entry = { promise, superseded: false };
  runtimeReads.set(conversation_id, entry);
  return promise;
}

export function ensureConversationRuntime(conversation_id: string): Promise<EnsureConversationRuntimeResponse> {
  const existing = ensureRuntimeByConversation.get(conversation_id);
  if (existing) {
    return existing;
  }

  const read = runtimeReads.get(conversation_id);
  if (read) {
    read.superseded = true;
    runtimeReads.delete(conversation_id);
  }

  const promise = ipcBridge.conversation.ensureRuntime.invoke({ conversation_id }).finally(() => {
    ensureRuntimeByConversation.delete(conversation_id);
  });
  ensureRuntimeByConversation.set(conversation_id, promise);
  return promise;
}

export function resetEnsureConversationRuntimeStateForTests(): void {
  ensureRuntimeByConversation.clear();
  runtimeReads.clear();
}
