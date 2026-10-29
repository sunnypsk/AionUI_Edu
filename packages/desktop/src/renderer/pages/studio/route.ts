/** Hash-router path of the audio studio project library. */
export const STUDIO_PATH = '/audio';

/** The project file inside every studio project folder, mirrored from the web host. */
export const STUDIO_PROJECT_FILE = 'project.listening.json';

/** Navigation state that opens the new-chat page with a studio project attached as the workspace. */
export type StudioChatState = { studioProject: { id: string; title: string } };

const STUDIO_WORKSPACE =
  /[\\/]audio-projects[\\/][^\\/]+[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]?$/i;
/** Studio project id when a conversation workspace is a studio project folder. */
export const studioProjectIdOf = (workspace?: string): string | undefined =>
  workspace ? STUDIO_WORKSPACE.exec(workspace)?.[1] : undefined;

/** Hash-router path of the full-screen editor for one studio project. */
export const studioProjectPath = (projectId: string): string => `${STUDIO_PATH}/${encodeURIComponent(projectId)}`;
