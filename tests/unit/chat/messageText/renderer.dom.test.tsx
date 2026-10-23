import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { defaultLightTheme } from '@openuidev/react-ui';
import OpenUIMessage, {
  OPENUI_DARK_THEME,
  OPENUI_LIGHT_THEME,
} from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI';
import { SUBMITTED_AT_KEY } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/useSavedState';
import { emitter } from '@/renderer/utils/emitter';
import {
  draft as listeningDraft,
  formatDuration,
} from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/ListeningEditor/draft';
import type { ListeningProject } from '@/common/types/platform/listeningProject';
import { AudioPlayer } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUIComponents/AudioPlayer';
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/common/adapter/httpBridge', async (original) => ({
  ...(await original<object>()),
  httpRequest: transport.request,
}));
const api = vi.hoisted(() => ({
  openUiCapabilities: vi.fn(),
  isCompatible: (value: { hash?: string }) => value?.hash === 'compatible',
  resolveMessageId: vi.fn().mockResolvedValue('message'),
  loadState: vi.fn(),
  saveState: vi.fn(),
  listTools: vi.fn(),
  statePath: () => '/state',
  conversationPath: () => '/api/conversations/conversation',
}));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/api', async (original) => ({
  ...(await original<object>()),
  ...api,
}));
const host = vi.hoisted(() => ({
  preview: null as null | { openBrowserTab: () => void },
  workspace: '/ws' as string | undefined,
  launch: vi.fn(),
  errorKind: null as string | null,
  download: vi.fn(),
  downloadAll: vi.fn(),
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => host.preview,
}));
vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({ launchPreview: host.launch, loading: false, errorKind: host.errorKind }),
}));
vi.mock('@/renderer/utils/file/download', () => ({
  downloadFileFromRef: host.download,
  downloadFilesAsZip: host.downloadAll,
}));
vi.mock('@/renderer/hooks/context/ConversationContext', async (original) => ({
  ...(await original<object>()),
  useConversationContextSafe: () =>
    host.workspace ? { workspace: host.workspace, conversation_id: 'conversation' } : null,
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'teacher' } }) }));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const initial = {
  state: {} as Record<string, unknown>,
  revision: 0,
  program_hash: 'one',
  library_id: 'openui',
  library_version: '0.18.1',
};
beforeEach(() => {
  api.openUiCapabilities.mockReset().mockResolvedValue({ protocol: 'openui/1', hash: 'compatible', enabled: true });
  api.loadState.mockReset().mockResolvedValue(initial);
  api.saveState
    .mockReset()
    .mockImplementation(async (_path, previous, state) => ({ ...previous, revision: previous.revision + 1, state }));
  api.listTools.mockReset().mockResolvedValue([]);
  transport.request
    .mockReset()
    .mockResolvedValue({ content: [], structuredContent: { title: 'Read result' }, isError: false });
});
const program = [
  'root = Stack([form])',
  'form = Form("lesson", Buttons([Button("Continue", @ToAssistant("Continue"))]), [FormControl("Topic", Input("topic", "Enter topic", "text", {required: true}, $topic))])',
  '$topic = "Poetry"',
].join(String.fromCharCode(10));
const display = (content: string, streaming = false) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <OpenUIMessage content={content} conversation='conversation' message='message' streaming={streaming} />
    </SWRConfig>
  );
