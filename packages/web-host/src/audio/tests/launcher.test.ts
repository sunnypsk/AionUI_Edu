import { describe, expect, it } from 'vitest';
import { audioCodexLaunch } from '../launcher.js';
import { browserCodexLaunch, browserCodexSpawn } from '../../runtime/browser/launcher.js';
import { specialistCodexLaunch } from '../../runtime/droid/launcher.js';

describe('audio MCP launcher coexistence', () => {
  it('injects all three scoped servers without changing user configuration or leaking signing keys', () => {
    const env = {
      AIONUI_BROWSER_SIGNING_KEY: 'browser-key',
      AIONUI_BROWSER_GATEWAY: 'http://localhost/browser',
      AIONUI_SPECIALISTS_SIGNING_KEY: 'specialist-key',
      AIONUI_SPECIALISTS_GATEWAY: 'http://localhost/specialist',
      AIONUI_AUDIO_SIGNING_KEY: 'audio-key',
      AIONUI_AUDIO_GATEWAY: 'http://localhost/audio',
      AIONUI_USER_ID: 'alice',
      AIONUI_CONVERSATION_ID: 'lesson',
      AIONUI_RUNTIME_TOKEN: 'token',
    };
    const browser = browserCodexLaunch(['app-server'], env);
    const specialists = specialistCodexLaunch(browser.args, browser.env);
    const audio = audioCodexLaunch(specialists.args, specialists.env);
    const child = browserCodexSpawn('codex', { ...browser, ...specialists, ...audio });
    expect(Object.keys(JSON.parse(child.args[1]))).toEqual(['aionui_browser', 'aionui_specialists', 'aionui_audio']);
    expect(Object.keys(audio.env).filter((key) => key.endsWith('_SIGNING_KEY'))).toEqual([]);
    expect(audio.audio?.env_vars).toEqual(['AIONUI_AUDIO_GATEWAY', 'AIONUI_AUDIO_CAPABILITY', 'AIONUI_RUNTIME_TOKEN']);
  });
  it('leaves non-app-server CLI commands alone while removing the host signing key', () => {
    const launch = audioCodexLaunch(['--version'], { AIONUI_AUDIO_SIGNING_KEY: 'fixture' });
    expect(launch.args).toEqual(['--version']);
    expect(launch.env.AIONUI_AUDIO_SIGNING_KEY).toBeUndefined();
    expect(launch.audio).toBeUndefined();
  });
});
