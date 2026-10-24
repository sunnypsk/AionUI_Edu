/** Hash-router path of the full-screen listening editor for one project in a conversation workspace. */
export const listeningPagePath = (conversationId: string, projectPath: string): string =>
  `/conversation/${encodeURIComponent(conversationId)}/listening?${new URLSearchParams({ path: projectPath }).toString()}`;
