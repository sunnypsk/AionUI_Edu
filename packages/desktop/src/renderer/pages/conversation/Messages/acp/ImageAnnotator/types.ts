/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export type AnnotationTool = 'brush' | 'arrow' | 'rect' | 'text' | 'crop';

export type StrokeSize = 'small' | 'medium' | 'large';

export type Point = { x: number; y: number };

export type CropRect = { x: number; y: number; width: number; height: number };

export type Annotation =
  | { kind: 'stroke'; color: string; width: number; points: Point[] }
  | { kind: 'arrow'; color: string; width: number; from: Point; to: Point }
  | { kind: 'rect'; color: string; width: number; from: Point; to: Point }
  | { kind: 'text'; color: string; fontSize: number; at: Point; text: string };

/** Snapshot of everything the user has drawn; one entry per undo step. */
export type AnnotationScene = {
  annotations: Annotation[];
  crop: CropRect | null;
};

/** Result handed back when the user confirms their edit. */
export type ImageEditResult = {
  original: Blob;
  annotated: Blob;
  instruction: string;
};

/** Annotation colors are user content drawn into the image, not UI chrome. */
export const ANNOTATION_COLORS = ['#F53F3F', '#FF7D00', '#FADC19', '#00B42A', '#165DFF', '#FFFFFF', '#000000'];

/** Stroke width as a fraction of the image's longer side, so marks look the same at any resolution. */
export const STROKE_SIZE_RATIO: Record<StrokeSize, number> = {
  small: 0.004,
  medium: 0.008,
  large: 0.016,
};

export const EMPTY_SCENE: AnnotationScene = { annotations: [], crop: null };

/** Crops smaller than this (in image pixels) are treated as accidental clicks. */
export const MIN_CROP_SIZE = 8;
