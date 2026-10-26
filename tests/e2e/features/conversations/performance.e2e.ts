/**
 * Opt-in production measurements; never calls an AI provider.
 * Build with `bun run package --manifest`, then set AIONUI_PERFORMANCE=1.
 * AIONUI_PERF_EXPECT_LAZY=1 also exercises loading, failure and editor recovery.
 * AIONUI_PERF_SAMPLES=1 is diagnostic only; the default records 20 navigation samples.
 */
import type { CDPSession, Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../../fixtures';
import { findAssistantIdForBackend, httpPost, httpDelete, GUID_INPUT } from '../../helpers';

type Scenario = {
  historyPairs?: number;
  seedHistoryOnly?: boolean;
  chunks?: string[];
  intervalMs?: number;
  onChunk?: (sequence: number) => void;
};
type Registry = {
  controllers: Record<
    string,
    {
      runScenario: (options: Scenario) => Promise<void>;
      emitFileChange: (path: string, before: string, after: string) => Promise<void>;
    }
  >;
};

const ENABLED_KEY = 'aionui:e2e-message-stream-conversation-id';

function distribution(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), samples };
}

async function finishTrace(session: CDPSession, output: string): Promise<void> {
  const completed = new Promise<string>((resolve) => {
    session.once('Tracing.tracingComplete', (event: { stream: string }) => resolve(event.stream));
  });
  await session.send('Tracing.end');
  const handle = await completed;
  const parts: string[] = [];
  for (;;) {
    const value = await session.send('IO.read', { handle });
    parts.push(value.base64Encoded ? Buffer.from(value.data, 'base64').toString('utf8') : value.data);
    if (value.eof) break;
  }
  await session.send('IO.close', { handle });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, parts.join(''));
}

async function openConversation(page: Page, id: string): Promise<void> {
  await page.evaluate(
    ({ key, conversationId }) => {
      sessionStorage.setItem(key, conversationId);
      location.hash = `/conversation/${conversationId}`;
    },
    { key: ENABLED_KEY, conversationId: id }
  );
  await page.waitForFunction(
    (conversationId) =>
      Boolean(
        (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__?: Registry }).__AIONUI_E2E_MESSAGE_STREAM__?.controllers[
          conversationId
        ]
      ),
    id
  );
  await page.locator('textarea:visible').last().waitFor({ state: 'visible' });
}

async function createFixtureConversation(page: Page): Promise<string> {
  const assistantId = await findAssistantIdForBackend(page, 'codex');
  expect(assistantId).toBeTruthy();
  const conversation = await httpPost<{ id: string }>(page, '/api/conversations', {
    name: `Performance acceptance ${Date.now()}`,
    assistant: { id: assistantId },
    extra: { workspace: '/tmp', custom_workspace: true, session_mode: 'default' },
  });
  await openConversation(page, conversation.id);
  return conversation.id;
}

async function replay(page: Page, id: string, count: number) {
  return page.evaluate(
    async ({ conversationId, chunkCount }) => {
      const controller = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__: Registry })
        .__AIONUI_E2E_MESSAGE_STREAM__.controllers[conversationId];
      await controller.runScenario({ historyPairs: 25, seedHistoryOnly: true });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const received = new Map<number, number>();
      const latencies: number[] = [];
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((entries) => {
        longTasks.push(...entries.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: 'longtask' });
      let painted = -1;
      let stopped = false;
      const sample = () => {
        const rows = document.querySelectorAll('.message-item.text.justify-start');
        const row = rows.item(rows.length - 1);
        const text = row?.querySelector('.markdown-shadow')?.shadowRoot?.textContent ?? '';
        const seen = [...text.matchAll(/PERF_(\d+)/g)].map((match) => Number(match[1]));
        const latest = seen.at(-1) ?? -1;
        if (latest > painted) {
          const at = performance.now();
          for (const [sequence, start] of received) {
            if (sequence <= latest) {
              latencies.push(at - start);
              received.delete(sequence);
            }
          }
          painted = latest;
        }
        if (!stopped) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const chunks = Array.from({ length: chunkCount }, (_, index) => {
        const marker = `PERF_${index}`;
        return index % 8 === 0
          ? `\n\n${marker}\n\n\`\`\`typescript\nconst sample${index} = ${index};\n\`\`\`\n\n$E = mc^2$\n\n`
          : `${marker} A fixed paragraph exercises Traditional Chinese 中文 and Markdown rendering.\n\n`;
      });
      const started = performance.now();
      try {
        await controller.runScenario({
          historyPairs: 0,
          chunks,
          intervalMs: 10,
          onChunk: (sequence) => received.set(sequence, performance.now()),
        });
        const deadline = performance.now() + 5000;
        while (painted < chunkCount - 1 && performance.now() < deadline) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return {
          durationMs: performance.now() - started,
          chunks: chunkCount,
          finalPaintedSequence: painted,
          eventToFrameMs: latencies,
          longTasksMs: longTasks,
        };
      } finally {
        stopped = true;
        observer.disconnect();
      }
    },
    { conversationId: id, chunkCount: count }
  );
}

