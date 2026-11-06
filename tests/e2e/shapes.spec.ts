import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  clickDoc,
  docToScreen,
  drag,
  launchApp,
  pixel,
  ready,
  relaunch,
  type AppHandle,
} from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
const objects = async (page: Page) => (await page.evaluate(() => window.__pigmentoTest!.vectorObjects())) ?? [];
const gallery = (page: Page) => page.getByRole('listbox', { name: 'Shape gallery' });
/** The options bar's number box next to a slider. */
async function setParam(page: Page, name: string, value: number): Promise<void> {
  const box = page.getByRole('textbox', { name });
  await box.fill(String(value));
  await box.press('Enter');
}

/** Primary red, secondary blue, snapping off; then open the Shapes tab. */
async function setup(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.getByRole('tab', { name: 'Shapes' }).click();
}

test('finds a shape in the gallery and draws it into the pixels', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);
  const all = await gallery(page).getByRole('option').count();
  expect(all).toBeGreaterThanOrEqual(150);

  await page.getByRole('searchbox', { name: 'Search shapes' }).fill('heart');
  await expect(gallery(page).getByRole('option')).toHaveCount(1);
  await gallery(page).getByRole('option', { name: 'Heart' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('shape');
  await expect(page.getByRole('button', { name: 'Shape: Heart' })).toBeVisible();

  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [100, 100],
    [300, 300],
  ]);
  await page.keyboard.press('Enter');
  // Filled with the secondary colour; the box corners are outside the heart.
  expect(await pixel(page, 200, 210)).toEqual(BLUE);
  expect(await pixel(page, 104, 296)).toEqual(WHITE);
  await expect(page.locator('.history-list li').last()).toHaveText('Shape');

  // A category narrows the gallery; arrow keys move through it and Enter picks.
  await page.getByRole('searchbox', { name: 'Search shapes' }).fill('');
  await page.getByRole('combobox', { name: 'Category' }).selectOption('arrows');
  const arrows = await gallery(page).getByRole('option').count();
  expect(arrows).toBeGreaterThan(10);
  expect(arrows).toBeLessThan(all);
  await gallery(page).getByRole('option').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Shape: Left arrow' })).toBeVisible();
});

test('keeps library shapes editable on a shape layer, sliders included', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);
  await page.getByRole('searchbox', { name: 'Search shapes' }).fill('5-point');
  await gallery(page).getByRole('option', { name: '5-point star' }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Outline and fill' }).click();

  // The tool's slider changes the shape still being placed.
  await drag(page, [
    [100, 100],
    [300, 300],
  ]);
  await setParam(page, 'Inner radius', 60);
  await page.getByRole('button', { name: 'Apply' }).click();
  let objs = await objects(page);
  expect(objs).toHaveLength(1);
  expect(objs[0]).toMatchObject({ shape: 'parametric', shapeId: 'star-5', params: { inner: 60 } });
  expect(await pixel(page, 200, 200)).toEqual(BLUE);

  // Move tool: select the star, and its slider edits the object (one undo step).
  await page.keyboard.press('v');
  await clickDoc(page, 200, 205);
  const slider = page.locator('input[type="range"][aria-label="Inner radius"]');
  await expect(slider).toHaveValue('60');
  await setParam(page, 'Inner radius', 25);
  objs = await objects(page);
  expect(objs[0]).toMatchObject({ params: { inner: 25 } });
  await expect(page.locator('.history-list li').last()).toHaveText('Change shape settings');
  await page.getByRole('textbox', { name: 'Inner radius' }).blur();
  await page.keyboard.press('Control+z');
  objs = await objects(page);
  expect(objs[0]).toMatchObject({ params: { inner: 60 } });

  // Double-click edits it in place as a live shape, keeping the library shape.
  const at = await docToScreen(page, 200, 205);
  await page.mouse.dblclick(at.x, at.y);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('shape');
  await page.keyboard.press('Enter');
  objs = await objects(page);
  expect(objs[0]).toMatchObject({ shape: 'parametric', shapeId: 'star-5', params: { inner: 60 } });
  expect(objs[0]).toMatchObject({ outline: RED, fill: BLUE });
});

test('stars favourites and remembers them', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('combobox', { name: 'Category' }).selectOption('favorites');
  await expect(gallery(page)).toContainText('No favourites yet');

  await page.getByRole('combobox', { name: 'Category' }).selectOption('nature');
  await gallery(page).getByRole('option', { name: 'Snowflake' }).click();
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('combobox', { name: 'Category' }).selectOption('favorites');
  await expect(gallery(page).getByRole('option')).toHaveCount(1);

  // The full gallery lists every category.
  await page.getByRole('button', { name: 'Show all shapes' }).click();
  const menu = page.getByRole('menu', { name: 'Shape gallery' });
  await expect(menu.getByRole('group')).toHaveCount(11);
  await menu.getByRole('menuitemradio', { name: 'Gear' }).click();
  await expect(page.getByRole('button', { name: 'Shape: Gear' })).toBeVisible();

  // Settings reach the disk after two short debounces and a flushed write; wait for the file.
  const saved = () =>
    JSON.parse(readFileSync(path.join(h.userData, 'settings.json'), 'utf8')) as {
      shapes?: { favorites?: string[] };
      tools?: Record<string, { shapeId?: string }>;
    };
  await expect.poll(() => saved().shapes?.favorites, { timeout: 10000 }).toEqual(['snowflake']);
  await expect.poll(() => saved().tools?.shape?.shapeId, { timeout: 10000 }).toBe('gear');
  await h.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
  );
  await h.app.close().catch(() => undefined);
  h = await relaunch(h);
  await ready(h.page);
  await h.page.getByRole('tab', { name: 'Shapes' }).click();
  await h.page.getByRole('combobox', { name: 'Category' }).selectOption('favorites');
  await expect(gallery(h.page).getByRole('option')).toHaveCount(1);
  await expect(gallery(h.page).getByRole('option', { name: 'Snowflake' })).toBeVisible();
  // The tool remembers the last shape.
  await expect(h.page.getByRole('button', { name: 'Shape: Gear' })).toBeVisible();
});
