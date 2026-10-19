import { EventEmitter } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { SharedBrowserManager } from './manager.js';
import { browserActionSchema, browserUrl, type BrowserOwner } from './types.js';

class FakePage extends EventEmitter {
  address = 'about:blank';
  closed = false;
  fill = vi.fn().mockResolvedValue(undefined);
  upload = vi.fn().mockResolvedValue(undefined);
  mouse = { up: vi.fn().mockResolvedValue(undefined), click: vi.fn().mockResolvedValue(undefined) };
  keyboard = { insertText: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) };
  locator = vi.fn(() => ({
    ariaSnapshot: async () => '- textbox: updated page',
    fill: this.fill,
    setInputFiles: this.upload,
  }));
  url = (): string => this.address;
  viewportSize = (): { width: number; height: number } => ({ width: 1280, height: 800 });
  title = async (): Promise<string> => 'Page';
  goto = async (url: string): Promise<void> => {
    this.address = url;
  };
  screenshot = async (): Promise<Buffer> => Buffer.from('jpeg');
  isClosed = (): boolean => this.closed;
  close = async (): Promise<void> => {
    this.closed = true;
    this.emit('close');
  };
}

describe('task-scoped shared browser', () => {
  let directory: string;
  let manager: SharedBrowserManager;
  let owner: BrowserOwner;
  let pages: FakePage[];
  let launched: string[];
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'shared-browser-'));
    const workspace = path.join(directory, 'task-one');
    await mkdir(workspace);
    owner = { userId: 'teacher-one', conversationId: 'task-one', workspace };
    pages = [];
    launched = [];
    manager = new SharedBrowserManager(directory, {
      launch: async (profile) => {
        launched.push(profile);
        const context = new EventEmitter();
        return Object.assign(context, {
          pages: () => [],
          setDefaultTimeout: vi.fn(),
          setDefaultNavigationTimeout: vi.fn(),
          newPage: async () => {
            const page = new FakePage();
            pages.push(page);
            return page as unknown as Page;
          },
          close: async () => {
            context.emit('close');
          },
        }) as unknown as BrowserContext;
      },
    });
  });
  afterEach(async () => {
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const tab = async (): Promise<string> =>
    (await manager.act(owner, 'agent', { kind: 'open', url: 'https://example.com' })).state.activeTabId!;

  it('blocks agent reads and mutations throughout manual control', async () => {
    const id = await tab();
    await manager.control(owner, 'human');
    await expect(manager.act(owner, 'agent', { kind: 'snapshot', tabId: id })).rejects.toThrow('BROWSER_HUMAN_CONTROL');
    await expect(
      manager.act(owner, 'agent', { kind: 'navigate', tabId: id, url: 'https://example.org' })
    ).rejects.toThrow('BROWSER_HUMAN_CONTROL');
  });

  it('drains the running action and rejects queued AI work before granting takeover', async () => {
    const id = await tab();
    let finish!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    pages[0].fill.mockImplementation(() => {
      started();
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'first' });
    await running;
    const queued = manager.act(owner, 'agent', { kind: 'fill', tabId: id, selector: 'input', text: 'second' });
    const rejected = expect(queued).rejects.toThrow('BROWSER_HUMAN_CONTROL');
    const takeover = manager.control(owner, 'human');
    expect(manager.state(owner).takingOver).toBe(true);
    finish();
    await first;
    await rejected;
    await takeover;
    expect(pages[0].fill).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh page inspection after the user returns control', async () => {
    const id = await tab();
    await manager.control(owner, 'human');
    await manager.act(owner, 'human', { kind: 'text', tabId: id, text: '老師修改' });
    await manager.control(owner, 'agent');
    await expect(manager.act(owner, 'agent', { kind: 'click', tabId: id, x: 1, y: 1 })).rejects.toThrow(
      'BROWSER_PAGE_CHANGED'
    );
    const result = await manager.act(owner, 'agent', { kind: 'inspect' });
    expect(result.text).toContain('updated page');
    await manager.act(owner, 'agent', { kind: 'click', tabId: id, x: 1, y: 1 });
  });

  it('shares a profile within a user while isolating pages across tasks and users', async () => {
    const id = await tab();
    const other = { ...owner, conversationId: 'task-two' };
    await expect(manager.act(other, 'agent', { kind: 'snapshot', tabId: id })).rejects.toThrow('BROWSER_TAB_NOT_FOUND');
    await manager.act(other, 'agent', { kind: 'open' });
    await manager.act({ ...other, userId: 'teacher-two', conversationId: 'task-three' }, 'agent', { kind: 'open' });
    expect(new Set(launched).size).toBe(2);
  });

  it('rejects forged ownership and changed workspace paths', async () => {
    await tab();
    expect(() => manager.state({ ...owner, userId: 'someone-else' })).toThrow('BROWSER_FORBIDDEN');
    expect(() => manager.state({ ...owner, workspace: '/different' })).toThrow('BROWSER_FORBIDDEN');
  });

  it('rejects uploads that escape the task folder through a symlink', async () => {
    const id = await tab();
    const outside = path.join(directory, 'secret.txt');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(owner.workspace, 'link'));
    await expect(
      manager.act(owner, 'agent', { kind: 'uploadPath', tabId: id, selector: 'input', path: 'link' })
    ).rejects.toThrow('BROWSER_FORBIDDEN');
  });

  it('preserves the selected file MIME type and bytes for website uploads', async () => {
    const id = await tab();
    const buffer = Buffer.from([0, 255, 80, 68, 70]);
    await manager.act(owner, 'agent', {
      kind: 'upload',
      tabId: id,
      selector: 'input',
      name: '教材.pdf',
      mimeType: 'application/pdf',
      base64: buffer.toString('base64'),
    });
    expect(pages[0].upload).toHaveBeenCalledWith({ name: '教材.pdf', mimeType: 'application/pdf', buffer });
  });

  it('persists opt-out and prevents AI from reacquiring control', async () => {
    await tab();
    await manager.setPreferences(owner.userId, { agentEnabled: false });
    await expect(manager.control(owner, 'agent')).rejects.toThrow('BROWSER_AGENT_DISABLED');
    await expect(manager.act(owner, 'agent', { kind: 'inspect' })).rejects.toThrow('BROWSER_AGENT_DISABLED');
    const reopened = new SharedBrowserManager(directory);
    try {
      expect(await reopened.getPreferences(owner.userId)).toEqual({ agentEnabled: false });
    } finally {
      await reopened.close();
    }
  });

  it('clears only the current user profile and preserves task files', async () => {
    await tab();
    await writeFile(path.join(owner.workspace, 'keep.txt'), 'keep');
    await manager.clearData(owner.userId);
    expect(manager.state(owner).running).toBe(false);
    await expect(
      (await import('node:fs/promises')).readFile(path.join(owner.workspace, 'keep.txt'), 'utf8')
    ).resolves.toBe('keep');
  });

  it('rejects internal URLs and malformed browser inputs', () => {
    expect(() => browserUrl('file:///etc/passwd')).toThrow('INVALID_BROWSER_URL');
    expect(() => browserUrl('javascript:alert(1)')).toThrow('INVALID_BROWSER_URL');
    expect(browserActionSchema.safeParse({ kind: 'click', tabId: 'bad', x: -1, y: 0 }).success).toBe(false);
  });
});