test.skip(process.env.AIONUI_PERFORMANCE !== '1', 'Opt-in production performance measurements');

test('records startup, switching, preview and synthetic stream costs', async ({ page, webui }, testInfo) => {
  test.setTimeout(600_000);
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Performance.enable');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cold: number[] = [];
  const warm: number[] = [];
  const fcp: number[] = [];
  let startupJs: Array<{ url: string; encodedBytes: number; transferBytes: number }> = [];
  const ids: string[] = [];
  const repetitions = process.env.AIONUI_PERF_SAMPLES === '1' ? 1 : 20;
  try {
    const shell = await readFile(path.resolve('out/renderer/index.html'), 'utf8');
    const expectedEntry = shell.match(/<script[^>]+src="([^"]+)"/)?.[1];
    const entryScript = await page.locator('script[type="module"][src]').getAttribute('src');
    expect(entryScript, 'The isolated server must serve this checkout production build').toBe(expectedEntry);
    for (const [disableCache, samples] of [
      [true, cold],
      [false, warm],
    ] as const) {
      await session.send('Network.setCacheDisabled', { cacheDisabled: disableCache });
      for (let run = 0; run < repetitions; run++) {
        await page.goto(`${webui.url}/#/guid`, { waitUntil: 'domcontentloaded' });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator(GUID_INPUT).first().waitFor({ state: 'visible' });
        const value = await page.evaluate(() => ({
          readyMs: performance.now(),
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
          js: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .filter((entry) => new URL(entry.name).pathname.endsWith('.js'))
            .map((entry) => ({
              url: new URL(entry.name).pathname,
              encodedBytes: entry.encodedBodySize,
              transferBytes: entry.transferSize,
            })),
        }));
        samples.push(value.readyMs);
        if (value.fcp !== undefined) fcp.push(value.fcp);
        if (disableCache && run === repetitions - 1) startupJs = value.js;
      }
      console.info(`performance: ${disableCache ? 'cold' : 'warm'} navigation completed (${repetitions} samples)`);
    }
    const assistantId =
      (await findAssistantIdForBackend(page, 'codex')) ?? (await findAssistantIdForBackend(page, 'claude'));
    expect(assistantId, 'An isolated ACP assistant is required; no CLI session is started').toBeTruthy();
    const workspace = path.join(webui.dataDir, 'performance-workspace');
    await mkdir(workspace);
    for (let index = 0; index < 2; index++) {
      const conversation = await httpPost<{ id: string }>(page, '/api/conversations', {
        id: `perf-${Date.now()}-${index}`,
        name: `Performance fixture ${index}`,
        assistant: { id: assistantId },
        extra: { workspace, custom_workspace: true, session_mode: 'default' },
      });
      ids.push(conversation.id);
    }
    const switches: number[] = [];
    for (let run = 0; run < repetitions; run++) {
      const start = await page.evaluate(() => performance.now());
      await openConversation(page, ids[run % 2]);
      switches.push((await page.evaluate(() => performance.now())) - start);
    }
    console.info(`performance: conversation switching completed (${repetitions} samples)`);
    const streams = [];
    for (const rate of [1, 4]) {
      await session.send('Emulation.setCPUThrottlingRate', { rate });
      for (const chunks of [16, 240]) {
        await page.goto(`${webui.url}/#/guid`);
        await openConversation(page, ids[0]);
        const traceDirectory = process.env.AIONUI_PERF_TRACE_DIR;
        const trace = traceDirectory && rate === 4 && chunks === 240;
        if (trace) {
          await session.send('Tracing.start', {
            categories: 'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-v8.cpu_profiler',
            transferMode: 'ReturnAsStream',
          });
        }
        const before = await session.send('Performance.getMetrics');
        const pending = replay(page, ids[0], chunks);
        let streaming = true;
        void pending.then(
          () => {
            streaming = false;
          },
          () => {
            streaming = false;
          }
        );
        const inputRoundTrips: number[] = [];
        const input = page.locator('textarea:visible').last();
        for (let sample = 0; sample < 8 && streaming; sample++) {
          const started = Date.now();
          await input.fill(`Performance typing sample ${sample}`);
          inputRoundTrips.push(Date.now() - started);
          await page.waitForTimeout(30);
        }
        const result = await pending;
        if (trace) await finishTrace(session, path.join(traceDirectory, 'stream.json'));
        const after = await session.send('Performance.getMetrics');
        const previous = new Map(before.metrics.map((metric) => [metric.name, metric.value]));
        streams.push({
          cpuThrottle: rate,
          inputRoundTripMs: distribution(inputRoundTrips),
          ...result,
          eventToFrameMs: distribution(result.eventToFrameMs),
          longTasksMs: distribution(result.longTasksMs),
          browserCpuSeconds: Object.fromEntries(
            after.metrics
              .filter((metric) =>
                ['ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(metric.name)
              )
              .map((metric) => [metric.name, metric.value - (previous.get(metric.name) ?? 0)])
          ),
        });
        expect(result.finalPaintedSequence).toBe(chunks - 1);
        console.info(`performance: stream completed (${chunks} chunks, ${rate}x CPU)`);
      }
    }
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(async (id) => {
      const controller = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__: Registry })
        .__AIONUI_E2E_MESSAGE_STREAM__.controllers[id];
      await controller.emitFileChange('/tmp/performance.ts', 'const before = 1;', 'const after = 2;');
    }, ids[0]);
    const change = page.getByTestId('message-acp_tool_call-left').last();
    const previewStart = await page.evaluate(() => performance.now());
    await change.getByText('+1', { exact: true }).click();
    await expect(page.locator('.preview-panel')).toContainText('performance.ts');
    const previewMs = (await page.evaluate(() => performance.now())) - previewStart;
    const report = {
      source: process.env.AIONUI_PERF_REVISION ?? 'working-tree',
      entryScript,
      environment: 'Isolated Linux Chromium; service workers blocked; no AI provider calls; mobile CPU is simulated',
      fixture:
        'Empty isolated workspace and two persisted conversations; stream adds 50 synthetic historical rows, code and math',
      webuiCoreReadyMs: webui.startupMs,
      containerStartupMs: null,
      sendToFirstServerEventMs: null,
      coldReadyMs: distribution(cold),
      warmReadyMs: distribution(warm),
      fcpMs: distribution(fcp),
      switchMs: distribution(switches),
      firstPreviewMs: previewMs,
      startupJs,
      streams,
      errors,
    };
    const json = JSON.stringify(report, null, 2);
    await writeFile(process.env.AIONUI_PERF_OUTPUT ?? testInfo.outputPath('performance.json'), json);
    await testInfo.attach('performance', { body: json, contentType: 'application/json' });
    expect(errors).toEqual([]);
  } finally {
    await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const id of ids) await httpDelete(page, `/api/conversations/${id}`).catch(() => {});
    await session.detach();
  }
});

