/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { MIN_CROP_SIZE, STROKE_SIZE_RATIO } from './types';
import type { Annotation, AnnotationScene, CropRect, Point, StrokeSize } from './types';

/** Dim level applied outside the crop region while editing. */
const CROP_SHADE = 'rgba(0, 0, 0, 0.5)';

/** Resolve a stroke size preset to pixels for an image of the given dimensions. */
export const strokeWidthFor = (size: StrokeSize, imageWidth: number, imageHeight: number): number =>
  Math.max(2, Math.round(Math.max(imageWidth, imageHeight) * STROKE_SIZE_RATIO[size]));

/** Font size for text labels; scales with the selected stroke width. */
export const fontSizeFor = (strokeWidth: number): number => Math.max(14, strokeWidth * 5);

/** Normalize two drag points into a positive-size rectangle. */
export const rectFromPoints = (from: Point, to: Point): CropRect => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y),
});

/** Clamp a crop to the image bounds; returns null when it is too small to be intentional. */
export const normalizeCrop = (from: Point, to: Point, imageWidth: number, imageHeight: number): CropRect | null => {
  const raw = rectFromPoints(from, to);
  const x = Math.max(0, Math.round(raw.x));
  const y = Math.max(0, Math.round(raw.y));
  const width = Math.min(imageWidth, Math.round(raw.x + raw.width)) - x;
  const height = Math.min(imageHeight, Math.round(raw.y + raw.height)) - y;
  if (width < MIN_CROP_SIZE || height < MIN_CROP_SIZE) return null;
  return { x, y, width, height };
};

const drawArrow = (ctx: CanvasRenderingContext2D, from: Point, to: Point, width: number): void => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  ctx.stroke();
};

/** Draw a single annotation in image-pixel coordinates. */
export const drawAnnotation = (ctx: CanvasRenderingContext2D, annotation: Annotation): void => {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (annotation.kind) {
    case 'stroke': {
      const [first, ...rest] = annotation.points;
      if (!first) break;
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      // A single click still leaves a visible dot.
      if (rest.length === 0) ctx.lineTo(first.x + 0.01, first.y);
      for (const point of rest) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      break;
    }
    case 'arrow':
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      drawArrow(ctx, annotation.from, annotation.to, annotation.width);
      break;
    case 'rect': {
      const rect = rectFromPoints(annotation.from, annotation.to);
      ctx.strokeStyle = annotation.color;
      ctx.lineWidth = annotation.width;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      break;
    }
    case 'text':
      ctx.font = `600 ${annotation.fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      // Outline keeps labels legible on both light and dark image regions.
      ctx.lineWidth = Math.max(2, annotation.fontSize / 6);
      ctx.strokeStyle = annotation.color === '#000000' ? '#FFFFFF' : '#000000';
      ctx.strokeText(annotation.text, annotation.at.x, annotation.at.y);
      ctx.fillStyle = annotation.color;
      ctx.fillText(annotation.text, annotation.at.x, annotation.at.y);
      break;
  }
  ctx.restore();
};

/**
 * Paint the image with every annotation at its natural resolution.
 * `showCropOverlay` dims the area outside the crop for the editor view; export crops instead.
 */
export const renderScene = (
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  annotations: Annotation[],
  crop: CropRect | null,
  showCropOverlay: boolean
): void => {
  ctx.clearRect(0, 0, imageWidth, imageHeight);
  ctx.drawImage(image, 0, 0, imageWidth, imageHeight);
  for (const annotation of annotations) drawAnnotation(ctx, annotation);
  if (showCropOverlay && crop) {
    ctx.save();
    ctx.fillStyle = CROP_SHADE;
    ctx.beginPath();
    ctx.rect(0, 0, imageWidth, imageHeight);
    ctx.rect(crop.x, crop.y, crop.width, crop.height);
    ctx.fill('evenodd');
    ctx.restore();
  }
};

/** Flatten the scene into a PNG, applying the crop if one is set. */
export const exportScene = (
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  scene: AnnotationScene
): Promise<Blob> => {
  const crop = scene.crop ?? { x: 0, y: 0, width: imageWidth, height: imageHeight };
  const canvas = document.createElement('canvas');
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'));
  ctx.translate(-crop.x, -crop.y);
  renderScene(ctx, image, imageWidth, imageHeight, scene.annotations, null, false);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode image'))), 'image/png');
  });
};
