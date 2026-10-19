import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createParser, Renderer } from '@openuidev/react-lang';
import { ThemeProvider } from '@openuidev/react-ui';
import { catalogFixtures } from './fixtures';
import { withWebUiAdapters } from '@/renderer/pages/conversation/Messages/components/MessageText/OpenUI/runtimeLibrary';

// JSDOM has no canvas layout or media queries; keep the official components real.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (value: string) => ({ width: value.length * 7 }),
  } as CanvasRenderingContext2D);
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    })
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['openui', 'openui-chat'] as const)('%s official component catalog', (profile) => {
  const { library, fixtures } = catalogFixtures(profile);
  const parser = createParser(library.toJSONSchema(), library.root);
  it('has an explicit, referenced sample program for every registry entry', () => {
    expect(fixtures.flatMap((fixture) => fixture.names).toSorted()).toEqual(Object.keys(library.components).toSorted());
    for (const fixture of fixtures) {
      for (const name of fixture.names) expect(fixture.program, name).toContain(name + '(');
    }
  });
  it.each(fixtures)('parses $id without missing, incomplete, or unused statements', ({ program }) => {
    const result = parser.parse(program);
    expect(result.meta).toMatchObject({ errors: [], incomplete: false, unresolved: [], orphaned: [] });
  });
  it.each(fixtures)('mounts the official $id renderers without component errors', async ({ program }) => {
    const errors = vi.fn();
    const result = render(
      <ThemeProvider>
        <Renderer library={library} response={program} onError={errors} />
      </ThemeProvider>
    );
    await waitFor(() => expect(errors).toHaveBeenCalled());
    expect(result.container.querySelector('*')).not.toBeNull();
    expect(errors.mock.calls.flatMap(([items]) => items)).toEqual([]);
  });
  it('switches tab content through the official tab runtime', async () => {
    render(
      <ThemeProvider>
        <Renderer library={library} response={fixtures[1].program} />
      </ThemeProvider>
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Li Bai' }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByText('Moonlight')).toBeVisible());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Du Fu' }), { button: 0, ctrlKey: false });
    await waitFor(() => expect(screen.getByText('Spring')).toBeVisible());
  });
  if (profile === 'openui')
    it('opens and closes a reactive modal with its official controls', async () => {
      render(
        <ThemeProvider>
          <Renderer library={library} response={fixtures[6].program} />
        </ThemeProvider>
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Open lesson' }));
      expect(await screen.findByRole('dialog')).toHaveTextContent('Modal poem');
      expect(screen.getByRole('dialog').closest('.openui-modal-root')?.className).toContain('openui-theme-portal-');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  else
    it('forwards a chat follow-up suggestion through the official action runtime', async () => {
      const action = vi.fn();
      render(
        <ThemeProvider>
          <Renderer library={library} response={fixtures[6].program} onAction={action} />
        </ThemeProvider>
      );
      fireEvent.click(screen.getByText('Compare poets'));
      await waitFor(() =>
        expect(action).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'continue_conversation', humanFriendlyMessage: 'Compare poets' })
        )
      );
    });
  it('reports unknown components for a correction instead of accepting arbitrary code', () => {
    const result = parser.parse('root = UnknownClass("value")');
    expect(result.meta.errors.length).toBeGreaterThan(0);
  });
  it('restores an unsubmitted table draft with its original reset baseline', async () => {
    const tableLibrary = withWebUiAdapters(library);
    let saved: Record<string, unknown> = {};
    const action = vi.fn();
    const program = fixtures.find((fixture) => fixture.names.includes('EditableTable'))!.program;
    const result = render(
      <ThemeProvider>
        <Renderer
          library={tableLibrary}
          response={program}
          onStateUpdate={(state) => {
            saved = state;
          }}
          onAction={action}
        />
      </ThemeProvider>
    );
    fireEvent.click(screen.getByText('Learner'));
    fireEvent.click(screen.getByText('Learner'));
    const input = screen.getByDisplayValue('Learner');
    fireEvent.change(input, { target: { value: 'Draft learner' } });
    fireEvent.blur(input);
    await waitFor(() => expect(saved.results).toBeDefined());
    expect(JSON.stringify(saved)).not.toContain('T00:00:00');
    result.unmount();
    render(
      <ThemeProvider>
        <Renderer library={tableLibrary} response={program} initialState={saved} onAction={action} />
      </ThemeProvider>
    );
    expect(await screen.findByText('Draft learner')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(await screen.findByText('Learner')).toBeVisible();
    expect(action).not.toHaveBeenCalled();
  });
  it('hydrates a JSON date range and restores keyboard focus after dismissing its calendar', async () => {
    const adapted = withWebUiAdapters(library);
    const program = `root = ${library.root}([Form("lesson", Buttons([Button("Continue")]), [FormControl("Dates", DatePicker("dates", "range"))])])`;
    render(
      <ThemeProvider>
        <Renderer
          library={adapted}
          response={program}
          initialState={{ lesson: { dates: { from: '2026-10-20T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' } } }}
        />
      </ThemeProvider>
    );
    const trigger = await screen.findByRole('button', { name: 'Dates' });
    await waitFor(() => expect(trigger.textContent).toContain('20, 2026'));
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog')).toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it('keeps an invalid or streaming date field inactive without throwing', () => {
    const program = `root = ${library.root}([Form("lesson", Buttons([Button("Continue")]), [FormControl("Date", DatePicker("date", "single"))])])`;
    render(
      <ThemeProvider>
        <Renderer
          library={withWebUiAdapters(library)}
          response={program}
          isStreaming
          initialState={{ lesson: { date: 'not-a-date' } }}
        />
      </ThemeProvider>
    );
    expect(screen.getByRole('button', { expanded: false })).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps a new range calendar open until the second date is selected', async () => {
    const program = `root = ${library.root}([Form("lesson", Buttons([Button("Continue")]), [FormControl("Dates", DatePicker("dates", "range"))])])`;
    render(
      <ThemeProvider>
        <Renderer library={withWebUiAdapters(library)} response={program} />
      </ThemeProvider>
    );
    const trigger = await screen.findByRole('button', { name: 'Dates' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    const day = (text: string) =>
      [...dialog.querySelectorAll<HTMLButtonElement>('.openui-calendar-range-day-button')].find(
        (button) => button.textContent === text
      )!;
    fireEvent.click(day('20'));
    expect(dialog).toBeVisible();
    fireEvent.click(day('22'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger.textContent).toContain('22');
  });
});
