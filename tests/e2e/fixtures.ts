/** Isolated browser fixtures backed by the shipped Bun WebUI launcher. */
import { test as base, expect, type Page } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type WebUiFixture = { url: string; dataDir: string; password: string };

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export const test = base.extend<{ page: Page }, { webui: WebUiFixture }>({
  webui: [
    async ({}, use) => {
      const root = process.cwd();
      const dataDir = mkdtempSync(path.join(os.tmpdir(), 'aionui-webui-e2e-'));
      const cache = process.env.AIONUI_OPENUI_CORE_CACHE || path.join(root, '.cache/openui-core');
      const binary =
        process.env.AIONUI_BACKEND_BIN || path.join(cache, 'bin', `${process.platform}-${process.arch}`, 'aioncore');
      const password = 'Aa1!' + randomBytes(24).toString('base64url');
      const env = {
        ...process.env,
        CODEX_HOME: path.join(dataDir, 'codex'),
        AIONUI_NO_BUILD: '1',
        AIONUI_HOST: '127.0.0.1',
        AIONUI_ALLOW_REMOTE: '0',
        AIONUI_REMOTE: '0',
      };
      try {
        execFileSync(binary, ['--data-dir', dataDir, 'user', 'set-password', '--password-stdin'], {
          input: password + '\n',
          timeout: 60_000,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const child = spawn(
          'bun',
          ['scripts/webui.ts', '--no-build', '--no-open', '--port', '0', '--data-dir', dataDir],
          {
            cwd: root,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        try {
          const url = await new Promise<string>((resolve, reject) => {
            let output = '';
            const timer = setTimeout(() => reject(new Error('Isolated WebUI startup timed out')), 45_000);
            const failed = (code: number | null) => {
              clearTimeout(timer);
              reject(new Error(`Isolated WebUI exited (${code})`));
            };
            child.once('exit', failed);
            child.once('error', (error) => {
              clearTimeout(timer);
              reject(error);
            });
            child.stdout?.on('data', (chunk: Buffer) => {
              output = (output + chunk.toString()).slice(-8192);
              const match = output.match(/Local\s*:\s*(http:\/\/[^\s]+)/);
              if (match) {
                clearTimeout(timer);
                child.off('exit', failed);
                resolve(match[1]);
              }
            });
            child.stderr?.on('data', () => {});
          });
          await use({ url: url.replace(/\/$/, ''), dataDir, password });
        } finally {
          await stopServer(child);
        }
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    { scope: 'worker', timeout: 60_000 },
  ],
  page: async ({ page, webui }, use) => {
    const context = page.context();
    await context.request.get(webui.url + '/api/auth/status');
    const login = await context.request.post(webui.url + '/login', {
      data: { username: 'admin', password: webui.password },
    });
    expect(login.status()).toBe(200);
    await page.addInitScript(
      (port) => {
        (window as Window & { __backendPort?: number }).__backendPort = port;
        window.__aionuiE2ETest = true;
      },
      Number(new URL(webui.url).port)
    );
    await page.goto(webui.url);
    await expect(page.locator('#root')).not.toBeEmpty();
    await use(page);
  },
});

/** Complete the real server-side picker instead of mocking a native dialog. */
export async function chooseServerPathWhenPrompted(page: Page, target: string): Promise<void> {
  await page.addLocatorHandler(
    page.getByPlaceholder('/path/to/folder'),
    async (input) => {
      const modal = page.locator('.arco-modal').filter({ has: input });
      await input.fill(target);
      await input.press('Enter');
      await expect(modal.locator('.arco-modal-footer span[title]').first()).toHaveAttribute('title', target);
      await modal.locator('.arco-modal-footer button').last().click();
    },
    { times: 1 }
  );
}

export { expect };
