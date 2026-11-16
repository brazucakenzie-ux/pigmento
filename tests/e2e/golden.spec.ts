import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clickDoc, docToScreen, drag, launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const CELL = 64;
const COLS = 17;
const GOLDEN = path.resolve(__dirname, '../golden');

/**
 * Every built-in shape, drawn by the app's own renderer, against the committed contact sheet.
 * A shape whose drawing changes fails by name; if the change is intended, run with
 * PIGMENTO_UPDATE_GOLDEN=1 to write new goldens (and review tests/golden/shapes.png).
 */
test('every built-in shape matches its golden image', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const sheet = await page.evaluate(([c, k]) => window.__pigmentoTest!.shapeSheet(c, k), [CELL, COLS] as const);
  const png = path.join(GOLDEN, 'shapes.png');
  const meta = path.join(GOLDEN, 'shapes.json');
  if (process.env.PIGMENTO_UPDATE_GOLDEN) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(png, Buffer.from(sheet.png));
    writeFileSync(meta, `${JSON.stringify({ cell: CELL, cols: COLS, ids: sheet.ids }, null, 1)}\n`);
    test.info().annotations.push({ type: 'golden', description: `wrote ${sheet.ids.length} shapes to ${png}` });
    return;
  }
  expect(existsSync(png), 'Golden image missing: run with PIGMENTO_UPDATE_GOLDEN=1').toBe(true);
  const saved = JSON.parse(readFileSync(meta, 'utf8')) as { ids: string[] };
  // Shapes added or removed need new goldens.
  expect(sheet.ids).toEqual(saved.ids);
  const counts = await page.evaluate(([a, b, c, k]) => window.__pigmentoTest!.compareSheets([...a], [...b], c, k), [sheet.png, [...readFileSync(png)], CELL, COLS] as const);
  expect(counts[0], 'The contact sheet changed size').not.toBe(-1);
  const limit = CELL * CELL * 0.01;
  const changed = counts.map((n, i) => ({ id: sheet.ids[i], pixels: n })).filter((c) => c.id && c.pixels > limit);
  if (changed.length) writeFileSync(test.info().outputPath('shapes-actual.png'), Buffer.from(sheet.png));
  expect(changed).toEqual([]);
});

const BRUSH_W = 160;
const BRUSH_H = 56;
const BRUSH_COLS = 7;

/**
 * Every built-in brush's seeded sample stroke against the committed sheet. A brush whose marks
 * change fails by name; after an intended change, run with PIGMENTO_UPDATE_GOLDEN=1 and review
 * tests/golden/brushes.png.
 */
test('every built-in brush matches its golden image', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const sheet = await page.evaluate(([w, hh, k]) => window.__pigmentoTest!.brushSheet(w, hh, k), [BRUSH_W, BRUSH_H, BRUSH_COLS] as const);
  const png = path.join(GOLDEN, 'brushes.png');
  const meta = path.join(GOLDEN, 'brushes.json');
  if (process.env.PIGMENTO_UPDATE_GOLDEN) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(png, Buffer.from(sheet.png));
    writeFileSync(meta, `${JSON.stringify({ cellW: BRUSH_W, cellH: BRUSH_H, cols: BRUSH_COLS, ids: sheet.ids }, null, 1)}\n`);
    test.info().annotations.push({ type: 'golden', description: `wrote ${sheet.ids.length} brushes to ${png}` });
    return;
  }
  expect(existsSync(png), 'Golden image missing: run with PIGMENTO_UPDATE_GOLDEN=1').toBe(true);
  const saved = JSON.parse(readFileSync(meta, 'utf8')) as { ids: string[] };
  expect(sheet.ids).toEqual(saved.ids);
  const counts = await page.evaluate(([a, b, w, k, hh]) => window.__pigmentoTest!.compareSheets([...a], [...b], w, k, hh), [sheet.png, [...readFileSync(png)], BRUSH_W, BRUSH_COLS, BRUSH_H] as const);
  expect(counts[0], 'The brush sheet changed size').not.toBe(-1);
  const limit = BRUSH_W * BRUSH_H * 0.01;
  const changed = counts.map((n, i) => ({ id: sheet.ids[i], pixels: n })).filter((c) => c.id && c.pixels > limit);
  if (changed.length) writeFileSync(test.info().outputPath('brushes-actual.png'), Buffer.from(sheet.png));
  expect(changed).toEqual([]);
});

const objects = async (page: Page) => (await page.evaluate(() => window.__pigmentoTest!.vectorObjects())) ?? [];

async function click(page: Page, x: number, y: number): Promise<void> {
  const s = await docToScreen(page, x, y);
  await page.mouse.click(s.x, s.y);
}

/** Pixels on a grid over the image (the whole picture as drawn, compared after reopening). */
async function samples(page: Page): Promise<string[]> {
  const out: string[] = [];
  for (let y = 20; y < 800; y += 37) for (let x = 20; x < 1280; x += 41) out.push(JSON.stringify(await pixel(page, x, y)));
  return out;
}

