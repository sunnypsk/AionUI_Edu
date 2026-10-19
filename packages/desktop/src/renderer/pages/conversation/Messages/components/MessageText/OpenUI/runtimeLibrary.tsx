import React, { useId, useLayoutEffect, useRef } from 'react';
import { EditableTable, EditableTableChangesBar, openuiLibrary, useTheme } from '@openuidev/react-ui';
import {
  useGetFieldValue,
  useSetFieldValue,
  useIsStreaming,
  useTriggerAction,
  useStateField,
  type ComponentRenderProps,
  type Library,
} from '@openuidev/react-lang';
import { useTranslation } from 'react-i18next';
import { AccessibleDatePicker, serializeCalendarDate } from './DatePicker';
import styles from './OpenUI.module.css';

type Data = Array<{ id: string; values: Array<string | number> }>;
type Props = { name: string; columns: React.ComponentProps<typeof EditableTable>['columns']; data: Data };
type Draft = { rows: Data; baseline: Data };
const DRAFT_PREFIX = '__aionui_table_draft:';
const OfficialModalRenderer = openuiLibrary.components.Modal.component;
const tableDate = (value: string | number | undefined): string | number | undefined =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00' : value;

/** Keep focus in an active official modal, allow its own popovers, and restore the opener. */
function AccessibleModal({
  props,
  renderNode,
}: ComponentRenderProps<{ title: string; open: unknown; size?: 'sm' | 'md' | 'lg'; children?: unknown }>) {
  const field = useStateField('open', props.open);
  const currentField = useRef(field);
  currentField.current = field;
  const streaming = useIsStreaming();
  const open = !streaming && (field.value === true || field.value === 'true');
  const anchor = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { portalThemeClassName } = useTheme();
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = anchor.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = dialog.querySelector<HTMLElement>('.openui-modal-title');
    if (title) {
      title.id = titleId;
      dialog.setAttribute('aria-labelledby', titleId);
    }
    const topmost = () => Array.from(document.querySelectorAll('.openui-modal-content')).at(-1) === dialog;
    const inPopover = (target: HTMLElement) => {
      const portal = portalThemeClassName ? target.closest('.' + portalThemeClassName) : null;
      return !dialog.contains(target) && Boolean(portal && !portal.classList.contains('openui-modal-root'));
    };
    const focus = (event: FocusEvent) => {
      if (
        !topmost() ||
        !(event.target instanceof HTMLElement) ||
        dialog.contains(event.target) ||
        inPopover(event.target)
      )
        return;
      dialog.focus();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!topmost()) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && inPopover(active)) {
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        currentField.current.setValue(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.closest('[inert], [hidden], [aria-hidden="true"]') &&
          getComputedStyle(element).display !== 'none' &&
          getComputedStyle(element).visibility !== 'hidden'
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (
        !first ||
        !last ||
        active === dialog ||
        !dialog.contains(active) ||
        (event.shiftKey ? active === first : active === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        if (!first) dialog.focus();
      }
    };
    document.addEventListener('focusin', focus, true);
    document.addEventListener('keydown', keyboard, true);
    const popupKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof HTMLElement && inPopover(event.target))
        event.stopPropagation();
    };
    document.body.addEventListener('keydown', popupKeyboard);
    return () => {
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('keydown', keyboard, true);
      document.body.removeEventListener('keydown', popupKeyboard);
      if (opener?.isConnected) opener.focus();
    };
  }, [open, titleId, portalThemeClassName]);
  return streaming ? null : (
    <OfficialModalRenderer
      props={props}
      renderNode={(children) => (
        <div ref={anchor} className='contents'>
          {renderNode(children)}
        </div>
      )}
    />
  );
}

function isData(value: unknown): value is Data {
  return (
    Array.isArray(value) &&
    value.every((row: unknown) => {
      if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string' || !('values' in row))
        return false;
      return (
        Array.isArray(row.values) &&
        row.values.every((cell: unknown) => typeof cell === 'string' || typeof cell === 'number')
      );
    })
  );
}

function isDraft(value: unknown): value is Draft {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'rows' in value &&
    'baseline' in value &&
    isData(value.rows) &&
    isData(value.baseline)
  );
}

/** Keep the official grid and save/reset semantics while persisting cell drafts before submission. */
function SavedEditableTable({ props }: ComponentRenderProps<Props>) {
  const { t } = useTranslation();
  const get = useGetFieldValue();
  const set = useSetFieldValue();
  const streaming = useIsStreaming();
  const trigger = useTriggerAction();
  const draftKey = DRAFT_PREFIX + props.name;
  const candidate: unknown = get(props.name, draftKey);
  const committed: unknown = get(props.name, props.name);
  const draft = isDraft(candidate) ? candidate : undefined;
  const baseline = draft?.baseline ?? (isData(committed) ? committed : props.data);
  const rows = draft?.rows ?? baseline;
  const original = new Map(baseline.map((row) => [row.id, row.values]));
  const changes = rows.reduce(
    (count, row) => count + row.values.filter((value, index) => value !== original.get(row.id)?.[index]).length,
    0
  );
  const saveDraft = (next: Data, saved = baseline) => {
    if (!streaming) set(props.name, 'EditableTableDraft', draftKey, { rows: next, baseline: saved });
  };
  return (
    <>
      <EditableTable
        columns={props.columns}
        data={rows.map((row) => ({
          id: row.id,
          ...Object.fromEntries(
            props.columns.map((column, index) => [
              column.key,
              column.type === 'date-single' ? tableDate(row.values[index]) : row.values[index],
            ])
          ),
        }))}
        onDataChange={(next) =>
          saveDraft(
            next.map((row) => ({
              id: row.id,
              values: props.columns.map((column, index) => {
                const value: unknown = row[column.key];
                if (column.type === 'date-single') {
                  const previous = rows.find((item) => item.id === row.id)?.values[index];
                  if (value === tableDate(previous)) return previous ?? '';
                  if (typeof value === 'string' || typeof value === 'number') {
                    const date = new Date(value);
                    if (!Number.isNaN(date.getTime())) return serializeCalendarDate(date) ?? '';
                  }
                }
                return typeof value === 'string' || typeof value === 'number' ? value : '';
              }),
            }))
          )
        }
      />
      <EditableTableChangesBar
        className={styles.tableChanges}
        changedCellCount={changes}
        onReset={() => saveDraft(baseline)}
        onSave={() => {
          if (streaming) return;
          set(props.name, 'EditableTable', props.name, rows);
          saveDraft(rows, rows);
          trigger(t('messages.openui.followUp'), props.name);
        }}
      />
    </>
  );
}

/** Replace only the rendering adapter; both official registries and their schema/prompt identities stay intact. */
export function withWebUiAdapters(library: Library): Library {
  const table = library.components.EditableTable;
  if (!table) return library;
  return {
    ...library,
    components: {
      ...library.components,
      EditableTable: { ...table, component: SavedEditableTable },
      DatePicker: { ...library.components.DatePicker, component: AccessibleDatePicker },
      ...(library.components.Modal ? { Modal: { ...library.components.Modal, component: AccessibleModal } } : {}),
    },
  };
}
