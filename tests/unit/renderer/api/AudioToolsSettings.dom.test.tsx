import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AudioToolsSettings from '@/renderer/components/settings/SettingsModal/contents/AudioToolsSettings';
import { audioToolsApi } from '@/renderer/components/settings/SettingsModal/contents/AudioToolsSettings/api';

const auth = vi.hoisted(() => ({ user: { id: 'alice' } }));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => auth }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return { ...actual, Message: { ...actual.Message, success: vi.fn(), error: vi.fn() } };
});
vi.mock('@/renderer/components/base/AionSelect', () => ({
  default: (props: { value: string; onChange: (value: string) => void; 'aria-label': string }) => (
    <input
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/AudioToolsSettings/api', () => ({
  audioToolsApi: { settings: vi.fn(), save: vi.fn(), models: vi.fn() },
}));
const show = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AudioToolsSettings />
    </SWRConfig>
  );

describe('audio tools settings', () => {
  beforeEach(() => {
    auth.user = { id: 'alice' };
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.clearAllMocks();
    vi.mocked(audioToolsApi.settings).mockResolvedValue({ model: 'google/gemini-3.8-flash', hasApiKey: true });
    vi.mocked(audioToolsApi.models).mockResolvedValue({ models: [], fetchedAt: Date.now() });
    vi.mocked(audioToolsApi.save).mockResolvedValue({ model: 'other/audio', hasApiKey: true });
  });
  it('loads the default model and saves a manually entered model with a replacement key', async () => {
    show();
    await screen.findByText('settings.audioTools.keyConfigured');
    const key = screen.getByLabelText('settings.audioTools.apiKey');
    expect(key).toHaveValue('');
    fireEvent.change(screen.getByLabelText('settings.audioTools.model'), { target: { value: 'other/audio' } });
    fireEvent.change(key, { target: { value: 'fixture-new-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() =>
      expect(audioToolsApi.save).toHaveBeenCalledWith({ model: 'other/audio', apiKey: 'fixture-new-key' })
    );
    await waitFor(() => expect(key).toHaveValue(''));
  });
  it('clears the key explicitly while preserving the selected model', async () => {
    vi.mocked(audioToolsApi.save).mockResolvedValue({ model: 'google/gemini-3.8-flash', hasApiKey: false });
    show();
    await screen.findByText('settings.audioTools.keyConfigured');
    fireEvent.click(screen.getByRole('button', { name: 'settings.audioTools.clearKey' }));
    await screen.findByText('settings.audioTools.keyMissing');
    expect(audioToolsApi.save).toHaveBeenCalledWith({ model: 'google/gemini-3.8-flash', clearApiKey: true });
  });
  it('keeps the saved model editable when catalog refresh fails', async () => {
    vi.mocked(audioToolsApi.models).mockRejectedValue(new Error('fixture catalog error'));
    show();
    await screen.findByText('settings.audioTools.catalogFailed');
    expect(screen.getByLabelText('settings.audioTools.model')).toHaveValue('google/gemini-3.8-flash');
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
  });
  it('clears unsaved credentials and reloads settings when the signed-in user changes', async () => {
    const view = show();
    await screen.findByText('settings.audioTools.keyConfigured');
    fireEvent.change(screen.getByLabelText('settings.audioTools.apiKey'), { target: { value: 'unsaved-alice-key' } });
    auth.user = { id: 'bob' };
    vi.mocked(audioToolsApi.settings).mockResolvedValue({ model: 'other/audio', hasApiKey: false });
    view.rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AudioToolsSettings />
      </SWRConfig>
    );
    await screen.findByText('settings.audioTools.keyMissing');
    expect(screen.getByLabelText('settings.audioTools.apiKey')).toHaveValue('');
    expect(screen.getByLabelText('settings.audioTools.model')).toHaveValue('other/audio');
  });
});