describe('official OpenUI renderer integration', () => {
  it('traps modal keyboard focus and returns to the opening button on Escape', async () => {
    const modal =
      program.replace(
        'root = Stack([form])',
        'root = Stack([Buttons([Button("Open keyboard lesson", @Set($open, true))]), Modal("Keyboard lesson", $open, [form])])'
      ) + '\n$open = false';
    display(modal);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open keyboard lesson' })).not.toBeDisabled());
    const opener = screen.getByRole('button', { name: 'Open keyboard lesson' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Tab' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Continue' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
  it('does not open a generated modal while its assistant message is streaming', async () => {
    display('root = Stack([Modal("Streaming modal", $open, [TextContent("Preview")])])\n$open = true', true);
    await waitFor(() => expect(api.openUiCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps repeated field labels associated with their own program, including modal portals', async () => {
    const modal =
      program.replace(
        'root = Stack([form])',
        'root = Stack([Buttons([Button("Open lesson", @Set($open, true))]), Modal("Second", $open, [form])])'
      ) + '\n$open = false';
    display('```openui\n' + program + '\n```\n```openui\n' + modal + '\n```');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open lesson' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Open lesson' }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(screen.getAllByRole('textbox', { name: /Topic/ })).toHaveLength(2));
    const fields = screen.getAllByRole('textbox', { name: /Topic/ });
    expect(new Set(fields.map((field) => field.id)).size).toBe(2);
  });
  it('restores remote form fields and bindings together without saving stale reactive values', async () => {
    const focusProgram = program.replace(
      'FormControl("Topic",',
      'FormControl("Notes", TextArea("notes", "Focus notes")), FormControl("Topic",'
    );
    api.loadState.mockResolvedValueOnce({
      ...initial,
      state: { $topic: 'Old topic', lesson: { notes: { value: 'Old notes' } } },
    });
    display(focusProgram);
    await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).toHaveValue('Old topic'));
    api.saveState.mockClear();
    api.loadState.mockResolvedValueOnce({
      ...initial,
      revision: 2,
      state: { $topic: 'Remote topic', lesson: { notes: { value: 'Remote notes' } } },
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).toHaveValue('Remote topic'));
    expect(screen.getByPlaceholderText('Focus notes')).toHaveValue('Remote notes');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(api.saveState).not.toHaveBeenCalled();
  });
  it('renders the real official form and forwards selected values through the conversation event', async () => {
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      display(program);
      await screen.findByPlaceholderText('Enter topic');
      await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).not.toBeDisabled());
      const input = screen.getByPlaceholderText('Enter topic');
      fireEvent.change(input, { target: { value: 'Tang poetry' } });
      fireEvent.click(screen.getByText('Continue'));
      await waitFor(() => expect(receive).toHaveBeenCalled());
      expect(receive.mock.calls[0][0]).toMatchObject({
        conversation_id: 'conversation',
        ui_action: { message_id: 'message', block_id: '0' },
      });
      expect(api.saveState).toHaveBeenCalled();
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('combines form scoped values with reactive bindings in follow-up context', async () => {
    api.loadState.mockResolvedValueOnce({ ...initial, state: { $grade: 'F2', lesson: { date: '2026-10-20' } } });
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      display(program + '\n$grade = "F1"');
      await screen.findByPlaceholderText('Enter topic');
      await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).not.toBeDisabled());
      const input = screen.getByPlaceholderText('Enter topic');
      fireEvent.change(input, { target: { value: 'Tang poetry' } });
      fireEvent.click(screen.getByText('Continue'));
      await waitFor(() => expect(receive).toHaveBeenCalled());
      expect(receive.mock.calls[0][0].ui_action).toMatchObject({
        form_name: 'lesson',
        form_state: { $grade: 'F2', $topic: 'Tang poetry', lesson: { date: '2026-10-20' } },
      });
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('locks a form after it is submitted and records the submission in saved state', async () => {
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      const { container } = display(program);
      await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).not.toBeDisabled());
      fireEvent.click(screen.getByText('Continue'));
      await waitFor(() => expect(container.querySelector('[data-openui-submitted]')).not.toBeNull());
      expect(receive.mock.calls[0][0].ui_action.form_state).not.toHaveProperty(SUBMITTED_AT_KEY);
      await waitFor(() =>
        expect(api.saveState.mock.calls.at(-1)?.[2]).toMatchObject({ [SUBMITTED_AT_KEY]: expect.any(Number) })
      );
      expect(screen.getByText('Continue').closest('[inert]')).not.toBeNull();
      fireEvent.click(screen.getByText('Continue'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(receive).toHaveBeenCalledTimes(1);
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('keeps a submitted form locked after reload without exposing the marker to the program', async () => {
    api.loadState.mockResolvedValueOnce({ ...initial, state: { $topic: 'Saved topic', [SUBMITTED_AT_KEY]: 1 } });
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      const { container } = display(program);
      await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).toHaveValue('Saved topic'));
      expect(container.querySelector('[data-openui-submitted]')).not.toBeNull();
      expect(screen.getByText('Continue').closest('[inert]')).not.toBeNull();
      fireEvent.click(screen.getByText('Continue'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(receive).not.toHaveBeenCalled();
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('runs a read-only Query through the official runtime and preserves structured MCP results', async () => {
    api.listTools.mockResolvedValueOnce([{ key: 'server::read', name: 'read', input_schema: {}, read_only: true }]);
    display('root = Stack([TextContent(data.title)])\ndata = Query("server::read", {}, {title: "Loading"})');
    expect(await screen.findByText('Read result')).toBeInTheDocument();
    expect(transport.request).toHaveBeenCalledWith(
      'POST',
      '/api/conversations/conversation/openui/tools/call',
      expect.objectContaining({ tool_key: 'server::read', mode: 'query', message_id: 'message', block_id: '0' }),
      expect.objectContaining({ sensitive: true, signal: expect.any(AbortSignal) })
    );
  });
  it('keeps Query results alive across unrelated form autosaves', async () => {
    api.listTools.mockResolvedValueOnce([{ key: 'server::read', name: 'read', input_schema: {}, read_only: true }]);
    display(
      program.replace('Stack([form])', 'Stack([form, TextContent(data.title)])') +
        '\ndata = Query("server::read", {}, {title: "Loading"})'
    );
    await screen.findByText('Read result');
    api.saveState.mockClear();
    fireEvent.change(screen.getByPlaceholderText('Enter topic'), { target: { value: 'New topic' } });
    await waitFor(() => expect(api.saveState).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
  });
  it('blocks a Query that names a write tool before making any tool request', async () => {
    api.listTools.mockResolvedValueOnce([{ key: 'server::write', name: 'write', input_schema: {}, read_only: false }]);
    display('root = Stack([TextContent(data.title)])\ndata = Query("server::write", {}, {title: "Loading"})');
    expect(await screen.findByText('messages.openui.unsafeQuery')).toBeInTheDocument();
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('keeps required field validation in the official form before creating a follow-up', async () => {
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      display(program.replace('$topic = "Poetry"', '$topic = ""'));
      await screen.findByPlaceholderText('Enter topic');
      await waitFor(() => expect(screen.getByPlaceholderText('Enter topic')).not.toBeDisabled());
      fireEvent.click(screen.getByText('Continue'));
      expect(await screen.findByText(/required/i)).toBeInTheDocument();
      expect(receive).not.toHaveBeenCalled();
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('keeps streaming form controls disabled without requesting tools or saved state', async () => {
    display(program, true);
    expect(await screen.findByPlaceholderText('Enter topic')).toBeDisabled();
    expect(api.loadState).not.toHaveBeenCalled();
    expect(api.listTools).not.toHaveBeenCalled();
  });
  it('keeps a truncated program disabled even when its Markdown fence is closed', async () => {
    display('```openui\nroot = Stack([Input("topic", "Enter topic")\n```');
    expect(await screen.findByPlaceholderText('Enter topic')).toBeDisabled();
    expect(await screen.findByText('messages.openui.invalid')).toBeInTheDocument();
    expect(transport.request).not.toHaveBeenCalled();
  });
  it('isolates an unfinished block and lets the assistant repair its original source', async () => {
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      display('Before\n```openui\nroot = Stack([\n');
      expect(await screen.findByText('messages.openui.invalid')).toBeInTheDocument();
      expect(screen.getByText('Before')).toBeInTheDocument();
      fireEvent.click(await screen.findByText('messages.openui.repair'));
      await waitFor(() => expect(receive).toHaveBeenCalled());
      expect(receive.mock.calls[0][0].ui_action.context).toEqual({
        kind: 'repair_openui',
        profile: 'openui',
        program: 'root = Stack([\n',
      });
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('shows only the unavailable status for an incompatible backend, without raw source', async () => {
    api.openUiCapabilities.mockResolvedValueOnce({ hash: 'old' });
    display(program);
    await screen.findByText('messages.openui.unavailable');
    expect(screen.queryByPlaceholderText('Enter topic')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelector('pre')).toBeNull();
  });
  it('renders a working block without source or empty control rows', async () => {
    const { container } = display(program);
    await screen.findByPlaceholderText('Enter topic');
    expect(screen.queryByRole('button', { name: /source/i })).toBeNull();
    expect(container.querySelector('[data-openui-controls]')).toBeNull();
  });
});
describe('OpenUI app theme', () => {
  const tokenOnly =
    /^(?:var\(--[a-z0-9-]+\)|color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, (?:transparent|var\(--[a-z0-9-]+\))\))$/;
  const appFont = /var\(--font-(?:sans|mono)\)$/;
  it.each([
    ['light', OPENUI_LIGHT_THEME],
    ['dark', OPENUI_DARK_THEME],
  ])('builds every %s value from app tokens', (_mode, theme) => {
    for (const [key, value] of Object.entries(theme)) {
      expect([key, value]).toEqual([
        key,
        expect.stringMatching(
          /^(?:font|text(?:Body|Heading|Label|Numbers|Code))/.test(key) &&
            !/Primary|Secondary|Tertiary|Inverted/.test(key)
            ? appFont
            : tokenOnly
        ),
      ]);
    }
    expect(Object.keys(theme).filter((key) => !(key in defaultLightTheme))).toEqual([]);
  });
  it('separates cards from the page in both modes and follows the app fonts', () => {
    expect(OPENUI_LIGHT_THEME).toMatchObject({ background: 'var(--bg-1)', foreground: 'var(--bg-base)' });
    expect(OPENUI_DARK_THEME).toMatchObject({ background: 'var(--bg-base)', foreground: 'var(--bg-1)' });
    for (const theme of [OPENUI_LIGHT_THEME, OPENUI_DARK_THEME]) {
      expect(theme).toMatchObject({
        fontBody: 'var(--font-sans)',
        fontHeading: 'var(--font-sans)',
        fontCode: 'var(--font-mono)',
        textBodySm: expect.stringMatching(/ 14px\/1\.5 var\(--font-sans\)$/),
        borderInteractiveSelected: 'var(--primary)',
      });
    }
  });
  it('injects the app fonts instead of the library defaults into rendered blocks', async () => {
    display(program);
    await screen.findByPlaceholderText('Enter topic');
    const css = Array.from(document.querySelectorAll('style[data-openui-theme]'))
      .map((style) => style.textContent)
      .join('');
    expect(css).toContain('--openui-font-body: var(--font-sans);');
    expect(css).not.toMatch(/Inter|SFMono-Regular/);
  });
});
describe('FileCard', () => {
  const card = (path: string) =>
    display('root = Stack([FileCard(' + JSON.stringify(path) + ', "背影簡報", "兩教節")])');
  /** Block controls stay disabled until the saved state has loaded. */
  const ready = (name: string) =>
    waitFor(() => {
      const button = screen.getByRole('button', { name });
      expect(button).not.toBeDisabled();
      return button;
    });
  beforeEach(() => {
    host.preview = { openBrowserTab: vi.fn() };
    host.workspace = '/ws';
    host.errorKind = null;
    host.launch.mockReset().mockResolvedValue(undefined);
    host.download.mockReset().mockResolvedValue(undefined);
    host.downloadAll.mockReset().mockResolvedValue(undefined);
  });
  it('previews and downloads a workspace file with a CJK name', async () => {
    card('./簡報/《背影》 第一課.pptx');
    expect(await screen.findByText('背影簡報')).toBeTruthy();
    expect(screen.getByText('兩教節')).toBeTruthy();
    fireEvent.click(await ready('messages.openui.file.preview'));
    expect(host.launch).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: '簡報/《背影》 第一課.pptx', contentType: 'ppt', editable: false })
    );
    fireEvent.click(await ready('messages.openui.file.download'));
    await waitFor(() =>
      expect(host.download).toHaveBeenCalledWith(
        { kind: 'local', path: '/ws/簡報/《背影》 第一課.pptx' },
        '《背影》 第一課.pptx'
      )
    );
  });
  it('normalizes backslash separators', async () => {
    card('簡報\\a.pptx');
    fireEvent.click(await ready('messages.openui.file.preview'));
    expect(host.launch).toHaveBeenCalledWith(expect.objectContaining({ relativePath: '簡報/a.pptx' }));
  });
  it.each(['/etc/passwd', '../a.pptx', 'a/../../b.pptx', 'C:\\a.pptx', 'https://x/a.pptx', ''])(
    'rejects the unsafe path %j without fetching',
    async (path) => {
      card(path);
      expect(await screen.findByText('messages.openui.file.invalidPath')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'messages.openui.file.preview' })).toBeNull();
      expect(host.launch).not.toHaveBeenCalled();
      expect(host.download).not.toHaveBeenCalled();
    }
  );
  it('shows the file as unavailable without a conversation workspace', async () => {
    host.workspace = undefined;
    card('簡報/a.pptx');
    expect(await screen.findByText('messages.openui.file.unavailable')).toBeTruthy();
    for (const name of ['messages.openui.file.preview', 'messages.openui.file.download'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
  });
  it('offers download but no preview outside a preview panel', async () => {
    host.preview = null;
    card('簡報/a.pptx');
    await ready('messages.openui.file.download');
    expect(screen.queryByRole('button', { name: 'messages.openui.file.preview' })).toBeNull();
  });
  it('reports a failed download', async () => {
    host.download.mockRejectedValueOnce(new Error('404'));
    card('簡報/a.pptx');
    fireEvent.click(await ready('messages.openui.file.download'));
    expect(await screen.findByText('messages.openui.file.downloadError')).toBeTruthy();
  });
  it('says the file is missing when preview reports it not found', async () => {
    host.errorKind = 'not_found';
    card('簡報/不存在.pptx');
    expect(await screen.findByText('conversation.workspace.preview.errors.notFound')).toBeTruthy();
  });
  it('says the file is missing when the download returns 404', async () => {
    host.download.mockRejectedValueOnce(new Error('File download failed (404)'));
    card('簡報/不存在.pptx');
    fireEvent.click(await ready('messages.openui.file.download'));
    expect(await screen.findByText('conversation.workspace.preview.errors.notFound')).toBeTruthy();
  });
  it('downloads one ZIP for distinct valid files across separate blocks, retaining their relative directories', async () => {
    display(
      '```openui\nroot = Stack([FileCard("甲/小測.docx", "甲卷"), FileCard("甲/小測.docx", "重複")])\n```\n```openui\nroot = Stack([FileCard("乙/小測.docx", "乙卷"), FileCard("../secret.txt", "Invalid")])\n```'
    );
    fireEvent.click(await ready('messages.openui.file.downloadAll'));
    await waitFor(() =>
      expect(host.downloadAll).toHaveBeenCalledWith(
        [
          { file: { kind: 'local', path: '/ws/甲/小測.docx' }, name: '甲/小測.docx' },
          { file: { kind: 'local', path: '/ws/乙/小測.docx' }, name: '乙/小測.docx' },
        ],
        'messages.openui.file.archiveName'
      )
    );
  });
  it('does not offer a bundle for repeated copies of a single file', async () => {
    display('root = Stack([FileCard("a.docx", "A"), FileCard("a.docx", "Again")])');
    await screen.findByText('Again');
    expect(screen.queryByRole('button', { name: 'messages.openui.file.downloadAll' })).toBeNull();
  });
  it('keeps bundle download disabled while the reply is streaming', async () => {
    display('root = Stack([FileCard("a.docx", "A"), FileCard("b.pdf", "B")])', true);
    expect(await screen.findByRole('button', { name: 'messages.openui.file.downloadAll' })).toBeDisabled();
    expect(host.downloadAll).not.toHaveBeenCalled();
  });
  it('shows an actionable bundle-size error and lets the user try again', async () => {
    host.downloadAll.mockRejectedValueOnce(new Error('ZIP_TOO_LARGE'));
    display('root = Stack([FileCard("a.docx", "A"), FileCard("b.pdf", "B")])');
    fireEvent.click(await ready('messages.openui.file.downloadAll'));
    expect(await screen.findByRole('status')).toHaveTextContent('messages.openui.file.bundleTooLarge');
    fireEvent.click(await ready('messages.openui.file.downloadAll'));
    await waitFor(() => expect(host.downloadAll).toHaveBeenCalledTimes(2));
  });
});
describe('SlideOutline', () => {
  const outline =
    'root = Stack([SlideOutline("outline", [{title: "引入", points: ["朗讀第一段"]}, {title: "分析", points: ["父親背影"], visual: "車站插圖"}]), Buttons([Button("確認並製作", @ToAssistant("確認"))])])';
  const slides = () => screen.getAllByRole('group', { name: 'messages.openui.slides.slide' });
  const titles = () =>
    screen
      .getAllByRole('textbox', { name: 'messages.openui.slides.title' })
      .map((input) => (input as HTMLInputElement).value);
  const editable = () =>
    waitFor(() =>
      expect(screen.getAllByRole('textbox', { name: 'messages.openui.slides.title' })[0]).not.toBeDisabled()
    );
  const press = (index: number, name: string) =>
    fireEvent.click(within(slides()[index]).getByRole('button', { name: 'messages.openui.slides.' + name }));
  it('renders numbered slides with their fields', async () => {
    display(outline);
    await editable();
    expect(slides()).toHaveLength(2);
    expect(titles()).toEqual(['引入', '分析']);
    expect(screen.getByDisplayValue('朗讀第一段')).toBeTruthy();
    expect(screen.getByDisplayValue('車站插圖')).toBeTruthy();
  });
  it('sends edited slides to the assistant on confirm', async () => {
    const receive = vi.fn((request) => request.resolve());
    emitter.on('openui.followUp', receive);
    try {
      display(outline);
      await editable();
      fireEvent.change(screen.getByDisplayValue('引入'), { target: { value: '導入' } });
      fireEvent.change(screen.getByDisplayValue('父親背影'), { target: { value: '父親攀月台' } });
      fireEvent.click(screen.getByText('確認並製作'));
      await waitFor(() => expect(receive).toHaveBeenCalled());
      const context = JSON.stringify(receive.mock.calls[0][0].ui_action);
      expect(context).toContain('導入');
      expect(context).toContain('父親攀月台');
    } finally {
      emitter.off('openui.followUp', receive);
    }
  });
  it('moves, removes and adds slides and keeps the order through later edits', async () => {
    display(outline);
    await editable();
    press(1, 'moveUp');
    expect(titles()).toEqual(['分析', '引入']);
    press(0, 'remove');
    expect(titles()).toEqual(['引入']);
    press(0, 'add');
    expect(titles()).toEqual(['引入', '']);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'messages.openui.slides.title' })[1], {
      target: { value: '總結' },
    });
    fireEvent.change(screen.getByDisplayValue('引入'), { target: { value: '導入' } });
    expect(titles()).toEqual(['導入', '總結']);
  });
  it('adds and removes points', async () => {
    display(outline);
    await editable();
    press(0, 'addPoint');
    expect(within(slides()[0]).getAllByRole('textbox', { name: 'messages.openui.slides.points' })).toHaveLength(2);
    fireEvent.click(within(slides()[0]).getAllByRole('button', { name: 'messages.openui.slides.removePoint' })[0]);
    expect(within(slides()[0]).queryByDisplayValue('朗讀第一段')).toBeNull();
  });
  it('disables moving past either end', async () => {
    display(outline);
    await editable();
    expect(within(slides()[0]).getByRole('button', { name: 'messages.openui.slides.moveUp' })).toBeDisabled();
    expect(within(slides()[1]).getByRole('button', { name: 'messages.openui.slides.moveDown' })).toBeDisabled();
  });
  it('keeps edits across a remount from saved state', async () => {
    const first = display(outline);
    await editable();
    fireEvent.change(screen.getByDisplayValue('引入'), { target: { value: '導入' } });
    await waitFor(() => expect(api.saveState).toHaveBeenCalled());
    const saved = api.saveState.mock.calls.at(-1)![2];
    first.unmount();
    api.loadState.mockResolvedValueOnce({ ...initial, state: saved });
    display(outline);
    await editable();
    expect(titles()).toEqual(['導入', '分析']);
  });
  it('enforces the slide and point limits', async () => {
    const many = Array.from({ length: 30 }, (_, index) => `{title: "${index}"}`).join(', ');
    const points = Array.from({ length: 8 }, (_, index) => `"${index}"`).join(', ');
    display(`root = Stack([SlideOutline("outline", [{title: "first", points: [${points}]}, ${many}])])`);
    await editable();
    expect(slides()).toHaveLength(30);
    expect(within(slides()[0]).getByRole('button', { name: 'messages.openui.slides.add' })).toBeDisabled();
    expect(within(slides()[0]).getByRole('button', { name: 'messages.openui.slides.addPoint' })).toBeDisabled();
    expect(screen.getAllByText('messages.openui.slides.limit').length).toBeGreaterThan(0);
  });
  it('shows the suggested slides when a bound variable starts empty', async () => {
    display('root = Stack([SlideOutline("outline", [{title: "引入"}, {title: "分析"}], $outline)])\n$outline = []');
    await editable();
    expect(titles()).toEqual(['引入', '分析']);
  });
  it('keeps an outline the teacher emptied and lets them add a slide again', async () => {
    display(outline);
    await editable();
    press(1, 'remove');
    press(0, 'remove');
    expect(screen.queryAllByRole('group', { name: 'messages.openui.slides.slide' })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'messages.openui.slides.add' }));
    expect(titles()).toEqual(['']);
  });
  it('renders a partially streamed slide read-only', async () => {
    display('root = Stack([SlideOutline("outline", [{title: "引入"}])])', true);
    expect(await screen.findByDisplayValue('引入')).toBeDisabled();
    for (const button of within(slides()[0]).getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('listening draft edits', () => {
  const base = (): ListeningProject => ({
    version: 1,
    title: 't',
    defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
    lexicon: [],
    sections: [
      {
        id: 's1',
        plays: 1,
        gapBetweenPlays: 5,
        gapAfter: 3,
        segments: [
          { id: 'a', type: 'speech', text: '一' },
          { id: 'b', type: 'pause', seconds: 2 },
        ],
      },
    ],
  });
  it('adds, reorders and removes segments and sections with unique ids', () => {
    let project = listeningDraft.addSegment(base(), 's1', 'chime');
    const added = project.sections[0].segments[2];
    expect(added).toMatchObject({ type: 'chime', preset: 'start' });
    expect(added.id).toMatch(/^chime-[\w-]+$/);
    project = listeningDraft.moveSegment(project, 's1', added.id, -1);
    expect(project.sections[0].segments.map((item) => item.id)).toEqual(['a', added.id, 'b']);
    project = listeningDraft.moveSegment(project, 's1', 'a', -1);
    expect(project.sections[0].segments[0].id).toBe('a');
    project = listeningDraft.removeSegment(project, 's1', 'b');
    project = listeningDraft.addSection(project);
    expect(project.sections).toHaveLength(2);
    const ids = project.sections.flatMap((section) => [section.id, ...section.segments.map((item) => item.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    project = listeningDraft.moveSection(project, project.sections[1].id, -1);
    expect(project.sections[1].id).toBe('s1');
    project = listeningDraft.updateSection(project, 's1', { plays: 3 });
    expect(project.sections[1].plays).toBe(3);
    expect(listeningDraft.removeSection(project, 's1').sections).toHaveLength(1);
  });
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(75.4)).toBe('1:15');
    expect(formatDuration(3600)).toBe('60:00');
  });
});

describe('listening track files', () => {
  const project = {
    version: 1,
    title: '中三聆聽',
    defaults: { voice: 'HiuMaan', rate: '+0%', volume: '+0%', pitch: '+0Hz' },
    lexicon: [],
    sections: [
      {
        id: 'part1',
        label: '第一段',
        plays: 2,
        gapBetweenPlays: 5,
        gapAfter: 3,
        segments: [
          { id: 'a1', type: 'speech', speaker: '男', voice: 'WanLung', text: '請問銀行在哪裏？' },
          { id: 'p1', type: 'pause', seconds: 10 },
        ],
      },
    ],
  };
  const completed = {
    id: 't1',
    kind: 'track',
    status: 'completed',
    createdAt: 1,
    updatedAt: 2,
    completedChunks: 3,
    totalChunks: 3,
    durationSeconds: 75,
    projectPath: 'listening/unit.listening.json',
    files: [{ path: 'audio/t1/track.mp3', format: 'mp3' }],
    qaIssues: 1,
    warnings: [],
  };
  const state = (overrides: Record<string, unknown> = {}) => ({
    path: 'listening/unit.listening.json',
    revision: 'r1',
    project,
    qaThreshold: 0.9,
    segments: { a1: { key: 'k1', cached: true, qa: { heard: '請問銀航在哪裏', similarity: 0.83, accepted: false } } },
    tasks: [completed],
    ...overrides,
  });
  const calls = (method: string, route = '') =>
    transport.request.mock.calls.filter(
      ([verb, path]) => verb === method && String(path).startsWith('/api/edu/audio/listening' + route)
    );
  const open = async () => {
    display('root = Stack([FileCard("listening/unit.listening.json", "聆聽項目")])');
    fireEvent.click(
      await waitFor(() => {
        const button = screen.getByRole('button', { name: 'messages.listening.edit' });
        expect(button).not.toBeDisabled();
        return button;
      })
    );
    return screen.findByDisplayValue('請問銀行在哪裏？');
  };
  beforeEach(() => {
    host.preview = { openBrowserTab: vi.fn() };
    host.workspace = '/ws';
    transport.request
      .mockReset()
      .mockImplementation(async (method: string, path: string, body?: { project?: unknown }) => {
        if (!String(path).startsWith('/api/edu/audio/listening')) return {};
        if (method === 'PUT') return state({ revision: 'r2', project: body?.project });
        return state();
      });
  });

  it('plays audio files inline instead of offering a text preview', async () => {
    display('root = Stack([FileCard("audio/t1/track.mp3", "聆聽音檔")])');
    expect(await screen.findByRole('button', { name: 'messages.listening.player.play' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'messages.openui.file.preview' })).toBeNull();
  });

  it('opens the project editor with sections, segment preview, latest track and QA hints', async () => {
    await open();
    expect(calls('GET')[0][1]).toBe(
      '/api/edu/audio/listening?conversation_id=conversation&path=listening%2Funit.listening.json'
    );
    expect(screen.getByDisplayValue('第一段')).toBeTruthy();
    expect(screen.getByDisplayValue('男')).toBeTruthy();
    expect(screen.getByText('messages.listening.qa.heard')).toBeTruthy();
    expect(screen.getByText('messages.listening.status.completed')).toBeTruthy();
    expect(screen.getByText('messages.listening.qa.issues')).toBeTruthy();
    // One player for the latest track and one for the cached line.
    expect(screen.getAllByRole('button', { name: 'messages.listening.player.play' })).toHaveLength(2);
  });

  it('saves edits against the loaded revision', async () => {
    const line = await open();
    fireEvent.change(line, { target: { value: '請問郵局在哪裏？' } });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.save' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const [, , body] = calls('PUT')[0] as [string, string, { revision: string; project: typeof project }];
    expect(body.revision).toBe('r1');
    expect(body.project.sections[0].segments[0]).toMatchObject({ id: 'a1', text: '請問郵局在哪裏？' });
    expect(body.project.sections[0].segments[1]).toEqual({ id: 'p1', type: 'pause', seconds: 10 });
  });

  it('edits and previews original clips and prevents invalid clip saves', async () => {
    const withClip = {
      ...project,
      sections: [
        {
          ...project.sections[0],
          segments: [
            ...project.sections[0].segments,
            { id: 'clip1', type: 'clip', path: 'audio/reference.wav', start: 3, end: 8, note: '原錄音' },
          ],
        },
      ],
    };
    transport.request.mockImplementation(async (_method: string, path: string) =>
      String(path).startsWith('/api/edu/audio/listening') ? state({ project: withClip }) : {}
    );
    await open();
    expect(screen.getAllByRole('button', { name: 'messages.listening.player.play' })).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('messages.listening.fields.clipPath'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.save' }));
    expect(calls('PUT')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('messages.listening.fields.clipPath'), { target: { value: 'another.wav' } });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.save' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    expect(calls('PUT')[0][2]).toMatchObject({
      project: {
        sections: [
          {
            segments: [
              expect.anything(),
              expect.anything(),
              { id: 'clip1', type: 'clip', path: 'another.wav', start: 3, end: 8, note: '原錄音' },
            ],
          },
        ],
      },
    });
  });

  it('blocks saving blank lines and reports a conflicting save', async () => {
    const line = await open();
    fireEvent.change(line, { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.save' }));
    expect(calls('PUT')).toHaveLength(0);
    fireEvent.change(line, { target: { value: '改好了。' } });
    const { BackendHttpError } = await import('@/common/adapter/httpBridge');
    transport.request.mockImplementationOnce(async (method: string, path: string) => {
      throw new BackendHttpError({ method, path, status: 409, body: { error: { code: 'AUDIO_PROJECT_CONFLICT' } } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.save' }));
    expect(await screen.findByText('messages.listening.conflict.content')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.conflict.overwrite' }));
    await waitFor(() => expect(calls('PUT')).toHaveLength(2));
    expect((calls('PUT')[1][2] as { revision: string }).revision).toBe('r1');
  });

  it('accepts a QA reading and starts a render from the editor', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.qa.accept' }));
    await waitFor(() => expect(calls('POST', '/qa')).toHaveLength(1));
    expect(calls('POST', '/qa')[0][2]).toMatchObject({ segment_id: 'a1', accepted: true });
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.render' }));
    await waitFor(() => expect(calls('POST', '/render')).toHaveLength(1));
    expect(calls('PUT')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.previewSection' }));
    await waitFor(() => expect(calls('POST', '/render')).toHaveLength(2));
    expect(calls('POST', '/render')[1][2]).toMatchObject({ only_sections: ['part1'] });
  });

  it('shows render progress with a stop control, including renders started by the assistant', async () => {
    const running = { ...completed, id: 't2', status: 'running', completedChunks: 1, totalChunks: 4 };
    transport.request.mockImplementation(async (_method: string, path: string) =>
      String(path).startsWith('/api/edu/audio/listening') ? state({ tasks: [running, completed] }) : {}
    );
    await open();
    expect(screen.getByText(/messages\.listening\.status\.running/)).toHaveTextContent(
      'messages.listening.status.byAssistant'
    );
    expect(screen.getByRole('button', { name: 'messages.listening.actions.render' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.actions.stop' }));
    await waitFor(() => expect(calls('POST', '/cancel')).toHaveLength(1));
    expect(calls('POST', '/cancel')[0][2]).toMatchObject({ task_id: 't2' });
  });
});

describe('audio playback windows', () => {
  const fetchAudio = vi.fn();
  const objectUrl = vi.fn(() => 'blob:fixture');
  const revoke = vi.fn();
  beforeEach(() => {
    fetchAudio.mockReset().mockResolvedValue(new Response(new Blob(['fixture'])));
    objectUrl.mockClear();
    revoke.mockClear();
    vi.stubGlobal('fetch', fetchAudio);
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = objectUrl;
        static revokeObjectURL = revoke;
      }
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      fireEvent.play(this);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      fireEvent.pause(this);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts at the clip boundary, stops at the end and replays from the start', async () => {
    const { container } = render(<AudioPlayer url='/reference.wav' start={10} end={15} />);
    const audio = container.querySelector('audio')!;
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    await waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
    Object.defineProperty(audio, 'duration', { value: 60, configurable: true });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(10);
    audio.currentTime = 15.7;
    fireEvent.timeUpdate(audio);
    expect(audio.currentTime).toBe(15);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    await waitFor(() => expect(audio.currentTime).toBe(10));
    expect(fetchAudio).toHaveBeenCalledOnce();
  });

  it('discards a pending download when the clip changes', async () => {
    let finish!: (value: Response) => void;
    fetchAudio.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const { rerender } = render(<AudioPlayer url='/old.wav' start={2} end={4} />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    const signal = fetchAudio.mock.calls[0][1].signal as AbortSignal;
    rerender(<AudioPlayer url='/new.wav' start={5} end={8} />);
    await act(async () => {
      finish(new Response(new Blob(['stale'])));
    });
    expect(signal.aborted).toBe(true);
    expect(objectUrl).not.toHaveBeenCalled();
  });

  it('reports a failed download and lets the teacher retry', async () => {
    fetchAudio.mockResolvedValueOnce(new Response('', { status: 404 }));
    render(<AudioPlayer url='/reference.wav' />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    expect(await screen.findByText('messages.listening.player.loadFailed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    await waitFor(() => expect(screen.queryByText('messages.listening.player.loadFailed')).toBeNull());
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it('ignores an old playback rejection after switching clips', async () => {
    let rejectPlay!: (error: Error) => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPlay = reject;
        })
    );
    const { rerender } = render(<AudioPlayer url='/old.wav' start={1} end={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'messages.listening.player.play' }));
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce());
    rerender(<AudioPlayer url='/new.wav' start={2} end={4} />);
    await act(async () => rejectPlay(new Error('Playback was interrupted')));
    expect(screen.queryByText('messages.listening.player.loadFailed')).toBeNull();
  });

  it('does not fetch or play an invalid clip window', () => {
    render(<AudioPlayer url='/reference.wav' start={10} end={5} />);
    expect(screen.getByRole('button', { name: 'messages.listening.player.play' })).toBeDisabled();
    expect(fetchAudio).not.toHaveBeenCalled();
  });
});
