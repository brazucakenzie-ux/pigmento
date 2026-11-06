import { expect, test, type Page } from '@playwright/test';
import { clickDoc, drag, launchApp, pixel, ready, relaunch, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61 };
const BLUE = { r: 30, g: 136, b: 229 };
const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
const live = (page: Page) => page.evaluate(() => window.__pigmentoTest!.liveKind());
const hist = (page: Page) => page.evaluate(() => window.__pigmentoTest!.history());

/** Primary red, secondary blue (from the palette). */
async function pickColours(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
}

test('places a live gradient, adjusts it, and applies it as one step', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await pickColours(page);
  await page.keyboard.press('g');
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('gradient');
  await drag(page, [
    [100, 100],
    [500, 100],
  ]);
  expect(await live(page)).toBe('gradient');
  expect((await hist(page)).length).toBe(0);
  // The ends stay draggable: pull the end further out before applying.
  await drag(page, [
    [500, 100],
    [700, 100],
  ]);
  await page.keyboard.press('Enter');
  expect(await live(page)).toBeNull();
  await expect(page.locator('.history-list li', { hasText: 'Gradient' })).toHaveCount(1);
  expect(near(await pixel(page, 50, 300), RED)).toBeLessThanOrEqual(1);
  expect(near(await pixel(page, 900, 300), BLUE)).toBeLessThanOrEqual(1);
  const mid = await pixel(page, 400, 300);
  expect(near(mid, { r: (RED.r + BLUE.r) / 2, g: (RED.g + BLUE.g) / 2, b: (RED.b + BLUE.b) / 2 })).toBeLessThanOrEqual(3);

  // Radial, reversed, reflected, inside a selection only.
  await page.keyboard.press('Control+z');
  await page.evaluate(() => window.__pigmentoTest!.selectRect(200, 200, 400, 300));
  await page.getByRole('radio', { name: 'Radial' }).click();
  await page.getByRole('button', { name: 'Reverse' }).click();
  await page.getByRole('radio', { name: 'Reflect' }).click();
  await drag(page, [
    [400, 350],
    [500, 350],
  ]);
  await page.keyboard.press('Enter');
  // Reversed: the centre has the secondary colour; reflected: two radii out it's back to blue.
  expect(near(await pixel(page, 400, 350), BLUE)).toBeLessThanOrEqual(2);
  expect(near(await pixel(page, 499, 350), RED)).toBeLessThanOrEqual(6);
  expect(near(await pixel(page, 599, 350), BLUE)).toBeLessThanOrEqual(6);
  // Outside the selection nothing changed.
  expect(await pixel(page, 150, 350)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test('edits gradient colours with presets and stops', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  // Red and blue picked, so the presets are clearly different from primary → secondary.
  await pickColours(page);
  await page.keyboard.press('g');
  await page.getByRole('button', { name: /^Colours:/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit gradient' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByLabel('Use the primary and secondary colours')).toBeChecked();
  await dlg.getByRole('button', { name: 'Spectrum' }).click();
  await expect(dlg.locator('.gradient-stop')).toHaveCount(7);
  await dlg.getByRole('button', { name: 'Black to white' }).click();
  await expect(dlg.getByLabel('Use the primary and secondary colours')).not.toBeChecked();
  await expect(dlg.locator('.gradient-stop')).toHaveCount(2);
  // Clicking the bar adds a stop; it can be deleted again.
  const bar = dlg.locator('.gradient-bar');
  const box = (await bar.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dlg.locator('.gradient-stop')).toHaveCount(3);
  await expect(dlg.getByRole('button', { name: 'Stop at 50%' })).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('button', { name: 'Delete stop' }).click();
  await expect(dlg.locator('.gradient-stop')).toHaveCount(2);
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(dlg).toBeHidden();

  await drag(page, [
    [0, 100],
    [1280, 100],
  ]);
  await page.keyboard.press('Enter');
  const left = await pixel(page, 2, 400);
  const right = await pixel(page, 1277, 400);
  expect(Math.max(left.r, left.g, left.b)).toBeLessThanOrEqual(2);
  expect(Math.min(right.r, right.g, right.b)).toBeGreaterThanOrEqual(253);
  // The choice is remembered.
  await page.getByRole('button', { name: /^Colours:/ }).click();
  await expect(dlg.getByLabel('Use the primary and secondary colours')).not.toBeChecked();
  await page.keyboard.press('Escape');
});

test('fills with built-in patterns and with a pattern made from a selection, which is kept', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await pickColours(page);
  await page.keyboard.press('f');
  await page.getByRole('radio', { name: 'Pattern', exact: true }).click();
  await page.getByRole('button', { name: /^Pattern: / }).click();
  await page.getByRole('menuitemradio', { name: 'Stripes' }).click();
  await expect(page.getByRole('button', { name: 'Pattern: Stripes' })).toBeVisible();
  await clickDoc(page, 640, 400);
  // The fill runs in a worker.
  await expect.poll(async () => near(await pixel(page, 10, 1), RED)).toBe(0);
  // Stripes tile: 4 px of the primary colour, then 8 px of the secondary, from the canvas top.
  expect(near(await pixel(page, 10, 1), RED)).toBe(0);
  expect(near(await pixel(page, 10, 8), BLUE)).toBe(0);
  expect(near(await pixel(page, 10, 13), RED)).toBe(0);
  await expect(page.locator('.history-list li', { hasText: 'Pattern fill' })).toHaveCount(1);

  // Make a pattern from a 2×1 selection: one red and one blue pixel side by side.
  await page.keyboard.press('Control+z');
  await page.evaluate(([red, blue]) => {
    const k = window.__pigmentoTest!;
    const id = k.layers().activeId;
    k.fillLayer(id, { ...red, a: 255 }, { x: 0, y: 0, w: 1, h: 1 });
    k.fillLayer(id, { ...blue, a: 255 }, { x: 1, y: 0, w: 1, h: 1 });
    k.selectRect(0, 0, 2, 1);
  }, [RED, BLUE] as const);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Make pattern from selection' }).click();
  await expect(page.getByText('Saved “Pattern 1”')).toBeVisible();
  await page.keyboard.press('Control+d');
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: 'Pattern: Pattern 1' })).toBeVisible();
  await clickDoc(page, 640, 400);
  await expect.poll(async () => near(await pixel(page, 100, 300), RED)).toBe(0);
  expect(near(await pixel(page, 101, 300), BLUE)).toBe(0);
  expect(near(await pixel(page, 102, 301), RED)).toBe(0);

  // Saved patterns are still there after a restart.
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  h = await relaunch(h);
  await ready(h.page);
  await h.page.keyboard.press('f');
  await h.page.getByRole('radio', { name: 'Pattern', exact: true }).click();
  await h.page.getByRole('button', { name: /^Pattern: / }).click();
  await h.page.getByRole('menuitemradio', { name: 'Pattern 1' }).click();
  await h.page.getByRole('button', { name: 'Pattern: Pattern 1' }).click();
  await h.page.getByRole('menuitem', { name: 'Delete this pattern' }).click();
  await expect(h.page.getByRole('button', { name: 'Pattern: Checks' })).toBeVisible();
  await h.page.getByRole('button', { name: /^Pattern: / }).click();
  await expect(h.page.getByRole('menuitemradio', { name: 'Pattern 1' })).toHaveCount(0);
  await h.page.keyboard.press('Escape');
});
