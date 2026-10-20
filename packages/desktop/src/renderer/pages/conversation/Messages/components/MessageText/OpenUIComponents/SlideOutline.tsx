import React from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Delete, Down, Plus, Up } from '@icon-park/react';
import { useIsStreaming, useStateField, type ComponentRenderer } from '@openuidev/react-lang';
import { useTranslation } from 'react-i18next';
import { SLIDE_LIMITS, type Slide, type SlideOutlineProps } from '@/common/openui/components';
import styles from './OpenUIComponents.module.css';

const capped = (slides: Slide[]): Slide[] =>
  slides
    .slice(0, SLIDE_LIMITS.slides)
    .map((slide) => ({ ...slide, points: slide.points?.slice(0, SLIDE_LIMITS.points) }));

/** Editable slide outline; the teacher's edits live in OpenUI state so they persist and reach the follow-up. */
export const SlideOutlineRenderer: ComponentRenderer<SlideOutlineProps> = ({ props }) => {
  const { t } = useTranslation();
  const streaming = useIsStreaming();
  const field = useStateField(props.name, props.value);
  const stored = field.value as Slide[] | undefined;
  // An empty array is a real value (every slide removed); only an unset field falls back to the program.
  const slides = capped(Array.isArray(stored) ? stored : (props.slides ?? []));
  const update = (next: Slide[]) => field.setValue(capped(next));
  const edit = (index: number, change: Partial<Slide>) =>
    update(slides.map((slide, position) => (position === index ? { ...slide, ...change } : slide)));
  const move = (index: number, offset: number) => {
    const next = [...slides];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  };
  const fullSlides = slides.length >= SLIDE_LIMITS.slides;
  return (
    <div className={styles.outline}>
      {slides.map((slide, index) => {
        const points = slide.points ?? [];
        const fullPoints = points.length >= SLIDE_LIMITS.points;
        const setPoints = (next: string[]) => edit(index, { points: next });
        return (
          <div
            key={index}
            role='group'
            aria-label={t('messages.openui.slides.slide', { number: index + 1 })}
            className={styles.slide}
          >
            <div className={styles.slideHeader}>
              <span className={styles.slideNumber}>{t('messages.openui.slides.slide', { number: index + 1 })}</span>
              <div className={styles.slideActions}>
                <Button
                  size='mini'
                  icon={<Up />}
                  aria-label={t('messages.openui.slides.moveUp')}
                  disabled={streaming || index === 0}
                  onClick={() => move(index, -1)}
                />
                <Button
                  size='mini'
                  icon={<Down />}
                  aria-label={t('messages.openui.slides.moveDown')}
                  disabled={streaming || index === slides.length - 1}
                  onClick={() => move(index, 1)}
                />
                <Button
                  size='mini'
                  icon={<Delete />}
                  aria-label={t('messages.openui.slides.remove')}
                  disabled={streaming}
                  onClick={() => update(slides.filter((_, position) => position !== index))}
                />
              </div>
            </div>
            <Input
              aria-label={t('messages.openui.slides.title')}
              value={slide.title}
              disabled={streaming}
              onChange={(title) => edit(index, { title })}
            />
            <div className={styles.points}>
              {points.map((point, position) => (
                <div key={position} className={styles.point}>
                  <Input
                    aria-label={t('messages.openui.slides.points')}
                    value={point}
                    disabled={streaming}
                    onChange={(value) => setPoints(points.map((current, at) => (at === position ? value : current)))}
                  />
                  <Button
                    size='mini'
                    icon={<Delete />}
                    aria-label={t('messages.openui.slides.removePoint')}
                    disabled={streaming}
                    onClick={() => setPoints(points.filter((_, at) => at !== position))}
                  />
                </div>
              ))}
              <Button
                size='mini'
                type='text'
                icon={<Plus />}
                disabled={streaming || fullPoints}
                onClick={() => setPoints([...points, ''])}
              >
                {t('messages.openui.slides.addPoint')}
              </Button>
            </div>
            <Input
              aria-label={t('messages.openui.slides.visual')}
              placeholder={t('messages.openui.slides.visual')}
              value={slide.visual ?? ''}
              disabled={streaming}
              onChange={(visual) => edit(index, { visual })}
            />
            <Input.TextArea
              aria-label={t('messages.openui.slides.notes')}
              placeholder={t('messages.openui.slides.notes')}
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={slide.notes ?? ''}
              disabled={streaming}
              onChange={(notes) => edit(index, { notes })}
            />
            <div className={styles.slideFooter}>
              <Button
                size='mini'
                type='text'
                icon={<Plus />}
                disabled={streaming || fullSlides}
                onClick={() =>
                  update([...slides.slice(0, index + 1), { title: '', points: [] }, ...slides.slice(index + 1)])
                }
              >
                {t('messages.openui.slides.add')}
              </Button>
              {(fullSlides || fullPoints) && <span className={styles.limit}>{t('messages.openui.slides.limit')}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
};