test('keeps startup code deferred and shows loading while auth is pending', async ({ page, webui }) => {
  test.skip(process.env.AIONUI_PERF_EXPECT_LAZY !== '1', 'Candidate loading boundary acceptance');
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(request.url());
  });
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/user', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root .arco-spin').first()).toBeVisible();
    await expect(page.locator(GUID_INPUT)).toBeHidden();
    release();
    await page.locator(GUID_INPUT).waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    expect(requests.filter((url) => /\/(?:PreviewPanel|mermaid\.core)-[^/]+\.js/.test(url))).toEqual([]);
    const entry = await page.locator('script[type="module"][src]').getAttribute('src');
    if (!entry) throw new Error('No production entry script');
    const response = await page.request.head(new URL(entry, webui.url).href, { headers: { 'Accept-Encoding': 'br' } });
    expect(response.headers()['content-encoding']).toBe('br');
    expect(response.headers()['cache-control']).toContain('immutable');
    const cached = await page.request.head(new URL(entry, webui.url).href, {
      headers: { 'Accept-Encoding': 'br', 'If-None-Match': response.headers().etag },
    });
    expect(cached.status()).toBe(304);
  } finally {
    release();
    await page.unroute('**/api/auth/user');
  }
});

test('contains a failed preview import and restores the preview on retry', async ({ page }, testInfo) => {
  test.skip(process.env.AIONUI_PERF_EXPECT_LAZY !== '1', 'Candidate loading boundary acceptance');
  const id = await createFixtureConversation(page);
  let failed = false;
  await page.route('**/assets/PreviewPanel-*.js', async (route) => {
    if (!failed) {
      failed = true;
      await route.abort();
    } else await route.continue();
  });
  try {
    await page.evaluate(async (conversationId) => {
      const controller = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__: Registry })
        .__AIONUI_E2E_MESSAGE_STREAM__.controllers[conversationId];
      await controller.emitFileChange('/tmp/lazy-preview.ts', 'before', 'after');
    }, id);
    await page.getByTestId('message-acp_tool_call-left').last().getByText('+1', { exact: true }).click();
    await expect(page.locator('.preview-panel [role="alert"]')).toBeVisible();
    await expect(page.locator('textarea:visible').last()).toBeVisible();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.preview-panel')).toContainText('lazy-preview.ts');
    await page.screenshot({ path: testInfo.outputPath('preview-desktop.png') });
  } finally {
    await page.unroute('**/assets/PreviewPanel-*.js');
    await httpDelete(page, `/api/conversations/${id}`);
  }
});

