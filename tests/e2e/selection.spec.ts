import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { clickDoc, drag, launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const area = () => h.page.evaluate(() => window.__pigmentoTest!.selectionArea());
const at = (x: number, y: number) => h.page.evaluate(([px, py]) => window.__pigmentoTest!.selectionAt(px, py), [x, y] as const);
const tool = () => h.page.evaluate(() => window.__pigmentoTest!.tool());
const bounds = () => h.page.evaluate(() => window.__pigmentoTest!.selection());
const historyRows = (page: Page, label: string) => page.locator('.history-list li', { hasText: label });

/** Drag with modifier keys held from the start. */
async function dragWith(page: Page, keys: string[], points: [number, number][]): Promise<void> {
  for (const k of keys) await page.keyboard.down(k);
  await drag(page, points);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

/** Open the Home tab's Select menu and pick an item (optionally inside a submenu). */
async function selectMenu(page: Page, item: string, submenu?: string): Promise<void> {
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
  if (submenu) await page.getByRole('menuitem', { name: submenu }).hover();
  await page.getByRole('menuitem', { name: item }).click();
}

test('combines selections with Shift and Alt, and undoes each step without unsaving', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('s');
  await drag(page, [
    [100, 100],
    [300, 300],
  ]);
  expect(await area()).toBe(40000);
  // Shift adds, Alt subtracts, Shift+Alt intersects.
  await dragWith(page, ['Shift'], [
    [200, 200],
    [400, 400],
  ]);
  expect(await area()).toBe(70000);
  await dragWith(page, ['Alt'], [
    [150, 150],
    [250, 250],
  ]);
  expect(await area()).toBe(60000);
  expect(await at(200, 200)).toBe(0);
  await dragWith(page, ['Shift', 'Alt'], [
    [0, 0],
    [260, 260],
  ]);
  expect(await area()).toBe(160 * 160 - 100 * 100);
  await expect(historyRows(page, 'Rectangle select')).toHaveCount(4);
  // Selections are undoable but don't make the image "unsaved".
  await expect(page.locator('.topbar .dirty')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  expect(await area()).toBe(60000);
  await page.keyboard.press('Control+z');
  expect(await area()).toBe(70000);
  await page.keyboard.press('Control+y');
  expect(await area()).toBe(60000);

  // The options bar picks the mode too.
  await page.getByRole('radio', { name: 'Subtract from selection (Alt)' }).click();
  await drag(page, [
    [300, 300],
    [400, 400],
  ]);
  expect(await area()).toBe(50000);
  await page.getByRole('radio', { name: 'New selection' }).click();

  // Moving the combined (non-rectangular) selection keeps its shape.
  const before = await bounds();
  await drag(page, [
    [350, 250],
    [370, 250],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('float');
  await selectMenu(page, 'Save selection…');
  await page.getByRole('dialog', { name: 'Save selection' }).getByRole('button', { name: 'Cancel' }).click();
  expect(await area()).toBe(50000);
  expect(await bounds()).toEqual({ ...before!, x: before!.x + 20 });
});

test('ellipse, polygon and magic wand selections; shared letters switch tools', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('s');
  expect(await tool()).toBe('select');
  await page.keyboard.press('s');
  expect(await tool()).toBe('ellipseSelect');
  await drag(page, [
    [100, 100],
    [300, 200],
  ]);
  const ellipse = Math.PI * 100 * 50;
  expect(await area()).toBeGreaterThan(ellipse * 0.98);
  expect(await area()).toBeLessThan(ellipse * 1.02);
  expect(await at(200, 150)).toBe(255);
  expect(await at(101, 101)).toBe(0);

  await page.keyboard.press('q');
  expect(await tool()).toBe('lasso');
  await page.keyboard.press('q');
  expect(await tool()).toBe('polyLasso');
  await clickDoc(page, 500, 100);
  await clickDoc(page, 700, 100);
  await clickDoc(page, 700, 300);
  // A stray corner, taken back with Backspace.
  await clickDoc(page, 600, 600);
  await page.keyboard.press('Backspace');
  // Clicking the first corner closes the polygon (and replaces the ellipse).
  await clickDoc(page, 500, 100);
  expect(await area()).toBeGreaterThan(19500);
  expect(await area()).toBeLessThan(20500);
  expect(await at(690, 110)).toBe(255);
  expect(await at(510, 290)).toBe(0);
  expect(await at(200, 150)).toBe(0);
  await expect(historyRows(page, 'Polygon select')).toHaveCount(1);

  // Magic wand on the active layer: a red block on an otherwise empty layer.
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    t.fillLayer(t.layers().activeId, { r: 215, g: 38, b: 61, a: 255 }, { x: 50, y: 450, w: 200, h: 150 });
  });
  await page.keyboard.press('w');
  expect(await tool()).toBe('wand');
  await clickDoc(page, 100, 500);
  await expect.poll(area).toBe(200 * 150);
  await page.keyboard.down('Shift');
  await clickDoc(page, 1000, 700);
  await page.keyboard.up('Shift');
  await expect.poll(area).toBe(1280 * 800);
  await page.keyboard.down('Alt');
  await clickDoc(page, 100, 500);
  await page.keyboard.up('Alt');
  await expect.poll(area).toBe(1280 * 800 - 200 * 150);
  await expect(historyRows(page, 'Magic wand')).toHaveCount(3);
});

test('modifies, saves and loads selections, and keeps them in the project', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('s');
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 200, 200));

  await selectMenu(page, 'Grow…', 'Modify selection');
  const grow = page.getByRole('dialog', { name: 'Grow selection' });
  await grow.getByLabel('Grow by').fill('10');
  await grow.getByRole('button', { name: 'OK' }).click();
  await expect(grow).toBeHidden();
  expect(await bounds()).toEqual({ x: 90, y: 90, w: 220, h: 220 });
  expect(await at(90, 90)).toBe(0); // grown corners are round

  await page.keyboard.press('Control+Alt+d');
  const feather = page.getByRole('dialog', { name: 'Feather selection' });
  await feather.getByLabel('Radius').fill('8');
  await feather.getByLabel('Radius').press('Enter');
  await expect(feather).toBeHidden();
  expect(await at(200, 200)).toBe(255);
  const edge = await at(90, 200);
  expect(edge).toBeGreaterThan(40);
  expect(edge).toBeLessThan(215);
  const feathered = await area();

  await selectMenu(page, 'Save selection…');
  const save = page.getByRole('dialog', { name: 'Save selection' });
  await expect(save.getByLabel('Name')).toHaveValue('Selection 1');
  await save.getByLabel('Name').fill('Window');
  await save.getByRole('button', { name: 'Save' }).click();
  expect((await page.evaluate(() => window.__pigmentoTest!.savedSelections())).map((s) => s.name)).toEqual(['Window']);
  // Saved selections are part of the file, so this one does make the image unsaved.
  await expect(page.locator('.topbar .dirty')).toBeVisible();

  await page.keyboard.press('Control+d');
  expect(await area()).toBe(0);
  await selectMenu(page, 'Load selection…');
  const load = page.getByRole('dialog', { name: 'Load selection' });
  await expect(load.getByRole('radio', { name: /Window/ })).toBeChecked();
  await load.getByRole('button', { name: 'Load' }).click();
  expect(await area()).toBe(feathered);
  expect(await at(90, 200)).toBe(edge);

  // Ctrl+S picks the project format, because a flat image would lose the saved selection.
  const file = tempFile('selections.pigm');
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  await page.keyboard.press('Control+n');
  await page.getByRole('dialog', { name: 'New image' }).getByRole('button', { name: 'Create' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.savedSelections())).toEqual([]);
  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  expect((await page.evaluate(() => window.__pigmentoTest!.savedSelections())).map((s) => s.name)).toEqual(['Window']);
  await selectMenu(page, 'Load selection…');
  await load.getByRole('button', { name: 'Load' }).click();
  expect(await area()).toBe(feathered);

  // Deleting a saved selection is undoable.
  await selectMenu(page, 'Load selection…');
  await load.getByRole('button', { name: 'Delete “Window”' }).click();
  await expect(load).toContainText('There are no saved selections yet');
  await load.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.savedSelections())).toHaveLength(1);
});

test('colour range previews live, cancels cleanly and applies as one step', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    const id = t.layers().activeId;
    t.fillLayer(id, { r: 215, g: 38, b: 61, a: 255 }, { x: 100, y: 100, w: 100, h: 100 });
    // A slightly different red: inside a 20% tolerance, outside 0%.
    t.fillLayer(id, { r: 208, g: 42, b: 64, a: 255 }, { x: 300, y: 100, w: 50, h: 50 });
  });
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();

  await selectMenu(page, 'Colour range…');
  const dlg = page.getByRole('dialog', { name: 'Select colour range' });
  await expect(dlg).toBeVisible();
  await expect.poll(area).toBe(10000 + 2500);
  await dlg.getByRole('slider', { name: 'Tolerance' }).focus();
  await page.keyboard.press('Home');
  await expect.poll(area).toBe(10000);
  // Cancel puts back the selection from before (none).
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  expect(await area()).toBe(0);
  await expect(historyRows(page, 'Colour range')).toHaveCount(0);

  await selectMenu(page, 'Colour range…');
  await expect.poll(area).toBe(12500);
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(dlg).toBeHidden();
  expect(await area()).toBe(12500);
  await expect(historyRows(page, 'Colour range')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  expect(await area()).toBe(0);
});
