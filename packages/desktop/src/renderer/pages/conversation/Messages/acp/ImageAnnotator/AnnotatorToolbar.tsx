/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Divider, Radio, Tooltip } from '@arco-design/web-react';
import { ArrowRightUp, Clear, Cutting, Pencil, RectangleOne, Redo, Text, Undo } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ImageAnnotator.module.css';
import { ANNOTATION_COLORS } from './types';
import type { AnnotationTool, StrokeSize } from './types';

type AnnotatorToolbarProps = {
  tool: AnnotationTool;
  color: string;
  size: StrokeSize;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onToolChange: (tool: AnnotationTool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: StrokeSize) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
};

const TOOL_ICONS: Record<AnnotationTool, React.ReactNode> = {
  brush: <Pencil size='16' />,
  arrow: <ArrowRightUp size='16' />,
  rect: <RectangleOne size='16' />,
  text: <Text size='16' />,
  crop: <Cutting size='16' />,
};

const TOOLS: AnnotationTool[] = ['brush', 'arrow', 'rect', 'text', 'crop'];
const SIZES: StrokeSize[] = ['small', 'medium', 'large'];

const AnnotatorToolbar: React.FC<AnnotatorToolbarProps> = ({
  tool,
  color,
  size,
  canUndo,
  canRedo,
  canClear,
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onRedo,
  onClear,
}) => {
  const { t } = useTranslation();
  return (
    <div className={styles.toolbar} role='toolbar' aria-label={t('acp.image.edit.toolbar_aria')}>
      <Radio.Group type='button' size='small' value={tool} onChange={(value: AnnotationTool) => onToolChange(value)}>
        {TOOLS.map((item) => (
          <Tooltip key={item} content={t(`acp.image.edit.tools.${item}` as const)}>
            <Radio value={item} aria-label={t(`acp.image.edit.tools.${item}` as const)}>
              <span className='flex items-center h-full'>{TOOL_ICONS[item]}</span>
            </Radio>
          </Tooltip>
        ))}
      </Radio.Group>
      <Divider type='vertical' />
      <div className='flex items-center gap-4px'>
        {ANNOTATION_COLORS.map((swatch) => (
          <Button
            key={swatch}
            size='mini'
            shape='circle'
            type={swatch === color ? 'outline' : 'text'}
            aria-label={t('acp.image.edit.color_aria', { color: swatch })}
            aria-pressed={swatch === color}
            onClick={() => onColorChange(swatch)}
            icon={<span className={styles.swatch} style={{ backgroundColor: swatch }} />}
          />
        ))}
      </div>
      <Divider type='vertical' />
      <Radio.Group type='button' size='small' value={size} onChange={(value: StrokeSize) => onSizeChange(value)}>
        {SIZES.map((item) => (
          <Radio key={item} value={item}>
            {t(`acp.image.edit.sizes.${item}` as const)}
          </Radio>
        ))}
      </Radio.Group>
      <Divider type='vertical' />
      <Tooltip content={t('acp.image.edit.undo')}>
        <Button
          size='small'
          type='text'
          aria-label={t('acp.image.edit.undo')}
          disabled={!canUndo}
          icon={<Undo size='16' />}
          onClick={onUndo}
        />
      </Tooltip>
      <Tooltip content={t('acp.image.edit.redo')}>
        <Button
          size='small'
          type='text'
          aria-label={t('acp.image.edit.redo')}
          disabled={!canRedo}
          icon={<Redo size='16' />}
          onClick={onRedo}
        />
      </Tooltip>
      <Tooltip content={t('acp.image.edit.clear')}>
        <Button
          size='small'
          type='text'
          aria-label={t('acp.image.edit.clear')}
          disabled={!canClear}
          icon={<Clear size='16' />}
          onClick={onClear}
        />
      </Tooltip>
    </div>
  );
};

export default AnnotatorToolbar;
