import { test } from '@playwright/test';
import path from 'node:path';
import { drag, launchApp, ready } from './harness';

// Captures every theme for visual review (not an assertion test).
test('capture every theme', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  try {
    await ready(page);
    // A little artwork and a live shape so canvas, handles and selection states show.
    await page.keyboard.press('b');
    await drag(page, [
      [200, 300],
      [320, 240],
      [460, 320],
    ]);
    await page.keyboard.press('r');
    await drag(page, [
      [600, 150],
      [850, 380],
    ]);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, 'theme-menu.png') });
    await page.keyboard.press('Escape');

    const families = ['Pigmento', 'GitHub', 'VS Code', 'Claude', 'Pierre', 'High contrast'];
    for (const fam of families) {
      for (const mode of ['Light', 'Dark']) {
        await page.getByRole('button', { name: 'Theme' }).click();
        await page.getByRole('menuitemradio', { name: fam }).click();
        await page.getByRole('button', { name: mode, exact: true }).click();
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(out, `theme-${fam.replace(' ', '')}-${mode}.png`) });
      }
    }
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});
