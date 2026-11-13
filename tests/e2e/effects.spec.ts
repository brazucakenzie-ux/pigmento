import { expect, test } from '@playwright/test';
import { launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

test('adjusts and filters the layer with a live preview, Apply/Cancel and undo', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  // Left half red, right half white (a 1280×800 image: big enough for the worker pool).
  await page.evaluate((c) => {
    const t = window.__pigmentoTest!;
    t.fillLayer(t.layers().activeId, { r: 255, g: 255, b: 255, a: 255 });
    t.fillLayer(t.layers().activeId, c, { x: 0, y: 0, w: 640, h: 800 });
  }, RED);
  const step = () => page.evaluate(() => window.__pigmentoTest!.history().index);
  const screen = (x: number, y: number) => page.evaluate(([px, py]) => window.__pigmentoTest!.screenPixel(px, py), [x, y] as const);
  await page.getByRole('tab', { name: 'Effects' }).click();
  const ribbon = page.locator('.ribbon');

  // A settings-less adjustment applies at once, as one undo step.
  const before = await step();
  await ribbon.getByRole('button', { name: 'Invert colours' }).click();
  await expect.poll(() => pixel(page, 100, 100)).toEqual({ r: 40, g: 217, b: 194, a: 255 });
  expect(await pixel(page, 900, 100)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  expect(await step()).toBe(before + 1);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 100, 100)).toEqual(RED);

  // Gaussian blur inside a selection: the preview shows on screen, the layer is untouched…
  await page.evaluate(() => window.__pigmentoTest!.selectRect(0, 0, 640, 800));
  await ribbon.getByRole('button', { name: 'Gaussian blur…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Gaussian blur' });
  await expect(dlg).toContainText('Only the selection changes.');
  const radius = dlg.getByRole('textbox', { name: 'Radius' });
  await radius.fill('20');
  await radius.press('Tab');
  await expect.poll(async () => (await screen(630, 400)).g, { timeout: 10000 }).toBeGreaterThan(60);
  expect(await pixel(page, 630, 400)).toEqual(RED);
  // …until Cancel, which puts the screen back.
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(async () => (await screen(630, 400)).g).toBe(38);

  // Apply: only the selection changes, in one undo step (Cancel kept nothing: the radius is back to 4).
  await ribbon.getByRole('button', { name: 'Gaussian blur…' }).click();
  await expect(dlg.getByRole('textbox', { name: 'Radius' })).toHaveValue('4');
  await dlg.getByRole('textbox', { name: 'Radius' }).fill('20');
  await dlg.getByRole('textbox', { name: 'Radius' }).press('Tab');
  const n = await step();
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(dlg).toBeHidden();
  const blurred = await pixel(page, 630, 400);
  expect(blurred.g).toBeGreaterThan(60);
  expect(await pixel(page, 650, 400)).toEqual(WHITE);
  expect(await pixel(page, 100, 400)).toEqual(RED);
  expect(await step()).toBe(n + 1);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 630, 400)).toEqual(RED);

  // Levels and Curves show the layer's histogram.
  await ribbon.getByRole('button', { name: 'Levels…' }).click();
  const levels = page.getByRole('dialog', { name: 'Levels' });
  await expect(levels.getByRole('img', { name: 'Histogram of the layer' })).toBeVisible();
  await levels.getByRole('button', { name: 'Cancel' }).click();
});
