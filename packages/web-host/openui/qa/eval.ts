import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Message = { id: string; type: string; position: string; status: string; content: { content?: string } };
type Request = <T>(method: 'GET' | 'POST', route: string, body?: unknown) => Promise<T>;

export type EvaluationResult = {
  id: string;
  prompt: string;
  reply: string;
  blocks: { profile: string; program: string }[];
  files: string[];
};

/** Fixed Chinese-subject teacher requests (spec §8); #8 continues the conversation of #2. */
export const EVAL_PROMPTS: { id: string; prompt: string; followUpOf?: string }[] = [
  { id: '01-slides', prompt: '幫我為中三設計《背影》兩教節的簡報' },
  { id: '02-test', prompt: '出一份中四文言文閱讀測驗，篇章用《出師表》，30 分' },
  { id: '03-illustration', prompt: '為《岳陽樓記》畫一幅水墨風格的插圖' },
  { id: '04-worksheet', prompt: '設計中二記敍文寫作工作紙，包括評分準則' },
  { id: '05-compare', prompt: '比較《論仁》和《論孝》的重點，方便我備課' },
  { id: '06-notice', prompt: '幫我擬一份中文科閱讀周家長通告' },
  { id: '07-plain', prompt: '呢句修辭手法係乜？「春風又綠江南岸」' },
  { id: '08-revise', prompt: '將呢份測驗改深啲', followUpOf: '02-test' },
  { id: '09-dictation', prompt: '整一份默書範圍同評分方法' },
  { id: '10-dse', prompt: '中五 DSE 卷一閱讀理解題型分析' },
];

/** Generated files may take several tool calls (officecli, image generation). */
const TURN_TIMEOUT_MS = 15 * 60 * 1000;

const listFiles = (directory: string, prefix = ''): string[] =>
  readdirSync(directory).flatMap((name) => {
    const relative = prefix ? prefix + '/' + name : name;
    return statSync(path.join(directory, name)).isDirectory()
      ? listFiles(path.join(directory, name), relative)
      : [relative];
  });

/**
 * Send each teacher request to the configured native agent and record the final reply,
 * its OpenUI programs and the workspace files the turn created. Scoring is manual (spec §2).
 */
export async function runTeacherEvaluation(
  data: string,
  output: string,
  request: Request
): Promise<EvaluationResult[]> {
  const conversations = new Map<string, { id: string; workspace: string }>();
  const results: EvaluationResult[] = [];
  for (const item of EVAL_PROMPTS) {
    let conversation = item.followUpOf ? conversations.get(item.followUpOf) : undefined;
    if (!conversation) {
      const workspace = path.join(data, 'teacher-eval', item.id);
      mkdirSync(workspace, { recursive: true });
      const created = await request<{ id: string }>('POST', '/api/conversations', {
        type: 'acp',
        name: 'Teacher evaluation ' + item.id,
        extra: { backend: 'codex', workspace, selected_mcp_server_ids: [] },
      });
      conversation = { id: created.id, workspace };
    }
    conversations.set(item.id, conversation);
    const messagesPath = `/api/conversations/${conversation.id}/messages`;
    const before = new Set(listFiles(conversation.workspace));
    const previous = new Set(
      (await request<{ items: Message[] }>('GET', messagesPath + '?limit=200')).items.map((message) => message.id)
    );
    const sent = await request<{ turn_id: string }>('POST', messagesPath, {
      content: item.prompt,
      ui_capabilities: ['openui/1'],
    });
    assert.ok(sent.turn_id);
    const reply = await finalReply(request, conversation.id, previous);
    const blocks = openUiBlocks(reply);
    const files = listFiles(conversation.workspace).filter((file) => !before.has(file));
    const result = { id: item.id, prompt: item.prompt, reply, blocks, files };
    results.push(result);
    writeFileSync(
      path.join(output, item.id + '.md'),
      `# ${item.id}\n\n> ${item.prompt}\n\nFiles: ${files.join(', ') || '(none)'}\n\n${reply}\n`
    );
    writeFileSync(path.join(output, 'evaluation.json'), JSON.stringify(results, null, 2) + '\n');
    console.info(`[teacher-eval] ${item.id}: ${blocks.length} block(s), ${files.length} file(s)`);
  }
  return results;
}

/** Fenced OpenUI programs in a reply; scoring only needs the profile and the program text. */
export const openUiBlocks = (reply: string): { profile: string; program: string }[] =>
  [...reply.matchAll(/^ {0,3}(`{3,}|~{3,})(openui(?:-chat)?)[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*$/gm)].map((match) => ({
    profile: match[2],
    program: match[3].trimEnd(),
  }));

async function finalReply(request: Request, conversation: string, previous: Set<string>): Promise<string> {
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  for (;;) {
    const [current, history] = await Promise.all([
      request<{ runtime?: { is_processing: boolean; turn_id?: string } }>('GET', `/api/conversations/${conversation}`),
      request<{ items: Message[] }>('GET', `/api/conversations/${conversation}/messages?limit=200`),
    ]);
    const replies = history.items.filter(
      (message) =>
        message.type === 'text' &&
        message.position === 'left' &&
        message.status === 'finish' &&
        !previous.has(message.id) &&
        Boolean(message.content.content)
    );
    if (replies.length && current.runtime?.is_processing === false && !current.runtime.turn_id)
      return replies.map((message) => message.content.content).join('\n\n');
    if (Date.now() >= deadline) throw new Error(`Teacher evaluation turn did not finish within 15 minutes`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
