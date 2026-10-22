import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signBrowserCapability } from '../browser/types.js';
import type { BrowserMcpConfig } from '../browser/launcher.js';

/** Add the host-owned specialist bridge only to an authenticated conversation's app-server. */
export function specialistCodexLaunch(
  args: string[],
  env: NodeJS.ProcessEnv
): { args: string[]; env: NodeJS.ProcessEnv; specialists?: BrowserMcpConfig } {
  const { AIONUI_SPECIALISTS_SIGNING_KEY: key, ...childEnv } = env;
  if (
    !args.includes('app-server') ||
    !key ||
    !env.AIONUI_SPECIALISTS_GATEWAY ||
    !env.AIONUI_USER_ID ||
    !env.AIONUI_CONVERSATION_ID ||
    !env.AIONUI_RUNTIME_TOKEN
  )
    return { args, env: childEnv };
  childEnv.AIONUI_SPECIALISTS_CAPABILITY = signBrowserCapability(key, env.AIONUI_USER_ID, env.AIONUI_CONVERSATION_ID);
  const config: BrowserMcpConfig = {
    command: 'node',
    args: [
      '--experimental-strip-types',
      env.AIONUI_CODEX_RUNTIME_DIR
        ? path.resolve(env.AIONUI_CODEX_RUNTIME_DIR, '../droid/mcp.ts')
        : fileURLToPath(new URL('./mcp.ts', import.meta.url)),
    ],
    env_vars: ['AIONUI_SPECIALISTS_GATEWAY', 'AIONUI_SPECIALISTS_CAPABILITY', 'AIONUI_RUNTIME_TOKEN'],
    startup_timeout_sec: 15,
    tool_timeout_sec: 65,
  };
  const overrides = Object.entries(config).flatMap(([name, value]) => [
    '-c',
    `mcp_servers.aionui_specialists.${name}=${JSON.stringify(value)}`,
  ]);
  return { args: [...overrides, ...args], env: childEnv, specialists: config };
}
