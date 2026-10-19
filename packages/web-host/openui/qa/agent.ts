import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { fixtureServer } from './fixtures';

type Message = { id: string; type: string; position: string; status: string; content: { content?: string } };
type Request = <T>(method: 'GET' | 'POST', route: string, body?: unknown) => Promise<T>;

/** Exercise the configured native agent through the real send and follow-up endpoints. */
export async function runAgentAcceptance(
  page: Page,
  base: string,
  data: string,
  output: string,
  request: Request
): Promise<string[]> {
  const conversation = await request<{ id: string }>('POST', '/api/conversations', {
    type: 'acp',
    name: 'OpenUI real agent acceptance',
    extra: {
      backend: 'codex',
      workspace: data,
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [fixtureServer(path.join(data, 'agent-fixture-writes.json'))],
    },
  });
  const messagesPath = `/api/conversations/${conversation.id}/messages`;
  await page.goto(base + '/#/conversation/' + conversation.id);
  const sent = await request<{ msg_id: string; turn_id: string }>('POST', messagesPath, {
    content:
      '幫我整一個可以直接操作嘅課堂介面：用 bar chart 比較 F1 有 25 人、F2 有 30 人；用表單畀我填主題同日期。主題欄位 label 同 placeholder 用 Topic，初值用 Poetry；提交按鈕叫 Continue lesson，只需將所選資料送返對話畀你繼續。再加一張會自動讀取呢個對話 read MCP tool 結果嘅資料卡。請保留一兩句自然嘅廣東話說明，毋須問我確認。由你自己直接完成，唔好開 subagent、委派、討論或做 review。只使用呢個會話提供嘅測試 MCP；唔好執行 shell、改檔或者使用 write tool。',
    ui_capabilities: ['openui/1'],
  });
  assert.ok(sent.turn_id);

  const finalReply = async (previous = new Set<string>()): Promise<Message> => {
    const deadline = Date.now() + 180000;
    const poll = async (): Promise<Message> => {
      const [current, history] = await Promise.all([
        request<{ runtime?: { is_processing: boolean; turn_id?: string } }>(
          'GET',
          `/api/conversations/${conversation.id}`
        ),
        request<{ items: Message[] }>('GET', messagesPath + '?limit=200'),
      ]);
      const reply = history.items.findLast(
        (message) =>
          message.type === 'text' &&
          message.position === 'left' &&
          message.status === 'finish' &&
          !previous.has(message.id) &&
          Boolean(message.content.content)
      );
      if (reply && current.runtime?.is_processing === false && !current.runtime.turn_id) return reply;
      if (Date.now() >= deadline)
        throw new Error('The configured agent did not produce a finalized assistant reply within 180 seconds');
      await page.waitForTimeout(1000);
      return poll();
    };
    return poll();
  };
  const reply = await finalReply();
  const content = reply.content.content!;
  writeFileSync(path.join(output, 'agent-program.md'), content + '\n');
  assert.match(content, /BarChart\(/);
  assert.match(content, /Form\(/);
  assert.match(content, /Query\(/);
  const topic = page.getByPlaceholder('Topic', { exact: true });
  await topic.waitFor({ timeout: 30000 });
  assert.equal(await topic.isEnabled(), true);
  await topic.fill('Agent acceptance topic');
  const date = page.locator('[data-openui-block] button[aria-haspopup="dialog"]').first();
  await date.focus();
  await date.press('Enter');
  const calendar = page.getByRole('dialog');
  await calendar.waitFor();
  await calendar.locator('.openui-calendar-single-day-button').filter({ hasText: /^20$/ }).click();
  await calendar.waitFor({ state: 'hidden' });
  await topic.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'agent-generated.png') });

  const previous = new Set(
    (await request<{ items: Message[] }>('GET', messagesPath + '?limit=200')).items.map((message) => message.id)
  );
  const followUp = page.waitForRequest((event) => event.url().endsWith(messagesPath) && event.method() === 'POST');
  await page.getByRole('button', { name: 'Continue lesson', exact: true }).click();
  const body = (await followUp).postDataJSON() as {
    ui_capabilities?: string[];
    ui_action?: { form_state?: unknown; message_id?: string };
  };
  assert.deepEqual(body.ui_capabilities, ['openui/1']);
  assert.equal(body.ui_action?.message_id, reply.id);
  assert.ok(JSON.stringify(body.ui_action?.form_state).includes('Agent acceptance topic'));
  const continuation = await finalReply(previous);
  writeFileSync(path.join(output, 'agent-continuation.md'), continuation.content.content! + '\n');
  assert.ok(continuation.content.content!.includes('Agent acceptance topic'));
  return [
    'configured agent generated a chart, form and live MCP Query',
    'real OpenUI follow-up carried capabilities, source block and form state into the next agent turn',
  ];
}
