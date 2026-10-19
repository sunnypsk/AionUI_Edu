import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { runTableAcceptance } from './table';

/** Verify focus loops and popovers above an official modal's overlay. */
export async function runModalAcceptance(
  page: Page,
  save: (name: string) => Promise<void>,
  name: string
): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Lesson', exact: true });
  await dialog.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  const date = dialog.getByRole('button', { name: 'Modal date', exact: true });
  await date.focus();
  await date.press('Enter');
  const calendar = page.getByRole('dialog', { name: 'Select a date', exact: true });
  await calendar.waitFor();
  await save(name + '-date');
  await page.keyboard.press('Escape');
  await calendar.waitFor({ state: 'hidden' });
  assert.equal(await dialog.isVisible(), true);
  const select = dialog.getByRole('combobox');
  await select.click();
  await page.getByRole('option', { name: 'F2', exact: true }).click();
  await select.click();
  await page.getByRole('option', { name: 'F2', exact: true }).waitFor();
  await save(name + '-select');
  await page.keyboard.press('Escape');
  await page.getByRole('option', { name: 'F2', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await dialog.isVisible(), true);
  await save(name);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(
    await page
      .getByRole('button', { name: 'Open lesson', exact: true })
      .evaluate((element) => document.activeElement === element),
    true
  );
}

/** Operate the official controls and portals in the actual browser, including keyboard input. */
export async function runControlAcceptance(
  page: Page,
  save: (name: string) => Promise<void>,
  prefix: string
): Promise<string[]> {
  const topic = page.getByPlaceholder('Topic', { exact: true });
  const block = page.locator('[data-openui-block]').filter({ has: topic });
  const initial = await topic.inputValue();
  await topic.fill('');
  await block.getByRole('button', { name: 'Save fixture', exact: true }).click();
  await block.getByText('This field is required', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('message-permission-option-allow_once').count(), 0);
  await topic.fill(initial);
  await block.getByPlaceholder('Notes', { exact: true }).fill(prefix + ' notes');
  const select = block.getByRole('combobox').first();
  await select.click();
  await page.getByRole('option', { name: 'F2', exact: true }).waitFor();
  await save(prefix + '-select-popup');
  await page.getByRole('option', { name: 'F2', exact: true }).click();
  const date = block.locator('button[aria-haspopup="dialog"]');
  await date.focus();
  await date.press('Enter');
  const calendar = page.getByRole('dialog');
  await calendar.waitFor();
  await save(prefix + '-date-popup');
  const day = (await date.innerText()).includes('20') ? '21' : '20';
  await calendar
    .locator('.openui-calendar-single-day-button')
    .filter({ hasText: new RegExp('^' + day + '$') })
    .click();
  await calendar.waitFor({ state: 'hidden' });
  assert.equal(await date.evaluate((element) => document.activeElement === element), true);
  await date.press('Enter');
  await calendar.waitFor();
  await page.keyboard.press('Escape');
  await calendar.waitFor({ state: 'hidden' });
  const slider = block.getByRole('slider').first();
  const mark = Number(await slider.getAttribute('aria-valuenow'));
  await slider.focus();
  await slider.press('ArrowRight');
  assert.equal(Number(await slider.getAttribute('aria-valuenow')), mark + 1);
  const checkbox = block.getByRole('checkbox').first();
  await checkbox.setChecked(!(await checkbox.isChecked()));
  await block.getByRole('radio', { name: /Du Fu/ }).click();
  await block.getByRole('switch').click();
  await block.getByRole('option', { name: 'Spring', exact: true }).click();
  await block.getByRole('radio', { name: 'Writing', exact: true }).click();

  await page.getByPlaceholder('Email', { exact: true }).fill('qa@example.com');
  await page.getByPlaceholder('Password', { exact: true }).fill('Fixture-only-password');
  await page.getByPlaceholder('Number', { exact: true }).fill('42');
  await page.getByPlaceholder('URL', { exact: true }).fill('https://example.com/lesson');
  const range = page.getByRole('button', { name: 'Range', exact: true });
  if ((await range.innerText()).includes('Select a date range')) {
    await range.focus();
    await range.press('Enter');
    await calendar.waitFor();
    await calendar.locator('.openui-calendar-range-day-button').filter({ hasText: /^20$/ }).click();
    await calendar.locator('.openui-calendar-range-day-button').filter({ hasText: /^22$/ }).click();
    await calendar.waitFor({ state: 'hidden' });
  }
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByPlaceholder('Email', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>('input[placeholder="Email"]')?.value === 'qa@example.com'
  );
  assert.equal(await page.getByPlaceholder('Email', { exact: true }).inputValue(), 'qa@example.com');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((button) => /2026.*22/.test(button.textContent || ''))
  );
  if (prefix === 'mobile') {
    await runTableAcceptance(page, save, prefix);
    await page.getByRole('button', { name: 'Open lesson', exact: true }).click();
    await runModalAcceptance(page, save, 'mobile-modal-light');
  }
  return [
    `${prefix}: form validation, all input/control types, keyboard date/select portals and JSON date-range restoration`,
  ];
}
