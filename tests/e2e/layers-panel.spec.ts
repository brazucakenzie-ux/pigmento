import { expect, test } from '@playwright/test';
import path from 'node:path';
import { drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const tree = () => h.page.evaluate(() => window.__pigmentoTest!.layers());
const rows = () => h.page.locator('.layer-row');

test('a single-layer image works without touching the Layers panel', async () => {
  const info = await tree();
  expect(info.count).toBe(1);
  await expect(rows()).toHaveCount(1);
  await expect(rows().first()).toContainText('Layer 1');
  await h.page.keyboard.press('b');
  await drag(h.page, [
    [100, 100],
    [300, 100],
  ]);
  expect((await pixel(h.page, 200, 100)).r).toBeLessThan(60);
});

test('adds, renames, hides, reorders, merges and deletes layers', async () => {
  const { page } = h;
  const panel = page.getByRole('region', { name: 'Layers' });
  await panel.getByRole('button', { name: 'New layer' }).click();
  await expect(rows()).toHaveCount(2);
  await expect(rows().first()).toContainText('Layer 2');
  await expect(rows().first().locator('.layer-name')).toHaveAttribute('aria-current', 'true');

  // Paint red on Layer 2, then hide it: the canvas shows white paper again.
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #D7263D/ }).click({ button: 'right' });
  await drag(page, [
    [0, 0],
    [300, 300],
  ]);
  await page.keyboard.press('Enter');
  expect((await pixel(page, 100, 100)).g).toBeLessThan(60);
  await page.getByRole('button', { name: 'Hide Layer 2' }).click();
  expect(await pixel(page, 100, 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.getByRole('button', { name: 'Show Layer 2' }).click();

  // Rename by double-clicking.
  await rows().first().dblclick();
  const input = page.getByRole('textbox', { name: 'Layer name' });
  await input.fill('Sky');
  await input.press('Enter');
  await expect(rows().first()).toContainText('Sky');

  // Blend mode and opacity apply to the active layer (one slider drag = one undo step).
  await panel.getByRole('combobox', { name: 'Blend mode' }).selectOption('multiply');
  const opacity = panel.getByRole('textbox', { name: 'Layer opacity' });
  await opacity.fill('50');
  await opacity.press('Enter');
  await expect(rows().first()).toContainText('Multiply 50%');

  // Drag Layer 1 above Sky.
  await rows().nth(1).dragTo(rows().first(), { targetPosition: { x: 40, y: 4 } });
  await expect(rows().first()).toContainText('Layer 1');

  // Select Layer 1 and move it back down with the keyboard shortcut, then merge Sky down.
  await rows().first().click();
  await page.keyboard.press('Control+[');
  await expect(rows().first()).toContainText('Sky');
  await rows().first().click();
  await page.keyboard.press('Control+Shift+E');
  await expect(rows()).toHaveCount(1);
  const merged = await pixel(page, 100, 100);
  expect(merged.r).toBeGreaterThan(200);
  expect(merged.g).toBeGreaterThan(100); // 50% multiply of red over white

  // Undo everything back to two layers, then delete one via the panel.
  await page.keyboard.press('Control+z');
  await expect(rows()).toHaveCount(2);
  await panel.getByRole('button', { name: 'Delete layer' }).click();
  await expect(rows()).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Delete layer' })).toBeDisabled();
});

test('captures the Layers panel for review', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const { page } = h;
  const panel = page.getByRole('region', { name: 'Layers' });
  await panel.getByRole('button', { name: 'New layer' }).click();
  await page.keyboard.press('o');
  await drag(page, [
    [200, 200],
    [500, 450],
  ]);
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: 'Group layer' }).click();
  await panel.getByRole('button', { name: 'New layer' }).click();
  await panel.getByRole('combobox', { name: 'Blend mode' }).selectOption('screen');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  await page.screenshot({ path: path.join(out, 'layers-panel.png') });
});
