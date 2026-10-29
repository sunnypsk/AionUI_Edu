/** Hash-router path of the audio studio project library. */
export const STUDIO_PATH = '/audio';

/** Hash-router path of the full-screen editor for one studio project. */
export const studioProjectPath = (projectId: string): string => `${STUDIO_PATH}/${encodeURIComponent(projectId)}`;