test('saves and reopens a project with library shapes, paths, styles, a personal shape and guides', async () => {
  h = await launchApp();
  const { page, app } = h;
  await ready(page);
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();

  // A library shape with a changed slider, on a new shape layer.
  await page.getByRole('tab', { name: 'Shapes' }).click();
  const gallery = page.getByRole('listbox', { name: 'Shape gallery' });
  await page.getByRole('searchbox', { name: 'Search shapes' }).fill('5-point');
  await gallery.getByRole('option', { name: '5-point star' }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Outline and fill' }).click();
  await drag(page, [
    [60, 60],
    [260, 260],
  ]);
  const inner = page.getByRole('textbox', { name: 'Inner radius' });
  await inner.fill('30');
  await inner.press('Enter');
  await page.getByRole('button', { name: 'Apply' }).click();

  // A pen path with a curve, saved as a personal shape and drawn again with the Shape tool.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await click(page, 320, 260);
  await drag(page, [
    [420, 60],
    [480, 60],
  ]);
  await click(page, 520, 260);
  await click(page, 320, 260);
  await page.locator('.ribbon').getByRole('button', { name: 'Save as my shape…' }).click();
  await page.getByRole('dialog', { name: 'Save as my shape' }).getByRole('button', { name: 'Save' }).click();
  await page.keyboard.press('Enter');
  await page.getByRole('searchbox', { name: 'Search shapes' }).fill('');
  await page.getByRole('combobox', { name: 'Category' }).selectOption('custom');
  await gallery.getByRole('option').first().click();
  await drag(page, [
    [580, 60],
    [780, 260],
  ]);
  await page.keyboard.press('Enter');

  // A rectangle with a radial gradient and dashes, and a line with arrowheads.
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Outline and fill' }).click();
  await page.locator('.opt-pop-btn', { hasText: 'Fill' }).click();
  await page.getByRole('dialog', { name: 'Fill' }).getByRole('radio', { name: 'Gradient' }).click();
  await page.getByRole('dialog', { name: 'Fill' }).getByRole('radio', { name: 'Radial' }).click();
  await page.keyboard.press('Escape');
  await page.locator('.opt-pop-btn', { hasText: 'Outline' }).click();
  await page.getByRole('dialog', { name: 'Outline' }).getByRole('radio', { name: 'Dashes' }).click();
  await page.keyboard.press('Escape');
  await drag(page, [
    [60, 340],
    [360, 540],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('l');
  await page.getByRole('button', { name: '8', exact: true }).click();
  await page.locator('.opt-pop-btn', { hasText: 'Outline' }).click();
  await page.getByRole('dialog', { name: 'Outline' }).getByRole('radiogroup', { name: 'End' }).getByRole('radio', { name: 'Arrow' }).click();
  await page.keyboard.press('Escape');
  await drag(page, [
    [420, 600],
    [900, 500],
  ]);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    window.__pigmentoTest!.addGuide('x', 640);
    window.__pigmentoTest!.addGuide('y', 300);
  });
  // Select nothing so no handles are in the samples.
  await page.keyboard.press('v');
  await clickDoc(page, 1200, 760);

  const before = await objects(page);
  expect(before.map((o) => o.shape)).toEqual(['parametric', 'path', 'parametric', 'rect', 'line']);
  expect(before[0]).toMatchObject({ shapeId: 'star-5', params: { inner: 30 } });
  expect(before[2].shapeId).toMatch(/^my-/);
  const guides = await page.evaluate(() => window.__pigmentoTest!.guides());
  const look = await samples(page);

  const file = tempFile('milestone2.pigm');
  await app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(page.locator('.topbar .dirty')).toHaveCount(0);

  await page.keyboard.press('Control+n');
  await page.getByRole('dialog', { name: 'New image' }).getByRole('button', { name: 'Create' }).click();
  expect(await objects(page)).toEqual([]);
  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  expect(await objects(page)).toEqual(before);
  expect(await page.evaluate(() => window.__pigmentoTest!.guides())).toEqual(guides);
  expect(await samples(page)).toEqual(look);
});

const MOTION_W = 480;
const MOTION_H = 64;

/**
 * The motion sheet: a piece at frames 0–8 under every easing, a bent path, a turn, stretch,
 * skew and fade together, and a turn about a pivot at its end. After an intended change to how
 * pieces move, run with PIGMENTO_UPDATE_GOLDEN=1 and review tests/golden/motion.png.
 */
test('animation motion matches its golden image', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const sheet = await page.evaluate(() => window.__pigmentoTest!.motionSheet());
  const png = path.join(GOLDEN, 'motion.png');
  const meta = path.join(GOLDEN, 'motion.json');
  if (process.env.PIGMENTO_UPDATE_GOLDEN) {
    mkdirSync(GOLDEN, { recursive: true });
    writeFileSync(png, Buffer.from(sheet.png));
    writeFileSync(meta, `${JSON.stringify({ cellW: MOTION_W, cellH: MOTION_H, ids: sheet.ids }, null, 1)}\n`);
    test.info().annotations.push({ type: 'golden', description: `wrote ${sheet.ids.length} motions to ${png}` });
    return;
  }
  expect(existsSync(png), 'Golden image missing: run with PIGMENTO_UPDATE_GOLDEN=1').toBe(true);
  const saved = JSON.parse(readFileSync(meta, 'utf8')) as { ids: string[] };
  expect(sheet.ids).toEqual(saved.ids);
  const counts = await page.evaluate(([a, b, w, hh]) => window.__pigmentoTest!.compareSheets([...a], [...b], w, 1, hh), [sheet.png, [...readFileSync(png)], MOTION_W, MOTION_H] as const);
  expect(counts[0], 'The motion sheet changed size').not.toBe(-1);
  const changed = counts.map((n, i) => ({ id: sheet.ids[i], pixels: n })).filter((c) => c.id && c.pixels > MOTION_W * MOTION_H * 0.005);
  if (changed.length) writeFileSync(test.info().outputPath('motion-actual.png'), Buffer.from(sheet.png));
  expect(changed).toEqual([]);
});
