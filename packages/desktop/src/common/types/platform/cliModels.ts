/** Browser-safe model metadata advertised by the active CLI. */
export type CliModel = {
  id: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  disabled: boolean;
  disabledReason?: string;
  isDefault?: boolean;
};

export type CliModelCatalog = { models: CliModel[]; version: string; fetchedAt: string };
export type ModelSelection = { model: string; reasoningEffort: string | null };

/** Validate selections against capabilities, never a client-maintained model/effort list. */
export function isModelSelectionAvailable(selection: ModelSelection, models: CliModel[]): boolean {
  const model = models.find((item) => item.id === selection.model && !item.disabled);
  return (
    !!model &&
    (model.supportedReasoningEfforts.length
      ? selection.reasoningEffort !== null && model.supportedReasoningEfforts.includes(selection.reasoningEffort)
      : selection.reasoningEffort === null)
  );
}

/** Keep a compatible effort, otherwise use only the selected model's advertised default. */
export function selectCatalogModel(model: CliModel, previous: string | null): ModelSelection {
  return {
    model: model.id,
    reasoningEffort: !model.supportedReasoningEfforts.length
      ? null
      : previous !== null && model.supportedReasoningEfforts.includes(previous)
        ? previous
        : model.defaultReasoningEffort,
  };
}
