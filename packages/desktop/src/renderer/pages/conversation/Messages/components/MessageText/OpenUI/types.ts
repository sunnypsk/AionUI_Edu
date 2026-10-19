export type OpenUiProfile = 'openui' | 'openui-chat';
export type OpenUiBlock = { kind: 'openui'; id: string; profile: OpenUiProfile; content: string; closed: boolean };
export type MessageSegment = OpenUiBlock | { kind: 'markdown'; content: string };
export type OpenUiCapabilities = { protocol: string; hash: string; enabled: boolean };
export type OpenUiSavedState = {
  state: Record<string, unknown>;
  revision: number;
  program_hash: string;
  library_id: OpenUiProfile;
  library_version: string;
};
export type OpenUiTool = {
  key: string;
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  read_only: boolean;
};
