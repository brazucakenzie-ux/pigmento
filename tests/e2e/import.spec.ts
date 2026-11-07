import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const objects = async (page: Page) => (await page.evaluate(() => window.__pigmentoTest!.vectorObjects())) ?? [];
const historyLabels = (page: Page) => page.locator('.history-list li').allInnerTexts();

async function stubOpen(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
}

async function stubSave(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
}

/** Open the Shapes tab's Shape files menu and pick an item. */
async function shapeFiles(page: Page, item: string): Promise<void> {
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Shape files' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('imports an SVG drawing as editable paths on a new shape layer', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const file = tempFile('badge.svg');
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 200 150">
      <script>window.hacked = true</script>
      <g transform="translate(10 10)">
        <rect width="100" height="50" fill="#d7263d"/>
        <path d="M120 0 a20 20 0 1 1 0 40 z" fill="none" stroke="#1e88e5" stroke-width="3"/>
      </g>
      <text x="0" y="140">ignored</text>
    </svg>`,
  );
  await stubOpen(file);
  await page.locator('.file-tab').click();
  await page.getByRole('menuitem', { name: 'Import SVG…' }).click();
  await expect(page.locator('.layer-row', { hasText: 'badge' })).toBeVisible();
  const objs = await objects(page);
  expect(objs.map((o) => o.shape)).toEqual(['path', 'path']);
  // viewBox doubles the drawing: the rectangle covers (20, 20)–(220, 120).
  expect(await pixel(page, 120, 70)).toEqual({ r: 215, g: 38, b: 61, a: 255 });
  expect(await page.evaluate(() => (window as unknown as { hacked?: boolean }).hacked)).toBeUndefined();
  expect((await historyLabels(page)).at(-1)).toBe('Import SVG');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.layer-row', { hasText: 'badge' })).toHaveCount(0);

  // A file with nothing to import says so.
  const empty = tempFile('empty.svg');
  writeFileSync(empty, '<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>');
  await stubOpen(empty);
  await shapeFiles(page, 'Import SVG…');
  await expect(page.locator('.toast', { hasText: 'has no shapes Pigmento can import' })).toBeVisible();
});

test('turns a selection into a shape, then shares it as a shape pack', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 200, 100));
  await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Selection to shape' }).click();
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0].shape).toBe('path');
  expect(objs[0].subpaths![0].anchors.map((a) => [a.x, a.y]).sort()).toEqual([
    [100, 100],
    [100, 200],
    [300, 100],
    [300, 200],
  ]);
  expect((await historyLabels(page)).at(-1)).toBe('Selection to shape');

  // Saved to My shapes, exported as a pack, deleted, and brought back from the pack.
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Save as my shape…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Save as my shape' });
  await dlg.getByLabel('Name').fill('Panel');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('custom');
  const gallery = page.getByRole('listbox', { name: 'Shape gallery' });
  await expect(gallery.getByRole('option', { name: 'Panel' })).toBeVisible();

  const pack = tempFile('mine.pigmshapes');
  await stubSave(pack);
  await shapeFiles(page, 'Export my shapes…');
  await expect.poll(() => existsSync(pack)).toBe(true);
  const json = JSON.parse(readFileSync(pack, 'utf8')) as { format: string; shapes: { name: string; category: string }[] };
  expect(json.format).toBe('pigmento-shape-pack');
  expect(json.shapes.map((s) => s.name)).toEqual(['Panel']);

  await gallery.getByRole('option', { name: 'Panel' }).click();
  await page.getByRole('button', { name: 'My shape', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog', { name: 'Delete shape' }).getByRole('button', { name: 'Delete' }).click();
  await expect(gallery.getByRole('option')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Shape files' })).toBeVisible();

  await stubOpen(pack);
  await shapeFiles(page, 'Import shape pack…');
  await expect(gallery.getByRole('option', { name: 'Panel' })).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Shapes added to My shapes: 1.' })).toBeVisible();

  // Something that isn't a pack is refused.
  const bad = tempFile('bad.pigmshapes');
  writeFileSync(bad, JSON.stringify({ format: 'pigmento-shape-pack', version: 1, name: 'x', shapes: [{ name: 'evil', category: 'basic' }] }));
  await stubOpen(bad);
  await shapeFiles(page, 'Import shape pack…');
  await expect(page.locator('.toast', { hasText: 'isn’t a Pigmento shape pack' })).toBeVisible();
  objs = await objects(page);
  expect(objs).toHaveLength(1);
});
