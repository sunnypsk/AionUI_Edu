import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { signBrowserCapability } from './types.js';

export type BrowserMcpConfig = {
  command: string;
  args: string[];
  env_vars: string[];
  startup_timeout_sec: number;
  tool_timeout_sec: number;
};

/** Add a per-process MCP configuration without editing the user's Codex config or putting credentials in argv. */
export function browserCodexLaunch(
  args: string[],
  env: NodeJS.ProcessEnv
): { args: string[]; env: NodeJS.ProcessEnv; browser?: BrowserMcpConfig } {
  const { AIONUI_BROWSER_SIGNING_KEY: key, ...childEnv } = env;
  if (
    !args.includes('app-server') ||
    !key ||
    !env.AIONUI_BROWSER_GATEWAY ||
    !env.AIONUI_USER_ID ||
    !env.AIONUI_CONVERSATION_ID ||
    !env.AIONUI_RUNTIME_TOKEN
  )
    return { args, env: childEnv };
  childEnv.AIONUI_BROWSER_CAPABILITY = signBrowserCapability(key, env.AIONUI_USER_ID, env.AIONUI_CONVERSATION_ID);
  const config = {
    command: 'node',
    args: [
      '--experimental-strip-types',
      env.AIONUI_CODEX_RUNTIME_DIR
        ? path.resolve(env.AIONUI_CODEX_RUNTIME_DIR, '../browser/mcp.ts')
        : fileURLToPath(new URL('./mcp.ts', import.meta.url)),
    ],
    env_vars: ['AIONUI_BROWSER_GATEWAY', 'AIONUI_BROWSER_CAPABILITY', 'AIONUI_RUNTIME_TOKEN'],
    startup_timeout_sec: 10,
    tool_timeout_sec: 20,
  };
  const overrides = Object.entries(config).flatMap(([name, value]) => [
    '-c',
    `mcp_servers.aionui_browser.${name}=${JSON.stringify(value)}`,
  ]);
  return { args: [...overrides, ...args], env: childEnv, browser: config };
}

/** Use a Node-owned pipe only for scoped app-server processes; other CLI commands retain their original stdio. */
export function browserCodexSpawn(
  command: string,
  launch: ReturnType<typeof browserCodexLaunch>
): { command: string; args: string[] } {
  if (!launch.browser) return { command, args: launch.args };
  return {
    command: 'node',
    args: [
      launch.env.AIONUI_CODEX_RUNTIME_DIR
        ? path.join(launch.env.AIONUI_CODEX_RUNTIME_DIR, 'retention/stdioProxy.mjs')
        : fileURLToPath(new URL('../codex/retention/stdioProxy.mjs', import.meta.url)),
      JSON.stringify(launch.browser),
      command,
      ...launch.args,
    ],
  };
}
