import React, { useEffect, useState } from 'react';
import { Button, Input, Message, Modal, Upload } from '@arco-design/web-react';
import { FileText } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { listeningError } from '@/renderer/pages/listening/data/api';
import { errorKey } from '@/renderer/pages/listening/data/status';
import { studioApi } from '@/renderer/pages/studio/data/studioApi';
import styles from '@/renderer/pages/studio/StudioPage.module.css';

/** Text files larger than this are refused before reading; the host limit is the same. */
const MAX_TEXT_BYTES = 600_000;

/** Paste a script or load a .txt file; the host splits it into speech blocks for the timeline. */
export function TextImportModal({
  visible,
  projectId,
  onCancel,
  onAdd,
}: {
  visible: boolean;
  projectId: string;
  onCancel: () => void;
  onAdd: (blocks: string[]) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [message, messageHolder] = Message.useMessage();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const load = async (file: File) => {
    if (file.size > MAX_TEXT_BYTES) {
      message.error?.(t('messages.studio.errors.textTooLarge'));
      return;
    }
    try {
      setText(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
    } catch {
      message.error?.(t('messages.studio.text.notUtf8'));
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      onAdd((await studioApi.text(projectId, text)).blocks);
    } catch (error) {
      message.error?.(t(errorKey(listeningError(error).code)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t('messages.studio.text.title')}
      okText={t('messages.studio.text.add')}
      okButtonProps={{ disabled: !text.trim() }}
      confirmLoading={busy}
      onOk={() => void submit()}
      onCancel={onCancel}
      unmountOnExit
    >
      {messageHolder}
      <div className={styles.textModal}>
        <Upload
          accept='.txt,text/plain'
          showUploadList={false}
          beforeUpload={(file) => {
            void load(file);
            return false;
          }}
        >
          <Button size='small' icon={<FileText />}>
            {t('messages.studio.text.loadFile')}
          </Button>
        </Upload>
        <Input.TextArea
          aria-label={t('messages.studio.text.title')}
          placeholder={t('messages.studio.text.placeholder')}
          autoSize={{ minRows: 8, maxRows: 18 }}
          value={text}
          onChange={setText}
        />
        <span className={styles.hint}>{t('messages.studio.text.hint')}</span>
      </div>
    </Modal>
  );
}
