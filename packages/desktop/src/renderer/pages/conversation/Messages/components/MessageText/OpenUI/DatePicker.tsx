import React, { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { DatePicker } from '@openuidev/react-ui';
import {
  parseStructuredRules,
  useFormValidation,
  useIsStreaming,
  useStateField,
  type ComponentRenderProps,
} from '@openuidev/react-lang';
import { useTranslation } from 'react-i18next';
import styles from './OpenUI.module.css';

type Props = {
  name: string;
  mode?: 'single' | 'range';
  rules?: Parameters<typeof parseStructuredRules>[0];
  value?: unknown;
};

// Calendar dates have no timezone; preserve the selected day across devices.
/** Serialize a calendar day without shifting it to another device's timezone. */
export const serializeCalendarDate = (date?: Date): string | undefined =>
  date &&
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function dateValue(value: unknown): Date | undefined {
  if (!(value instanceof Date) && typeof value !== 'string') return undefined;
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Hydrate JSON dates and provide an Arco keyboard trigger for the official calendar/portal. */
export function AccessibleDatePicker({ props }: ComponentRenderProps<Props>) {
  const { t, i18n } = useTranslation();
  const field = useStateField(props.name, props.value);
  const streaming = useIsStreaming();
  const validation = useFormValidation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const rangeSelections = useRef(0);
  const popupId = useId();
  const range = props.mode === 'range';
  const value = field.value;
  const from =
    range && value && typeof value === 'object' && 'from' in value ? dateValue(value.from) : dateValue(value);
  const to = range && value && typeof value === 'object' && 'to' in value ? dateValue(value.to) : undefined;
  const placeholder = t(range ? 'messages.openui.selectDateRange' : 'messages.openui.selectDate');
  const format = (date: Date) =>
    new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  const label = from ? (range && to ? `${format(from)} – ${format(to)}` : format(from)) : placeholder;
  const rules = React.useMemo(() => parseStructuredRules(props.rules), [props.rules]);
  useEffect(() => {
    if (streaming || !validation || !rules.length) return;
    validation.registerField(field.name, rules, () => field.value);
    return () => validation.unregisterField(field.name);
  }, [streaming, validation, rules, field.name, field.value]);
  useEffect(() => {
    if (!open || streaming) return;
    const frame = requestAnimationFrame(() => {
      const popup = [...document.querySelectorAll<HTMLElement>('.openui-date-picker-renderer-floating-content')].at(-1);
      if (!popup) return;
      popup.id = popupId;
      popup.setAttribute('role', 'dialog');
      popup.setAttribute('aria-label', placeholder);
      popup
        .querySelector<HTMLElement>(
          '[aria-selected="true"] button, .openui-calendar-single-day-button:not([disabled]), .openui-calendar-range-day-button:not([disabled])'
        )
        ?.focus();
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, streaming, popupId, placeholder]);
  useEffect(() => {
    if (streaming) setOpen(false);
  }, [streaming]);
  useEffect(() => {
    if (!open) rangeSelections.current = 0;
  }, [open]);
  const select = (next: unknown, close: boolean) => {
    if (streaming) return;
    field.setValue(next);
    validation?.validateField(field.name, next, rules);
    if (close) {
      setOpen(false);
      trigger.current?.focus();
    }
  };
  return (
    <div className={styles.datePicker}>
      <Button
        ref={trigger}
        id={field.name}
        className='w-full justify-start'
        disabled={streaming}
        aria-haspopup='dialog'
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </Button>
      <DatePicker
        mode={range ? 'range' : 'single'}
        isOpen={open && !streaming}
        setIsOpen={setOpen}
        selectedSingleDate={range ? undefined : from}
        selectedRangeDates={range && from ? { from, to } : undefined}
        setSelectedSingleDate={(date) => select(serializeCalendarDate(date), true)}
        setSelectedRangeDates={(dates) =>
          select(
            dates ? { from: serializeCalendarDate(dates.from), to: serializeCalendarDate(dates.to) } : undefined,
            ++rangeSelections.current >= 2 && Boolean(dates?.from && dates.to)
          )
        }
      />
    </div>
  );
}