test('keeps diagram source readable on an engine load failure and renders after reload', async ({ page }, testInfo) => {
  test.skip(process.env.AIONUI_PERF_EXPECT_LAZY !== '1', 'Candidate diagram loading acceptance');
  const id = await createFixtureConversation(page);
  let failed = false;
  await page.route('**/assets/mermaid.core-*.js', async (route) => {
    if (!failed) {
      failed = true;
      await route.abort();
    } else await route.continue();
  });
  const emit = async (source: string) =>
    page.evaluate(
      async ({ conversationId, code }) => {
        const controller = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__: Registry })
          .__AIONUI_E2E_MESSAGE_STREAM__.controllers[conversationId];
        await controller.runScenario({ historyPairs: 0, chunks: [`\n\`\`\`mermaid\n${code}\n\`\`\`\n`] });
      },
      { conversationId: id, code: source }
    );
  try {
    await emit('graph TD; A-->B');
    await expect(page.locator('.message-item.text.justify-start').last().locator('pre')).toContainText(
      'graph TD; A-->B'
    );
    await expect.poll(() => failed).toBe(true);
    await page.unroute('**/assets/mermaid.core-*.js');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openConversation(page, id);
    await emit('graph TD; C-->D');
    await expect(page.getByTestId('mermaid-diagram')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await expect(page.getByTestId('mermaid-diagram')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mermaid-diagram')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('diagram-mobile-dark.png') });
  } finally {
    await page.unroute('**/assets/mermaid.core-*.js');
    await httpDelete(page, `/api/conversations/${id}`);
  }
});

test('keeps unsaved editor text when closing is cancelled and can reopen the preview', async ({ page }, testInfo) => {
  test.skip(process.env.AIONUI_PERF_EXPECT_LAZY !== '1', 'Candidate editor lifecycle acceptance');
  const id = await createFixtureConversation(page);
  try {
    await page.evaluate(async (conversationId) => {
      const controller = (window as unknown as { __AIONUI_E2E_MESSAGE_STREAM__: Registry })
        .__AIONUI_E2E_MESSAGE_STREAM__.controllers[conversationId];
      await controller.emitFileChange('/tmp/editable-check.txt', 'before', 'after');
    }, id);
    const row = page.getByTestId('message-acp_tool_call-left').last();
    await row.getByText('Preview', { exact: true }).click();
    const panel = page.locator('.preview-panel');
    const editor = panel.locator('.cm-content').first();
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('UNSAVED-CHECK');
    await expect(editor).toContainText('UNSAVED-CHECK');
    const tab = panel
      .locator('[title="editable-check.txt"]')
      .first()
      .locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');
    await tab.click({ button: 'middle' });
    await expect(page.getByRole('button', { name: 'Save and Close', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toContainText('UNSAVED-CHECK');
    await page.screenshot({ path: testInfo.outputPath('editor-dirty-desktop.png') });
    await tab.click({ button: 'middle' });
    await page.getByRole('button', { name: /Don't Save/, exact: true }).click();
    await expect(panel).toBeHidden();
    await row.getByText('Preview', { exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(editor).not.toContainText('UNSAVED-CHECK');
  } finally {
    await httpDelete(page, `/api/conversations/${id}`);
  }
});

test('suspends production browser state reads on visibility events and refreshes on return', async ({ page }) => {
  test.skip(process.env.AIONUI_PERF_EXPECT_LAZY !== '1', 'Candidate visibility acceptance');
  const id = await createFixtureConversation(page);
  let reads = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(`/api/edu/browser/${id}/state`)) reads++;
  });
  try {
    await expect.poll(() => reads).toBeGreaterThan(0);
    // Headless Chromium keeps all tabs visible; dispatch the native lifecycle signal explicitly.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenReads = reads;
    await page.waitForTimeout(4200);
    expect(reads).toBe(hiddenReads);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => reads, { timeout: 1000 }).toBe(hiddenReads + 1);
  } finally {
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
    });
    await httpDelete(page, `/api/conversations/${id}`);
  }
});
