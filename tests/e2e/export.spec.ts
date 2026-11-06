import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const ORANGE = { r: 255, g: 138, b: 61, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

interface SaveOptions {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

/** Answer the native save dialog with `file` and remember the options it was opened with. */
async function stubSaveDialog(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async (_win: unknown, opts: unknown) => {
      (globalThis as Record<string, unknown>).lastSaveOptions = opts;
      return { canceled: false, filePath: fp };
    }) as unknown as typeof dialog.showSaveDialog;
  }, file);
}

const lastSaveOptions = () => h.app.evaluate(() => (globalThis as Record<string, unknown>).lastSaveOptions as SaveOptions);
const doc = () => h.page.evaluate(() => window.__pigmentoTest!.doc());

/** Blue block on the base layer, an orange block on a layer called "Sun". */
async function twoLayers(): Promise<void> {
  await h.page.evaluate(
    ([blue, orange]) => {
      const t = window.__pigmentoTest!;
      t.fillLayer(t.layers().activeId, blue, { x: 0, y: 0, w: 400, h: 300 });
      const sun = t.addLayer();
      t.fillLayer(sun, orange, { x: 500, y: 400, w: 100, h: 50 });
      t.setLayerProps(sun, { name: 'Sun' });
    },
    [BLUE, ORANGE] as const,
  );
}

