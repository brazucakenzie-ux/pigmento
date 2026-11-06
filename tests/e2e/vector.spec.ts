import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { clickDoc, drag, launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const objects = (page: Page) => page.evaluate(() => window.__pigmentoTest!.vectorObjects());
const selection = (page: Page) => page.evaluate(() => window.__pigmentoTest!.vectorSelection());
const historyLabels = (page: Page) => page.locator('.history-list li').allInnerTexts();
const layerCount = (page: Page) => page.evaluate(() => window.__pigmentoTest!.layers().count);

/** Primary red, secondary blue; turn snapping off so drags land exactly. */
async function setup(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.getByRole('tab', { name: 'Home' }).click();
}

/** A filled rectangle (100,100)–(300,200) and ellipse (400,100)–(500,200) on a new shape layer. */
async function twoShapes(page: Page): Promise<void> {
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [100, 100],
    [300, 200],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('o');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [400, 100],
    [500, 200],
  ]);
  await page.keyboard.press('Enter');
}

test('draws shapes onto a shape layer, as one step each', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await setup(page);
  await twoShapes(page);
  expect(await layerCount(page)).toBe(2);
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('vector');
  const objs = (await objects(page))!;
  expect(objs.map((o) => o.shape)).toEqual(['rect', 'ellipse']);
  expect(objs[0].box).toMatchObject({ cx: 200, cy: 150, w: 200, h: 100 });
  // The new layer and the rectangle are one undo step.
  expect((await historyLabels(page)).slice(1)).toEqual(['Rectangle', 'Ellipse']);
  expect(await pixel(page, 200, 150)).toEqual(BLUE);
  expect(await pixel(page, 450, 150)).toEqual(BLUE);
  await expect(page.locator('.layer-row', { hasText: 'Shapes 1' })).toBeVisible();

  await page.keyboard.press('Control+z');
  expect((await objects(page))!).toHaveLength(1);
  await page.keyboard.press('Control+z');
  expect(await layerCount(page)).toBe(1);
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  expect((await objects(page))!).toHaveLength(2);

  // Painting on a shape layer isn't possible (it has no pixels of its own).
  await page.keyboard.press('b');
  await drag(page, [
    [600, 400],
    [700, 450],
  ]);
  await expect(page.locator('.toast')).toContainText('This is a shape layer');
});

test('Move selects, moves, aligns, groups, arranges and deletes shapes', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await setup(page);
  await twoShapes(page);
  const [rect, ellipse] = (await objects(page))!.map((o) => o.id);
  await page.keyboard.press('v');
  // Pressing on a shape selects it, and dragging moves it.
  await drag(page, [
    [200, 150],
    [250, 180],
  ]);
  expect(await selection(page)).toEqual([rect]);
  expect((await objects(page))![0].box).toMatchObject({ cx: expect.closeTo(250, 3), cy: expect.closeTo(180, 3) });
  expect((await historyLabels(page)).at(-1)).toBe('Move shapes');

  // Shift adds; align tops lines them up with the higher one.
  await page.keyboard.down('Shift');
  await clickDoc(page, 450, 150);
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([rect, ellipse]);
  await page.getByRole('button', { name: 'Align tops' }).click();
  const top = (o: { box?: { cy: number; h: number } | null }) => o.box!.cy - Math.abs(o.box!.h) / 2;
  const [r2, e2] = (await objects(page))!;
  expect(top(r2)).toBeCloseTo(100, 6);
  expect(top(e2)).toBeCloseTo(100, 6);

  await page.getByRole('button', { name: 'Group shapes', exact: true }).click();
  let objs = (await objects(page))!;
  expect(objs).toHaveLength(1);
  expect(objs[0].type).toBe('group');
  await page.getByRole('button', { name: 'Ungroup shapes' }).click();
  objs = (await objects(page))!;
  expect(objs.map((o) => o.id)).toEqual([rect, ellipse]);

  // Arrange: bring the rectangle in front of the ellipse.
  await clickDoc(page, 900, 600);
  expect(await selection(page)).toEqual([]);
  await clickDoc(page, 250, 150);
  await page.getByRole('button', { name: 'Bring to front' }).click();
  expect((await objects(page))!.map((o) => o.id)).toEqual([ellipse, rect]);
  // Arrow keys nudge (merged into one step), Delete removes.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  expect((await objects(page))![1].box!.cx).toBeCloseTo(254, 3);
  expect((await historyLabels(page)).filter((l) => l === 'Nudge shapes')).toHaveLength(1);
  await page.keyboard.press('Delete');
  expect((await objects(page))!.map((o) => o.id)).toEqual([ellipse]);
});

