import { Button, Message, Modal, Space, Typography } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type InstallationIntegrityDialogKind =
  | 'incomplete_installation'
  | 'data_migration'
  | 'database_newer_than_app'
  | 'local_data_repair'
  | 'recoverable_database_corruption'
  | 'transient_concurrent_startup'
  | 'startup_directory'
  | 'backend_exited'
  | 'port_report_timeout'
  | 'startup_failed';

export type InstallationIntegrityDiagnostics = {
  source: 'backend_startup_failure' | 'runtime_status';
  description?: string;
  runtime?: {
    failureKind?: string;
    message?: string;
    phase?: string;
    resource?: string;
    resourceId?: string;
    scopeId?: string;
    scopeKind?: string;
  };
  backendStartupFailure?: Record<string, unknown> | null;
};

/**
 * Per-kind dialog configuration: which `common.backendStartup.*` section the
 * copy lives in, and which footer actions the dialog offers. One row per kind
 * replaces the previous per-suffix ternary chains.
 */
const DIALOG_KIND_CONFIG: Record<
  InstallationIntegrityDialogKind,
  {
    i18nSection: string;
    showRecover?: boolean;
  }
> = {
  incomplete_installation: { i18nSection: 'incompleteInstallation' },
  data_migration: { i18nSection: 'dataMigration' },
  database_newer_than_app: { i18nSection: 'databaseNewerThanApp' },
  local_data_repair: { i18nSection: 'localDataRepair' },
  recoverable_database_corruption: { i18nSection: 'recoverableDatabaseCorruption', showRecover: true },
  transient_concurrent_startup: { i18nSection: 'transientConcurrentStartup' },
  startup_directory: { i18nSection: 'startupDirectory' },
  backend_exited: { i18nSection: 'exited' },
  port_report_timeout: { i18nSection: 'portReportTimeout' },
  startup_failed: { i18nSection: 'startupFailed' },
};

function dialogKindText(t: TFunction, diagnosticsKind: InstallationIntegrityDialogKind, suffix: string): string {
  return t(`common.backendStartup.${DIALOG_KIND_CONFIG[diagnosticsKind].i18nSection}.${suffix}`);
}

export function getInstallationIntegrityTitle(
  t: TFunction,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): string {
  return dialogKindText(t, diagnosticsKind, 'title');
}

export function getBackendStartupInstallationDescription(t: TFunction): string {
  return t('common.backendStartup.incompleteInstallation.description');
}

export function getRuntimeComponentInstallationDescription(t: TFunction, resource: string): string {
  return t('common.backendStartup.incompleteInstallation.runtimeComponentDescription', { resource });
}

/**
 * Resolves the footer actions for a dialog kind. The destructive database
 * recovery action is only offered when a real recovery handler exists; the
 * WebUI host has none, so it never shows a button that would silently no-op.
 */
export function getInstallationIntegrityModalActions(
  t: TFunction,
  options: {
    diagnosticsKind?: InstallationIntegrityDialogKind;
    onRecoverCorruptedDatabase?: () => Promise<unknown> | void;
  } = {}
): {
  onRecoverCorruptedDatabase?: () => Promise<unknown> | void;
  recoverText?: string;
} {
  const diagnosticsKind = options.diagnosticsKind ?? 'incomplete_installation';
  const config = DIALOG_KIND_CONFIG[diagnosticsKind];
  const onRecoverCorruptedDatabase = config.showRecover ? options.onRecoverCorruptedDatabase : undefined;
  return {
    onRecoverCorruptedDatabase,
    recoverText: onRecoverCorruptedDatabase ? dialogKindText(t, diagnosticsKind, 'confirmRebuild') : undefined,
  };
}

function resolveDatabaseRecoveryHandler(): (() => Promise<unknown> | void) | undefined {
  if (typeof window === 'undefined') return undefined;
  const recover = window.electronAPI?.recoverCorruptedDatabase;
  return typeof recover === 'function' ? () => recover() : undefined;
}

export const InstallationIntegrityContent: React.FC<{ description: string }> = ({ description }) => (
  <div className='text-t-1' data-testid='installation-integrity-dialog'>
    <Typography.Paragraph className='mb-0 text-t-secondary' data-testid='installation-integrity-description'>
      {description}
    </Typography.Paragraph>
  </div>
);

export const InstallationIntegrityFooter: React.FC<{
  diagnosticsKind?: InstallationIntegrityDialogKind;
}> = ({ diagnosticsKind = 'incomplete_installation' }) => {
  const { t } = useTranslation();
  const [recovering, setRecovering] = useState(false);
  const actions = getInstallationIntegrityModalActions(t, {
    diagnosticsKind,
    onRecoverCorruptedDatabase: resolveDatabaseRecoveryHandler(),
  });
  const recoverCorruptedDatabase = actions.onRecoverCorruptedDatabase;

  const handleRecoverCorruptedDatabase = () => {
    if (recovering || !recoverCorruptedDatabase) return;
    // Rebuild is destructive (backs up the corrupted DB and creates an empty one),
    // so gate it behind an explicit second confirmation before invoking recovery.
    Modal.confirm({
      title: t('common.backendStartup.recoverableDatabaseCorruption.confirmDialog.title'),
      content: t('common.backendStartup.recoverableDatabaseCorruption.confirmDialog.content'),
      okText: t('common.backendStartup.recoverableDatabaseCorruption.confirmDialog.okText'),
      cancelText: t('common.backendStartup.recoverableDatabaseCorruption.confirmDialog.cancelText'),
      onOk: async () => {
        setRecovering(true);
        try {
          await recoverCorruptedDatabase();
        } catch {
          Message.error(t('common.backendStartup.recoverableDatabaseCorruption.rebuildFailed'));
          setRecovering(false);
        }
      },
    });
  };

  return (
    <Space>
      {actions.recoverText ? (
        <Button
          data-testid='recoverable-database-corruption-rebuild'
          loading={recovering}
          status='danger'
          type='outline'
          onClick={handleRecoverCorruptedDatabase}
        >
          {actions.recoverText}
        </Button>
      ) : null}
    </Space>
  );
};

type InstallationIntegrityModalController = ReturnType<typeof Modal.useModal>[0];

export function showInstallationIntegrityModal(
  modal: InstallationIntegrityModalController,
  t: TFunction,
  description: string,
  diagnostics?: InstallationIntegrityDiagnostics,
  diagnosticsKind: InstallationIntegrityDialogKind = 'incomplete_installation'
): ReturnType<InstallationIntegrityModalController['error']> {
  // Diagnostics stay local: keep the structured failure details in the browser
  // console for troubleshooting instead of uploading them anywhere.
  if (diagnostics) {
    console.error('[InstallationIntegrity]', diagnostics);
  }

  return modal.error({
    title: getInstallationIntegrityTitle(t, diagnosticsKind),
    content: <InstallationIntegrityContent description={description} />,
    footer: <InstallationIntegrityFooter diagnosticsKind={diagnosticsKind} />,
    closable: false,
    maskClosable: false,
  });
}

export const InstallationIntegrityModalHost: React.FC<{
  description: string;
  diagnostics?: InstallationIntegrityDiagnostics;
  diagnosticsKind?: InstallationIntegrityDialogKind;
}> = ({ description, diagnostics, diagnosticsKind = 'incomplete_installation' }) => {
  const [modal, modalContextHolder] = Modal.useModal();
  const { t } = useTranslation();
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current) return;
    shownRef.current = true;
    showInstallationIntegrityModal(modal, t, description, diagnostics, diagnosticsKind);
  }, [description, diagnostics, diagnosticsKind, modal, t]);

  return <>{modalContextHolder}</>;
};
