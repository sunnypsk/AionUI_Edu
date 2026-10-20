/** Browser smoke coverage for the built WebUI; no Electron or user data. */
import { test, expect } from '../fixtures';

test.describe('WebUI startup', () => {
  test('loads the real SPA and survives a reload without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.guid-input-card-shell textarea')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.guid-input-card-shell textarea')).toBeVisible();
    await expect(page.getByRole('button', { name: /Report Issue|报告问题|回報問題/i })).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('webui-desktop.png'), fullPage: true });
  });

  test('keeps the composer usable on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.guid-input-card-shell textarea')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('webui-mobile.png'), fullPage: true });
  });

  test('rejects anonymous API requests and invalid credentials', async ({ browser, webui }) => {
    const anonymous = await browser.newContext();
    try {
      expect((await anonymous.request.get(webui.url + '/api/openui/capabilities')).status()).toBe(401);
      const login = await anonymous.request.post(webui.url + '/login', {
        data: { username: 'admin', password: 'invalid-fixture-password' },
      });
      expect(login.status()).toBe(401);
    } finally {
      await anonymous.close();
    }
  });
});
