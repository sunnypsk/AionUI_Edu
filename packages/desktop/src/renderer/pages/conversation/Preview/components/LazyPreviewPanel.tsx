import { Button, Spin } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';

class PreviewImportError extends Error {}

const createPanel = () =>
  React.lazy(() =>
    import('./PreviewPanel/PreviewPanel').catch((cause: unknown) => {
      throw new PreviewImportError('Preview code could not be loaded', { cause });
    })
  );
type State = { failed: boolean; reload: boolean; Panel: ReturnType<typeof createPanel> };

function PreviewLoadFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role='alert' className='h-full flex flex-col items-center justify-center gap-12px'>
      <span>{t('common.error')}</span>
      <Button onClick={onRetry}>{t('common.retry')}</Button>
    </div>
  );
}

/** Keep preview loading and failures local to the panel, with its existing mount lifecycle. */
export default class LazyPreviewPanel extends React.Component<Record<string, never>, State> {
  state: State = { failed: false, reload: false, Panel: createPanel() };

  static getDerivedStateFromError(error: unknown): Pick<State, 'failed' | 'reload'> {
    return { failed: true, reload: error instanceof PreviewImportError };
  }

  private retry = (): void => {
    // Browsers cache rejected module imports. A new document can load the repaired chunk.
    if (this.state.reload) {
      window.location.reload();
      return;
    }
    this.setState({ failed: false, reload: false, Panel: createPanel() });
  };

  render(): React.ReactNode {
    if (this.state.failed) return <PreviewLoadFailure onRetry={this.retry} />;
    const { Panel } = this.state;
    return (
      <React.Suspense
        fallback={
          <div data-testid='preview-panel-loading' aria-busy='true' className='h-full flex items-center justify-center'>
            <Spin dot />
          </div>
        }
      >
        <Panel />
      </React.Suspense>
    );
  }
}
