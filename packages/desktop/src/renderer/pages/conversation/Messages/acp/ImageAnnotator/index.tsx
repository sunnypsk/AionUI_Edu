/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Modal, Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AnnotationCanvas from './AnnotationCanvas';
import AnnotatorToolbar from './AnnotatorToolbar';
import { exportScene } from './drawAnnotations';
import styles from './ImageAnnotator.module.css';
import { ANNOTATION_COLORS, EMPTY_SCENE } from './types';
import type { AnnotationTool, ImageEditResult, StrokeSize } from './types';
import { useAnnotationHistory } from './useAnnotationHistory';

type ImageAnnotatorModalProps = {
  visible: boolean;
  /** Same-origin URL of the image to edit; it is fetched as a blob so the canvas stays exportable. */
  src: string;
  title?: string;
  onCancel: () => void;
  onSubmit: (result: ImageEditResult) => Promise<void>;
};

type LoadedImage = { element: HTMLImageElement; blob: Blob; objectUrl: string };

const loadImage = async (src: string): Promise<LoadedImage> => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const element = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      element.addEventListener('load', () => resolve(), { once: true });
      element.addEventListener('error', () => reject(new Error('Image decode failed')), { once: true });
      element.src = objectUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return { element, blob, objectUrl };
};

/** Modal editor for marking up an image with brush, arrows, boxes, labels and crop. */
const ImageAnnotatorModal: React.FC<ImageAnnotatorModalProps> = ({ visible, src, title, onCancel, onSubmit }) => {
  const { t } = useTranslation();
  const history = useAnnotationHistory();
  const { reset } = history;
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>('brush');
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);
  const [size, setSize] = useState<StrokeSize>('medium');
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let current: LoadedImage | null = null;
    reset();
    setInstruction('');
    setLoaded(null);
    setLoadError(false);
    loadImage(src)
      .then((image) => {
        if (cancelled) {
          URL.revokeObjectURL(image.objectUrl);
          return;
        }
        current = image;
        setLoaded(image);
      })
      .catch((error) => {
        console.error('[ImageAnnotator] Failed to load image:', error);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current.objectUrl);
    };
  }, [visible, src, reset]);

  const hasEdits = history.scene.annotations.length > 0 || history.scene.crop !== null;

  const handleSubmit = async (): Promise<void> => {
    if (!loaded) return;
    setSubmitting(true);
    try {
      const { element } = loaded;
      const annotated = await exportScene(element, element.naturalWidth, element.naturalHeight, history.scene);
      await onSubmit({ original: loaded.blob, annotated, instruction: instruction.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={title ?? t('acp.image.edit.title')}
      onCancel={onCancel}
      style={{ width: 'min(1100px, 94vw)' }}
      maskClosable={false}
      unmountOnExit
      footer={
        <>
          <Button onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type='primary'
            loading={submitting}
            disabled={!loaded || (!hasEdits && !instruction.trim())}
            onClick={handleSubmit}
          >
            {t('acp.image.edit.submit')}
          </Button>
        </>
      }
    >
      <AnnotatorToolbar
        tool={tool}
        color={color}
        size={size}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        canClear={hasEdits}
        onToolChange={setTool}
        onColorChange={setColor}
        onSizeChange={setSize}
        onUndo={history.undo}
        onRedo={history.redo}
        onClear={() => history.commit(EMPTY_SCENE)}
      />
      {loaded ? (
        <AnnotationCanvas
          image={loaded.element}
          scene={history.scene}
          tool={tool}
          color={color}
          size={size}
          onCommit={history.commit}
        />
      ) : (
        <div className={styles.stage}>
          {loadError ? <span className='text-t-secondary text-sm'>{t('acp.image.edit.load_error')}</span> : <Spin />}
        </div>
      )}
      <Input.TextArea
        className={styles.instruction}
        placeholder={t('acp.image.edit.instruction_placeholder')}
        autoSize={{ minRows: 2, maxRows: 5 }}
        value={instruction}
        onChange={setInstruction}
      />
    </Modal>
  );
};

export default ImageAnnotatorModal;
