import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { defaultLightTheme } from '@openuidev/react-ui';
import OpenUIMessage, {
  OPENUI_DARK_THEME,
  OPENUI_LIGHT_THEME,
} from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI';
import { emitter } from '@/renderer/utils/emitter';
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
}));
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => host.preview,
}));
vi.mock('@/renderer/hooks/file/usePreviewLauncher', () => ({
  usePreviewLauncher: () => ({ launchPreview: host.launch, loading: false, errorKind: host.errorKind }),
}));
vi.mock('@/renderer/utils/file/download', () => ({ downloadFileFromRef: host.download }));
vi.mock('@/renderer/hooks/context/ConversationContext', async (original) => ({
  ...(await original<object>()),
  useConversationContextSafe: () => (host.workspace ? { workspace: host.workspace } : null),
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
  it('renders a partially streamed slide read-only', async () => {
    display('root = Stack([SlideOutline("outline", [{title: "引入"}])])', true);
    expect(await screen.findByDisplayValue('引入')).toBeDisabled();
    for (const button of within(slides()[0]).getAllByRole('button')) expect(button).toBeDisabled();
  });
});
