import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SpecialistTasks from '@/renderer/pages/conversation/platforms/acp/SpecialistTasks';
import type { useSpecialists } from '@/renderer/pages/conversation/platforms/acp/SpecialistTasks/useSpecialists';
import type { SpecialistStatus, SpecialistTask } from '@/common/types/platform/specialists';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
  }),
}));

const task = (id: string, model: string, status: SpecialistStatus): SpecialistTask => ({
  id,
  specialist: 'argon',
  model,
  reasoningEffort: 'low',
  createdAt: 0,
  runs: [{ id: id + '-run', status, text: '', createdAt: 0 }],
});

const show = (tasks: SpecialistTask[]) =>
  render(
    <SpecialistTasks
      conversationId='conv-1'
      state={{ tasks, running: false, error: null, cancel: vi.fn() } as unknown as ReturnType<typeof useSpecialists>}
    />
  );

describe('SpecialistTasks', () => {
  it('collapses finished tasks behind a summary until expanded', () => {
    show([task('task-1', 'writer-a', 'completed'), task('task-2', 'writer-b', 'failed')]);
    const toggle = screen.getByRole('button', { expanded: false });
    expect(toggle).toHaveTextContent('codex.specialists.summaryDone {"count":2}');
    expect(screen.queryByText(/writer-a/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/writer-a/)).toBeInTheDocument();
    expect(screen.getByText(/writer-b/)).toBeInTheDocument();
  });

  it('counts running tasks in the collapsed summary', () => {
    show([task('task-1', 'writer-a', 'running'), task('task-2', 'writer-b', 'completed')]);
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent(
      'codex.specialists.summaryRunning {"running":1,"count":2}'
    );
  });

  it('renders nothing without tasks', () => {
    const { container } = show([]);
    expect(container).toBeEmptyDOMElement();
  });
});
