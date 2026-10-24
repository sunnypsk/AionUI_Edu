import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/adapter/ipcBridge';

const AUDIO = /\.(?:mp3|wav|m4a|aac|ogg|flac|webm)$/i;
const MAX_DEPTH = 3;
const MAX_FILES = 200;

/** Workspace-relative audio files, breadth-first to a few levels; hidden folders (caches) are skipped. */
export async function listAudioFiles(conversationId: string, workspace: string): Promise<string[]> {
  const found: string[] = [];
  let level: string[] = [workspace];
  for (let depth = 0; depth < MAX_DEPTH && level.length && found.length < MAX_FILES; depth++) {
    const next: string[] = [];
    for (const directory of level) {
      const [root] = (await ipcBridge.conversation.getWorkspace.invoke({
        conversation_id: conversationId,
        workspace,
        path: directory,
      })) as IDirOrFile[];
      for (const entry of root?.children ?? []) {
        if (entry.name.startsWith('.')) continue;
        if (entry.isDir) next.push(entry.fullPath);
        else if (AUDIO.test(entry.name)) found.push(entry.relativePath);
      }
    }
    level = next;
  }
  return found.slice(0, MAX_FILES).toSorted();
}
