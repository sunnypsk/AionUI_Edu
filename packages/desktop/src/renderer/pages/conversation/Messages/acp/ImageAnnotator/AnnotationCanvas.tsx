/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Input } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontSizeFor, normalizeCrop, rectFromPoints, renderScene, strokeWidthFor } from './drawAnnotations';
import styles from './ImageAnnotator.module.css';
import type { Annotation, AnnotationScene, AnnotationTool, Point, StrokeSize } from './types';

type AnnotationCanvasProps = {
  image: HTMLImageElement;
  scene: AnnotationScene;
  tool: AnnotationTool;
  color: string;
  size: StrokeSize;
  onCommit: (scene: AnnotationScene) => void;
};

type Drag = { start: Point; points: Point[]; current: Point };

/** Draft shape for the in-progress drag, in image-pixel coordinates. */
const draftAnnotation = (tool: AnnotationTool, drag: Drag, color: string, width: number): Annotation | null => {
  switch (tool) {
    case 'brush':
      return { kind: 'stroke', color, width, points: drag.points };
    case 'arrow':
      return { kind: 'arrow', color, width, from: drag.start, to: drag.current };
    case 'rect':
      return { kind: 'rect', color, width, from: drag.start, to: drag.current };
    default:
      return null;
  }
};

/** Canvas that renders the image at natural resolution and turns pointer drags into annotations. */
const AnnotationCanvas: React.FC<AnnotationCanvasProps> = ({ image, scene, tool, color, size, onCommit }) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pendingText, setPendingText] = useState<{ at: Point; value: string } | null>(null);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const strokeWidth = strokeWidthFor(size, width, height);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const draft = drag ? draftAnnotation(tool, drag, color, strokeWidth) : null;
    const cropPreview = drag && tool === 'crop' ? rectFromPoints(drag.start, drag.current) : scene.crop;
    renderScene(
      ctx,
      image,
      width,
      height,
      draft ? [...scene.annotations, draft] : scene.annotations,
      cropPreview,
      true
    );
  }, [image, width, height, scene, drag, tool, color, strokeWidth]);

  // Text placement is abandoned when the user switches away from the text tool.
  useEffect(() => {
    if (tool !== 'text') setPendingText(null);
  }, [tool]);

  const toImagePoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width ? width / rect.width : 1;
    const scaleY = rect.height ? height / rect.height : 1;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  };

  const commitText = (): void => {
    const text = pendingText?.value.trim();
    if (pendingText && text) {
      const annotation: Annotation = {
        kind: 'text',
        color,
        fontSize: fontSizeFor(strokeWidth),
        at: pendingText.at,
        text,
      };
      onCommit({ ...scene, annotations: [...scene.annotations, annotation] });
    }
    setPendingText(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;
    const point = toImagePoint(event);
    if (tool === 'text') {
      // Keep focus in the text input; otherwise its blur would discard the new placement.
      event.preventDefault();
      if (pendingText) commitText();
      setPendingText({ at: point, value: '' });
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ start: point, points: [point], current: point });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drag) return;
    const point = toImagePoint(event);
    setDrag({ ...drag, current: point, points: tool === 'brush' ? [...drag.points, point] : drag.points });
  };

  const handlePointerUp = (): void => {
    if (!drag) return;
    setDrag(null);
    if (tool === 'crop') {
      onCommit({ ...scene, crop: normalizeCrop(drag.start, drag.current, width, height) });
      return;
    }
    const annotation = draftAnnotation(tool, drag, color, strokeWidth);
    if (annotation) onCommit({ ...scene, annotations: [...scene.annotations, annotation] });
  };

  // Position the text input over the click point in CSS pixels.
  const canvas = canvasRef.current;
  const cssScale = canvas && width ? canvas.getBoundingClientRect().width / width : 1;
  const offsetLeft = canvas?.offsetLeft ?? 0;
  const offsetTop = canvas?.offsetTop ?? 0;

  return (
    <div className={styles.stage}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={styles.canvas}
        data-tool={tool}
        data-testid='image-annotator-canvas'
        aria-label={t('acp.image.edit.canvas_aria')}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      />
      {pendingText && (
        <Input
          autoFocus
          size='small'
          className={styles.textInput}
          style={{ left: offsetLeft + pendingText.at.x * cssScale, top: offsetTop + pendingText.at.y * cssScale }}
          placeholder={t('acp.image.edit.text_placeholder')}
          value={pendingText.value}
          onChange={(value) => setPendingText({ ...pendingText, value })}
          onPressEnter={commitText}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setPendingText(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default AnnotationCanvas;
