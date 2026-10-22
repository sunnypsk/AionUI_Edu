import React from 'react';
import { Alert, Form, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import {
  isModelSelectionAvailable,
  selectCatalogModel,
  type CliModel,
  type ModelSelection,
} from '@/common/types/platform/cliModels';

export default function Fields({
  value,
  models,
  disabled,
  onChange,
}: {
  value: ModelSelection;
  models: CliModel[];
  disabled: boolean;
  onChange: (value: ModelSelection) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const selected = models.find((model) => model.id === value.model);
  const options = models.map((model) => ({ value: model.id, label: model.displayName, disabled: model.disabled }));
  if (!selected && value.model) options.unshift({ value: value.model, label: value.model, disabled: true });
  return (
    <>
      {!disabled && !isModelSelectionAvailable(value, models) && (
        <Alert type='warning' content={t('codex.catalog.invalidSelection')} className='mb-12px' />
      )}
      {selected?.disabledReason && <Alert type='info' content={selected.disabledReason} className='mb-12px' />}
      <Form.Item label={t('codex.settings.model')}>
        <Select
          aria-label={t('codex.settings.model')}
          showSearch
          filterOption={(input, option) => {
            const props = option.props as { value?: string; children?: string };
            return `${props.value ?? ''} ${props.children ?? ''}`.toLowerCase().includes(input.trim().toLowerCase());
          }}
          value={value.model}
          disabled={disabled}
          options={options}
          onChange={(id: string) => {
            const next = models.find((m) => m.id === id && !m.disabled);
            if (next) onChange(selectCatalogModel(next, value.reasoningEffort));
          }}
        />
      </Form.Item>
      <Form.Item
        label={t('codex.settings.reasoning')}
        help={selected && !selected.supportedReasoningEfforts.length ? t('codex.catalog.noReasoning') : undefined}
      >
        <Select
          aria-label={t('codex.settings.reasoning')}
          value={value.reasoningEffort ?? undefined}
          disabled={disabled || !selected || selected.disabled || !selected.supportedReasoningEfforts.length}
          options={selected?.supportedReasoningEfforts.map((effort) => ({ value: effort, label: effort })) ?? []}
          onChange={(reasoningEffort: string) => onChange({ ...value, reasoningEffort })}
        />
      </Form.Item>
    </>
  );
}
