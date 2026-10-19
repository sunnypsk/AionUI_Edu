import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import Settings from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/Settings';

const api = vi.hoisted(() => ({
  capability: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'teacher' } }) }));
vi.mock('@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/api', () => ({
  openUiCapabilities: api.capability,
  isCompatible: (value: { hash?: string }) => value?.hash === 'compatible',
}));
vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: api.get,
  setClientBusinessSetting: api.set,
}));
beforeEach(() => {
  api.capability.mockReset().mockResolvedValue({ hash: 'compatible' });
  api.get.mockReset().mockResolvedValue(true);
  api.set.mockReset().mockResolvedValue(undefined);
});
const display = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <Settings />
    </SWRConfig>
  );
describe('OpenUI account preference', () => {
  it('saves an explicit opt out through the existing account settings service', async () => {
    api.set.mockImplementationOnce(async () => {
      api.get.mockResolvedValue(false);
    });
    display();
    await screen.findByRole('switch');
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('openuiEnabled', false));
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  });
  it('shows a visible unavailable status and disables the toggle on an old backend', async () => {
    api.capability.mockResolvedValueOnce({ hash: 'old' });
    display();
    expect(await screen.findByRole('status')).toHaveTextContent('messages.openui.unavailable');
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
