import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

/** Edit every official grid cell type and restore the unsubmitted rows on another page load. */
export async function runTableAcceptance(
  page: Page,
  save: (name: string) => Promise<void>,
  prefix: string
): Promise<void> {
  const table = page.locator('.openui-editable-table-table');
  const row = table.locator('tbody tr').first();
  const cell = (column: number) => row.locator('td').nth(column).locator('.openui-editable-table-cell-base');
  if (prefix === 'mobile')
    await page.waitForFunction(() =>
      document.querySelector('.openui-editable-table-table tbody tr td:nth-child(4)')?.textContent?.includes('21, 2026')
    );
  const score = prefix === 'mobile' ? '89' : '88';
  const grade = prefix === 'mobile' ? 'F1' : 'F2';
  const day = prefix === 'mobile' ? '22' : '21';
  const url = `https://example.com/${prefix}-edited-lesson`;
  const number = cell(1);
  await number.click({ position: { x: 1, y: 1 } });
  if (!(await number.locator('input').count())) await number.press('Enter');
  await number.locator('input').fill(score);
  await number.locator('input').press('Tab');
  const selection = cell(2);
  await selection.click({ position: { x: 1, y: 1 } });
  if (!(await page.getByRole('option', { name: grade, exact: true }).count())) await selection.press('Enter');
  await page.getByRole('option', { name: grade, exact: true }).click();
  const date = cell(3);
  await date.click({ position: { x: 1, y: 1 } });
  const calendar = page.locator('.openui-date-picker-renderer-floating-content');
  if (!(await calendar.count())) await date.press('Enter');
  await calendar.waitFor();
  await save(prefix + '-table-date');
  await calendar
    .locator('.openui-calendar-single-day-button')
    .filter({ hasText: new RegExp('^' + day + '$') })
    .click();
  const persisted = page.waitForResponse(
    (response) =>
      response.url().includes('/messages/openui-qa-1/openui/0/state') &&
      response.request().method() === 'PATCH' &&
      Boolean(response.request().postData()?.includes(url)) &&
      response.ok()
  );
  const resource = cell(4);
  await resource.click({ position: { x: 1, y: 1 } });
  if (!(await resource.locator('input').count())) await resource.press('Enter');
  await resource.locator('input').fill(url);
  await resource.locator('input').press('Tab');
  await (await persisted).finished();
  await page.waitForTimeout(50);
  await page.reload();
  await row.getByText(score, { exact: true }).waitFor();
  assert.ok((await row.locator('td').nth(2).innerText()).includes(grade));
  assert.ok((await row.locator('td').nth(3).innerText()).includes(day + ', 2026'));
  assert.equal(await row.getByRole('link').getAttribute('href'), url);
  await row.locator('td').nth(4).scrollIntoViewIfNeeded();
  await save(prefix + '-table-restored');
}
