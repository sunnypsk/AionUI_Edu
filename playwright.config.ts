import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // Browser tests share one isolated Core per worker
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],
  use: {
    channel: process.env.AIONUI_E2E_BROWSER_CHANNEL || 'chrome',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { timeout: 30_000 },
    trace: process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'on-first-retry',
  },
  outputDir: 'tests/e2e/results',
});