test('recolours, resizes and edits shapes; keeps them in projects; rasterises', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await setup(page);
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [100, 100],
    [300, 200],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await clickDoc(page, 200, 150);

  // Palette: left click recolours the outline, right click the fill.
  await page.getByRole('button', { name: /Colour #FFC914/ }).click({ button: 'right' });
  const yellow = (await objects(page))![0].fill!;
  expect(yellow).toMatchObject({ r: 0xff, g: 0xc9, b: 0x14 });
  expect((await objects(page))![0].outline).toEqual(RED);
  expect(await pixel(page, 200, 150)).toEqual(yellow);
  // The options bar's fill mode applies to the selection too.
  await page.getByRole('toolbar').getByRole('radio', { name: 'Outline', exact: true }).click();
  expect((await objects(page))![0].mode).toBe('outline');
  await page.getByRole('toolbar').getByRole('radio', { name: 'Fill', exact: true }).click();

  // Resize from the bottom-right handle.
  await drag(page, [
    [300, 200],
    [400, 250],
  ]);
  expect((await objects(page))![0].box).toEqual({ cx: expect.closeTo(250, 3), cy: expect.closeTo(175, 3), w: expect.closeTo(300, 3), h: expect.closeTo(150, 3), angle: 0 });
  expect((await historyLabels(page)).at(-1)).toBe('Resize shapes');

  // Double-click to edit in place; Enter puts it back as the same object.
  const id = (await objects(page))![0].id;
  await page.mouse.dblclick(...(await page.evaluate(() => {
    const s = window.__pigmentoTest!.docToScreen(250, 175);
    return [s.x, s.y] as [number, number];
  })));
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('shape');
  expect((await objects(page))!).toHaveLength(0);
  await page.keyboard.press('Enter');
  expect((await objects(page))!.map((o) => o.id)).toEqual([id]);
  expect((await historyLabels(page)).at(-1)).toBe('Edit shape');

  // Saved as objects in a project.
  const file = tempFile('shapes.pigm');
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
  const before = await objects(page);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  const tree = await page.evaluate(() => window.__pigmentoTest!.layers().tree);
  expect(tree.map((l) => l.kind)).toEqual(['raster', 'vector']);
  expect(await page.evaluate((lid) => window.__pigmentoTest!.vectorObjects(lid), tree[1].id)).toEqual(before);

  // Rasterise: the layer becomes pixels and looks the same.
  await page.locator('.layer-row', { hasText: 'Shapes 1' }).click();
  await page.keyboard.press('v');
  const px = await pixel(page, 250, 175);
  await page.getByRole('button', { name: 'Rasterise layer' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('raster');
  expect(await pixel(page, 250, 175)).toEqual(px);
});

test('Move drags a pixel layer’s content', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await setup(page);
  await page.evaluate((red) => {
    const k = window.__pigmentoTest!;
    k.fillLayer(k.layers().activeId, red, { x: 100, y: 100, w: 50, h: 50 });
  }, RED);
  await page.keyboard.press('v');
  await drag(page, [
    [120, 120],
    [220, 120],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBeNull();
  expect(await pixel(page, 210, 120)).toEqual(RED);
  expect(await pixel(page, 120, 120)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect((await historyLabels(page)).at(-1)).toBe('Move layer');
});