test('exports one layer at 2× with a transparent background and leaves the document alone', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await twoLayers();
  const file = tempFile('export.png');
  await stubSaveDialog(file);

  await page.keyboard.press('Control+Alt+Shift+S');
  const dlg = page.getByRole('dialog', { name: 'Export image' });
  await expect(dlg).toBeVisible();
  await dlg.getByLabel('Format').selectOption('png');
  await expect(dlg.getByTestId('export-size')).toHaveText('1280 × 800 px');
  await dlg.getByRole('radio', { name: '2×' }).click();
  await expect(dlg.getByTestId('export-size')).toHaveText('2560 × 1600 px');
  await dlg.getByLabel('Enlarge with').selectOption('nearest');
  await dlg.getByRole('radio', { name: 'Selected layer' }).click();
  await expect(dlg).toContainText('Only “Sun”');
  // White paper: the background starts solid.
  const transparent = dlg.getByLabel('Transparent (leave out the paper)');
  await expect(transparent).not.toBeChecked();
  await transparent.check();
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(page.getByText('Exported “export.png”')).toBeVisible();

  // The native dialog only offered PNG, with a name that says what was exported.
  const opts = await lastSaveOptions();
  expect(opts.title).toBe('Export image');
  expect(opts.filters).toEqual([{ name: 'PNG image', extensions: ['png'] }]);
  expect(path.basename(opts.defaultPath ?? '')).toBe('Untitled - Sun@2x.png');

  // Exporting isn't saving: the document keeps its unsaved state and has no file.
  await expect(page.locator('.topbar .dirty')).toBeVisible();
  expect(await page.evaluate(() => window.__pigmentoTest!.filePath())).toBeNull();
  expect(await pixel(page, 100, 100)).toEqual(BLUE);

  // The file holds just the layer, doubled, with no paper.
  expect([...readFileSync(file).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  expect(await doc()).toEqual({ width: 2560, height: 1600 });
  expect(await pixel(page, 1000, 800)).toEqual(ORANGE);
  expect(await pixel(page, 1199, 899)).toEqual(ORANGE);
  expect(await pixel(page, 1200, 900)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  expect(await pixel(page, 100, 100)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
});

test('exports the whole image as JPEG on its paper and remembers the choices', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await twoLayers();
  const file = tempFile('photo.jpg');
  await stubSaveDialog(file);

  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Export image' });
  await dlg.getByLabel('Format').selectOption('jpeg');
  await expect(dlg.getByRole('slider', { name: 'Quality' })).toBeVisible();
  // JPEG has no transparency, so the choice is off and explained.
  await expect(dlg.getByLabel('Transparent (leave out the paper)')).toBeDisabled();
  await expect(dlg).toContainText('doesn’t support transparency');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => existsSync(file)).toBe(true);
  expect([...readFileSync(file).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(path.basename((await lastSaveOptions()).defaultPath ?? '')).toBe('Untitled.jpg');

  await page.keyboard.press('Control+Alt+Shift+S');
  await expect(dlg.getByLabel('Format')).toHaveValue('jpeg');
  await expect(dlg.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
    Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
  expect(near(await pixel(page, 200, 150), BLUE)).toBeLessThan(8);
  expect(near(await pixel(page, 550, 425), ORANGE)).toBeLessThan(8);
  expect(near(await pixel(page, 900, 700), WHITE)).toBeLessThan(4);
});

test('trims transparent edges, and fits the canvas to a selection moved off the edge', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate((blue) => {
    const t = window.__pigmentoTest!;
    t.fillLayer(t.layers().activeId, blue, { x: 200, y: 100, w: 300, h: 200 });
  }, BLUE);
  await page.getByRole('tab', { name: 'Image' }).click();
  // Trim and Fit canvas live in the Crop button's menu.
  const cropMenu = page.locator('.rb-split', { has: page.getByRole('button', { name: 'Crop', exact: true }) }).locator('[aria-haspopup="menu"]');
  const trim = {
    click: async () => {
      await cropMenu.click();
      await page.getByRole('menuitem', { name: 'Trim transparent edges' }).click();
    },
  };
  const fit = {
    click: async () => {
      await cropMenu.click();
      await page.getByRole('menuitem', { name: 'Fit canvas to contents' }).click();
    },
  };

  // The white paper isn't content, so trimming crops to the painted block.
  await trim.click();
  expect(await doc()).toEqual({ width: 300, height: 200 });
  expect(await pixel(page, 0, 0)).toEqual(BLUE);
  await trim.click();
  await expect(page.getByText('There are no transparent edges to trim.')).toBeVisible();
  await page.keyboard.press('Control+z');
  expect(await doc()).toEqual({ width: 1280, height: 800 });
  expect(await pixel(page, 200, 100)).toEqual(BLUE);

  // Lift the left 100 px of the block and nudge it 250 px left, so 50 px hang off the canvas.
  await page.keyboard.press('s');
  await page.evaluate(() => window.__pigmentoTest!.selectRect(200, 100, 100, 100));
  for (let i = 0; i < 25; i++) await page.keyboard.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('float');
  await fit.click();
  // Canvas = block ∪ floating pixels: x −50…500, y 100…300.
  expect(await doc()).toEqual({ width: 550, height: 200 });
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('float');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBeNull();
  expect(await pixel(page, 0, 50)).toEqual(BLUE);
  expect(await pixel(page, 99, 50)).toEqual(BLUE);
  expect(await pixel(page, 175, 50)).toEqual(WHITE);
  expect(await pixel(page, 300, 50)).toEqual(WHITE); // where the lifted pixels came from
  expect(await pixel(page, 400, 50)).toEqual(BLUE);
  await expect(page.locator('.history-list li', { hasText: 'Fit canvas' })).toHaveCount(1);
});

test('copies the whole image to the clipboard as PNG', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await twoLayers();
  // An in-memory clipboard in the main process, so the test never touches the real one
  // (the opt-in clipboard test in more.spec covers the system clipboard itself).
  await h.app.evaluate(({ clipboard }) => {
    let items: Awaited<ReturnType<typeof clipboard.read>> = [];
    clipboard.write = (async (next: typeof items) => {
      items = next;
    }) as typeof clipboard.write;
    clipboard.read = (async () => items) as typeof clipboard.read;
  });
  // No selection needed: Copy image always takes the whole picture.
  await page.keyboard.press('Control+Shift+c');
  await expect(page.getByText('Image copied to the clipboard')).toBeVisible();
  await h.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await page.keyboard.press('Control+Alt+v');
  await expect.poll(doc).toEqual({ width: 1280, height: 800 });
  expect(await pixel(page, 100, 100)).toEqual(BLUE);
  expect(await pixel(page, 550, 425)).toEqual(ORANGE);
  expect(await pixel(page, 900, 700)).toEqual(WHITE);
});
