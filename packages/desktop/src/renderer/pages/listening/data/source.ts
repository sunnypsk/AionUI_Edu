import { joinPath } from '@/common/chat/chatLib';
import { localFileRef } from '@/common/types/chatFile';
import { downloadFileFromRef } from '@/renderer/utils/file/download';
import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';
import type { ListeningTarget } from '@/renderer/pages/listening/data/api';

/**
 * Where the editor's project lives and how to reach its files. A conversation project is served through the
 * conversation workspace; a studio project through the audio host. Callers memoize sources per project.
 */
export type EditorSource = {
  target: ListeningTarget;
  /** Stream URL of a workspace-relative file. */
  fileUrl: (relative: string) => string | undefined;
  download: (relative: string, name: string) => Promise<void>;
  /** Present for conversation projects: agent capability checks and the workspace clip picker use it. */
  conversation?: { id: string; workspace?: string };
  /** Present for studio projects, which hide listening-test-only inserts and add a media panel. */
  studio?: { projectId: string };
};

/** Source for a `*.listening.json` file in a conversation workspace. */
export function conversationSource(conversationId: string, workspace: string | undefined, path: string): EditorSource {
  return {
    target: { conversation_id: conversationId, path },
    fileUrl: (relative) => (workspace ? buildFileStreamUrl(localFileRef(joinPath(workspace, relative))) : undefined),
    download: async (relative, name) => {
      if (!workspace) throw new Error('workspace unavailable');
      await downloadFileFromRef(localFileRef(joinPath(workspace, relative)), name);
    },
    conversation: { id: conversationId, workspace },
  };
}
