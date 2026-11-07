import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { clickDoc, docToScreen, drag, launchApp, pixel, ready, relaunch, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
const objects = async (page: Page) => (await page.evaluate(() => window.__pigmentoTest!.vectorObjects())) ?? [];
const pathInfo = (page: Page) => page.evaluate(() => window.__pigmentoTest!.pathInfo());
const historyLabels = (page: Page) => page.locator('.history-list li').allInnerTexts();

/** Primary red, secondary blue, snapping off; Shapes tab open. */
async function setup(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.getByRole('tab', { name: 'Shapes' }).click();
}

async function click(page: Page, x: number, y: number): Promise<void> {
  const s = await docToScreen(page, x, y);
  await page.mouse.click(s.x, s.y);
}

test('draws a closed path with corners and a curve', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('pen');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();

  await click(page, 100, 100);
  await click(page, 300, 100);
  // Press and drag: a smooth point with handles.
  await drag(page, [
    [300, 300],
    [340, 340],
  ]);
  await click(page, 100, 300);
  expect(await pathInfo(page)).toMatchObject({ drawing: true, anchors: 4, closed: false });
  // Backspace takes back the last point; place it again.
  await page.keyboard.press('Backspace');
  expect(await pathInfo(page)).toMatchObject({ anchors: 3 });
  await click(page, 100, 300);
  // Clicking the first point closes the path; it stays editable.
  await click(page, 100, 100);
  expect(await pathInfo(page)).toMatchObject({ drawing: false, closed: true, anchors: 4 });
  await page.keyboard.press('Enter');
  expect(await pathInfo(page)).toBeNull();
  expect(await pixel(page, 200, 200)).toEqual(BLUE);
  expect(await pixel(page, 90, 200)).toEqual(WHITE);
  expect((await historyLabels(page)).at(-1)).toBe('Path');
});

test('edits path points in place on a shape layer, and converts shapes to paths', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await click(page, 100, 100);
  await click(page, 300, 100);
  await click(page, 300, 300);
  await page.keyboard.press('Enter');
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0]).toMatchObject({ shape: 'path' });

  // Move tool: double-click the outline to edit its points.
  await page.keyboard.press('v');
  await clickDoc(page, 200, 100);
  const at = await docToScreen(page, 200, 100);
  await page.mouse.dblclick(at.x, at.y);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('shape');
  expect(await pathInfo(page)).toMatchObject({ drawing: false, closed: false, anchors: 3 });
  await drag(page, [
    [300, 300],
    [400, 320],
  ]);
  expect(await pathInfo(page)).toMatchObject({ selected: { smooth: false } });
  // The options bar closes the path and makes the selected point smooth.
  await page.getByRole('button', { name: 'Close path' }).click();
  await page.getByRole('button', { name: 'Smooth point' }).click();
  expect(await pathInfo(page)).toMatchObject({ closed: true, selected: { smooth: true } });
  await page.keyboard.press('Enter');
  objs = await objects(page);
  const sub = objs[0].subpaths![0];
  expect(sub.closed).toBe(true);
  expect(sub.anchors).toHaveLength(3);
  expect(sub.anchors[2].smooth).toBe(true);
  expect(Math.abs(sub.anchors[2].x - 400)).toBeLessThan(2);
  expect(Math.abs(sub.anchors[2].y - 320)).toBeLessThan(2);
  expect((await historyLabels(page)).at(-1)).toBe('Edit shape');

  // A rectangle converted to a path becomes four corner points.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.keyboard.press('r');
  await drag(page, [
    [500, 400],
    [700, 500],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('v');
  await clickDoc(page, 500 + 1, 450);
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Convert to path' }).click();
  objs = await objects(page);
  expect(objs.map((o) => o.shape)).toEqual(['path', 'path']);
  await page.keyboard.press('Control+z');
  objs = await objects(page);
  expect(objs.map((o) => o.shape)).toEqual(['path', 'rect']);
});

test('saves a shape to My shapes, draws it, and renames, duplicates and deletes it', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);
  await page.getByRole('combobox', { name: 'Category' }).selectOption('custom');
  await expect(page.getByRole('listbox', { name: 'Shape gallery' })).toContainText('No shapes of your own yet');

  // A triangle drawn with the Pen, saved while it's still being edited.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await click(page, 100, 300);
  await click(page, 200, 100);
  await click(page, 300, 300);
  await click(page, 100, 300);
  await page.getByRole('button', { name: 'Save as my shape…' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'Save as my shape' });
  await dlg.getByLabel('Name').fill('Peak');
  await dlg.getByLabel('Category').selectOption('symbols');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toBeHidden();
  const gallery = page.getByRole('listbox', { name: 'Shape gallery' });
  await expect(gallery.getByRole('option')).toHaveCount(1);
  await expect(gallery.getByRole('option', { name: 'Peak' })).toBeVisible();
  await expect.poll(() => (existsSync(path.join(h.userData, 'shapes')) ? readdirSync(path.join(h.userData, 'shapes')).length : 0)).toBe(1);

  // Drawn with the Shape tool, as an editable object that carries its own outline.
  await page.keyboard.press('Enter');
  await gallery.getByRole('option', { name: 'Peak' }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [400, 100],
    [600, 300],
  ]);
  await page.keyboard.press('Enter');
  const objs = await objects(page);
  expect(objs.at(-1)).toMatchObject({ shape: 'parametric' });
  expect(await pixel(page, 500, 250)).toEqual(BLUE);
  expect(await pixel(page, 410, 110)).toEqual(WHITE);

  // It's also listed under its category.
  await page.getByRole('combobox', { name: 'Category' }).selectOption('symbols');
  await expect(gallery.getByRole('option', { name: 'Peak' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('custom');

  await page.getByRole('button', { name: 'My shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const ren = page.getByRole('dialog', { name: 'Rename shape' });
  await ren.getByLabel('Name').fill('Summit');
  await ren.getByRole('button', { name: 'Save' }).click();
  await expect(gallery.getByRole('option', { name: 'Summit' })).toBeVisible();
  await page.getByRole('button', { name: 'My shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(gallery.getByRole('option')).toHaveCount(2);
  await expect(gallery.getByRole('option', { name: 'Summit copy' })).toBeVisible();
  await page.getByRole('button', { name: 'My shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete shape' }).getByRole('button', { name: 'Delete' }).click();
  await expect(gallery.getByRole('option')).toHaveCount(1);
  await expect.poll(() => readdirSync(path.join(h.userData, 'shapes')).length).toBe(1);
  // The drawing still has its copy.
  expect(await pixel(page, 500, 250)).toEqual(BLUE);

  // My shapes are there after a restart.
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  await h.app.close().catch(() => undefined);
  h = await relaunch(h);
  await ready(h.page);
  await h.page.getByRole('tab', { name: 'Shapes' }).click();
  await h.page.getByRole('combobox', { name: 'Category' }).selectOption('custom');
  await expect(h.page.getByRole('listbox', { name: 'Shape gallery' }).getByRole('option', { name: 'Summit' })).toBeVisible();
});
