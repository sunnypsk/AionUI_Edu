import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { errorKey } from '@/renderer/pages/listening/data/status';

export type GenerationContext = {
  status: ReadonlyMap<string, 'running' | 'failed'>;
  disabled: boolean;
  unavailable?: string;
  onGenerate: (segmentId: string) => void;
};

/** Manual generation action shared by script rows, the inspector and timeline blocks. */
export function GenerateButton({
  id,
  generated,
  context,
}: {
  id: string;
  generated: boolean;
  context?: GenerationContext;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!context || generated) return null;
  const status = context.status.get(id);
  const key = status === 'running' ? 'running' : status === 'failed' ? 'retry' : 'one';
  return (
    <Tooltip disabled={!context.unavailable} content={t(errorKey(context.unavailable))}>
      <Button
        size='mini'
        status={status === 'failed' ? 'danger' : undefined}
        loading={status === 'running'}
        disabled={context.disabled || !!context.unavailable || status === 'running'}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          context.onGenerate(id);
        }}
      >
        {t(`messages.listening.generate.${key}`)}
      </Button>
    </Tooltip>
  );
}
