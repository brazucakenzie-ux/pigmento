import { test } from '@playwright/test';
import path from 'node:path';
import { drag, launchApp, ready } from './harness';

// Captures screenshots of key UI states for visual review (not an assertion test).
test('capture UI states', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('button', { name: 'Rulers' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();

    await page.keyboard.press('b');
    await page.getByRole('button', { name: /Colour #4B4BE0/ }).click();
    await drag(page, [
      [200, 300],
      [300, 250],
      [420, 320],
      [520, 260],
    ]);
    await page.keyboard.press('o');
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await page.getByRole('button', { name: /Colour #FFC914/ }).click({ button: 'right' });
    await drag(page, [
      [700, 150],
      [950, 400],
    ]);
    await shot('light-live-shape');
    await page.keyboard.press('Enter');

    await page.keyboard.press('t');
    await drag(page, [
      [120, 520],
      [400, 600],
    ]);
    await page.keyboard.type('Hello Pigmento!\nSecond line');
    await shot('text-editing');
    await page.keyboard.press('Escape');

    await page.keyboard.press('s');
    await drag(page, [
      [180, 220],
      [560, 360],
    ]);
    await drag(page, [
      [300, 300],
      [360, 420],
    ]);
    await shot('floating-selection');
    await page.keyboard.press('Escape');

    // Selection modes: an ellipse added to a rectangle, then a hole subtracted.
    await drag(page, [
      [600, 450],
      [900, 650],
    ]);
    await page.keyboard.press('s');
    await page.keyboard.down('Shift');
    await drag(page, [
      [820, 400],
      [1050, 600],
    ]);
    await page.keyboard.up('Shift');
    await page.keyboard.down('Alt');
    await drag(page, [
      [650, 500],
      [720, 560],
    ]);
    await page.keyboard.up('Alt');
    await shot('selection-modes');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Modify selection' }).hover();
    await page.waitForTimeout(250);
    await shot('select-menu');
    await page.getByRole('menuitem', { name: 'Feather…' }).click();
    await page.waitForTimeout(200);
    await shot('feather-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Colour range…' }).click();
    await page.waitForTimeout(300);
    await shot('color-range-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Save selection…' }).click();
    await page.keyboard.press('Enter');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Load selection…' }).click();
    await page.waitForTimeout(200);
    await shot('load-selection-dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+d');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(250);
    await shot('file-menu');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Edit colours' }).last().click();
    await page.waitForTimeout(250);
    await shot('edit-colors');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Image' }).click();
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(250);
    await shot('resize-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Crop', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.waitForTimeout(200);
    await shot('image-tab');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__pigmentoTest!.addLayer());
    await page.keyboard.press('Control+Alt+Shift+S');
    await page.getByRole('radio', { name: '2×' }).click();
    await page.getByRole('radio', { name: 'Selected layer' }).click();
    await page.waitForTimeout(250);
    await shot('export-dialog');
    await page.getByLabel('Format').selectOption('jpeg');
    await page.waitForTimeout(150);
    await shot('export-dialog-jpeg');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'High contrast' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.waitForTimeout(150);
    await shot('contrast-view-tab');
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Pigmento' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await shot('dark-zoomed');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});
