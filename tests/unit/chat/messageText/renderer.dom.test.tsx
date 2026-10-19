import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import OpenUIMessage from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI';
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
vi.mock('@/renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  useOptionalPreviewContext: () => null,
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
  it('shows source access and an unavailable status for an incompatible backend', async () => {
    api.openUiCapabilities.mockResolvedValueOnce({ hash: 'old' });
    display(program);
    await screen.findByText('messages.openui.unavailable');
    expect(screen.queryByPlaceholderText('Enter topic')).toBeNull();
    fireEvent.click(screen.getByText('messages.openui.source'));
    expect(document.querySelector('pre')?.textContent).toBe(program);
  });
});
