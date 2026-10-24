import React, { useEffect, useState } from 'react';
import { InputNumber, Modal, Select, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { listAudioFiles } from '@/renderer/pages/listening/data/workspaceAudio';

export type ClipChoice = { path: string; start: number; end: number };

/** Choose a workspace recording and a window of it to insert as a clip. */
export function ClipPicker({
  visible,
  conversationId,
  workspace,
  initialPath,
  onCancel,
  onPick,
}: {
  visible: boolean;
  conversationId: string;
  workspace?: string;
  initialPath?: string;
  onCancel: () => void;
  onPick: (choice: ClipChoice) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [files, setFiles] = useState<string[]>([]);
  const [choice, setChoice] = useState<ClipChoice>({ path: initialPath ?? '', start: 0, end: 5 });
  useEffect(() => {
    if (!visible || !workspace) return;
    let cancelled = false;
    listAudioFiles(conversationId, workspace)
      .then((found) => {
        if (!cancelled) setFiles(found);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, conversationId, workspace]);
  const options = [...new Set([...(initialPath ? [initialPath] : []), ...files])];
  return (
    <Modal
      visible={visible}
      title={t('messages.listening.clipPicker.title')}
      okButtonProps={{ disabled: !choice.path || choice.end <= choice.start }}
      onCancel={onCancel}
      onOk={() => onPick(choice)}
      unmountOnExit
    >
      <Space direction='vertical' size={12} style={{ width: '100%' }}>
        <Select
          aria-label={t('messages.listening.clipPicker.file')}
          placeholder={t('messages.listening.clipPicker.file')}
          value={choice.path || undefined}
          options={options}
          showSearch
          notFoundContent={t('messages.listening.clipPicker.none')}
          onChange={(path: string) => setChoice((current) => ({ ...current, path }))}
        />
        <Space size={8}>
          <InputNumber
            aria-label={t('messages.listening.fields.clipStart')}
            prefix={t('messages.listening.fields.clipStart')}
            min={0}
            precision={2}
            value={choice.start}
            onChange={(start) => setChoice((current) => ({ ...current, start: start ?? 0 }))}
          />
          <InputNumber
            aria-label={t('messages.listening.fields.clipEnd')}
            prefix={t('messages.listening.fields.clipEnd')}
            min={0}
            precision={2}
            value={choice.end}
            onChange={(end) => setChoice((current) => ({ ...current, end: end ?? current.end }))}
          />
        </Space>
      </Space>
    </Modal>
  );
}
