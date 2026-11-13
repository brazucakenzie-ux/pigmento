import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { drag, launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

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

test('turns the view (not the picture) and shows a reference image that is never part of it', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.getByRole('tab', { name: 'View' }).click();
  const ribbon = page.locator('.ribbon');

  // Six 15° steps: a quarter turn. Painting still lands where the pointer is on the picture.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+Alt+ArrowRight');
  expect(await page.evaluate(() => window.__pigmentoTest!.viewRotation())).toBe(90);
  await expect(ribbon.getByRole('button', { name: 'Upright' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  const size = page.locator('.optionsbar').getByRole('textbox', { name: 'Size' });
  await size.fill('10');
  await size.press('Enter');
  await drag(page, [
    [200, 300],
    [400, 300],
  ]);
  expect((await pixel(page, 300, 300)).g).toBeLessThan(80);
  expect(await pixel(page, 300, 330)).toEqual(WHITE);
  // On screen the stroke runs top to bottom now.
  const a = await page.evaluate(() => window.__pigmentoTest!.docToScreen(200, 300));
  const b = await page.evaluate(() => window.__pigmentoTest!.docToScreen(400, 300));
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(b.y).toBeGreaterThan(a.y);
  expect((await page.evaluate(() => window.__pigmentoTest!.displayPixel(300, 300))).g).toBeLessThan(80);
  await page.getByRole('tab', { name: 'View' }).click();
  await ribbon.getByRole('button', { name: 'Upright' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.viewRotation())).toBe(0);

  // A reference image: shown over the canvas at half opacity, but not in the picture.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(100, 100);
    const g = c.getContext('2d')!;
    g.fillStyle = '#0000ff';
    g.fillRect(0, 0, 100, 100);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  const file = tempFile('ref.png');
  writeFileSync(file, Buffer.from(png));
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
  await ribbon.getByRole('button', { name: 'Load reference…' }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.tool())).toBe('reference');
  // The picture is 1280×800, the reference 100×100 in its middle.
  const shown = await page.evaluate(() => window.__pigmentoTest!.displayPixel(640, 400));
  expect(shown.b).toBeGreaterThan(200);
  expect(shown.r).toBeGreaterThan(100);
  expect(shown.r).toBeLessThan(160);
  expect(await pixel(page, 640, 400)).toEqual(WHITE);
  // Moved with its tool, then hidden.
  await drag(page, [
    [640, 400],
    [840, 400],
  ]);
  expect((await page.evaluate(() => window.__pigmentoTest!.displayPixel(840, 400))).b).toBeGreaterThan(200);
  expect(await page.evaluate(() => window.__pigmentoTest!.displayPixel(640, 400))).toEqual(WHITE);
  await ribbon.getByRole('button', { name: 'Show', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.displayPixel(840, 400))).toEqual(WHITE);
  await ribbon.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(ribbon.getByRole('button', { name: 'Show', exact: true })).toBeDisabled();
});
