import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LazyPreviewPanel from '@/renderer/pages/conversation/Preview/components/LazyPreviewPanel';

const panel = vi.hoisted(() => {
  let resolve: () => void = () => {};
  const ready = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { ready, resolve, fail: false };
});

vi.mock('@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewPanel', async () => {
  await panel.ready;
  return {
    default: () => {
      if (panel.fail) throw new Error('preview unavailable');
      return <div data-testid='loaded-preview'>Preview</div>;
    },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  cleanup();
  panel.fail = false;
  vi.restoreAllMocks();
});

describe('preview loading boundary', () => {
  it('keeps the surrounding chat visible while loading only the preview', async () => {
    render(
      <>
        <div>Chat remains visible</div>
        <LazyPreviewPanel />
      </>
    );
    expect(screen.getByText('Chat remains visible')).toBeVisible();
    expect(screen.getByTestId('preview-panel-loading')).toBeVisible();
    await act(async () => {
      panel.resolve();
    });
    expect(await screen.findByTestId('loaded-preview')).toBeVisible();
  });

  it('contains preview failures and retries without replacing the surrounding chat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    panel.fail = true;
    render(
      <>
        <div>Chat remains visible</div>
        <LazyPreviewPanel />
      </>
    );
    expect(await screen.findByRole('alert')).toBeVisible();
    panel.fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(await screen.findByTestId('loaded-preview')).toBeVisible();
    expect(screen.getByText('Chat remains visible')).toBeVisible();
  });
});
