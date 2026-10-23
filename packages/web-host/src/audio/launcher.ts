import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signBrowserCapability } from '../runtime/browser/types.js';
import type { BrowserMcpConfig } from '../runtime/browser/launcher.js';

/** Inject only the conversation's audio capability; host provider keys never enter MCP configuration. */
export function audioCodexLaunch(
  args: string[],
  env: NodeJS.ProcessEnv
): { args: string[]; env: NodeJS.ProcessEnv; audio?: BrowserMcpConfig } {
  const { AIONUI_AUDIO_SIGNING_KEY: key, ...childEnv } = env;
  if (
    !args.includes('app-server') ||
    !key ||
    !env.AIONUI_AUDIO_GATEWAY ||
    !env.AIONUI_USER_ID ||
    !env.AIONUI_CONVERSATION_ID ||
    !env.AIONUI_RUNTIME_TOKEN
  )
    return { args, env: childEnv };
  childEnv.AIONUI_AUDIO_CAPABILITY = signBrowserCapability(key, env.AIONUI_USER_ID, env.AIONUI_CONVERSATION_ID);
  const config: BrowserMcpConfig = {
    command: 'node',
    args: [
      '--experimental-strip-types',
      env.AIONUI_CODEX_RUNTIME_DIR
        ? path.resolve(env.AIONUI_CODEX_RUNTIME_DIR, '../../audio/mcp.ts')
        : fileURLToPath(new URL('./mcp.ts', import.meta.url)),
    ],
    env_vars: ['AIONUI_AUDIO_GATEWAY', 'AIONUI_AUDIO_CAPABILITY', 'AIONUI_RUNTIME_TOKEN'],
    startup_timeout_sec: 15,
    tool_timeout_sec: 65,
  };
  return {
    args: [
      ...Object.entries(config).flatMap(([name, value]) => [
        '-c',
        `mcp_servers.aionui_audio.${name}=${JSON.stringify(value)}`,
      ]),
      ...args,
    ],
    env: childEnv,
    audio: config,
  };
}
