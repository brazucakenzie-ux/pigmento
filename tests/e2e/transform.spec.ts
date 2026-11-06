import { expect, test, type Page } from '@playwright/test';
import { drag, launchApp, pixel, ready, type AppHandle } from './harness';

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

const corners = (page: Page) => page.evaluate(() => window.__pigmentoTest!.transformCorners());
const info = (page: Page) => page.evaluate(() => window.__pigmentoTest!.transformInfo());
const live = (page: Page) => page.evaluate(() => window.__pigmentoTest!.liveKind());
const tool = (page: Page) => page.evaluate(() => window.__pigmentoTest!.tool());
const hist = (page: Page) => page.evaluate(() => window.__pigmentoTest!.history());

async function setField(page: Page, label: string, value: string): Promise<void> {
  const f = page.getByRole('toolbar').getByLabel(label, { exact: true });
  await f.fill(value);
  await f.press('Enter');
}

test('transforms a whole layer; Esc puts it back, Apply is one undoable step', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate((red) => {
    const k = window.__pigmentoTest!;
    k.fillLayer(k.layers().activeId, red, { x: 100, y: 100, w: 100, h: 50 });
  }, RED);
  const before = await tool(page);

  // Nothing selected: Ctrl+T takes the whole layer's content.
  await page.keyboard.press('Control+t');
  expect(await live(page)).toBe('transform');
  expect(await tool(page)).toBe('transform');
  expect(await corners(page)).toEqual([
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 150 },
    { x: 100, y: 150 },
  ]);
  await drag(page, [
    [200, 150],
    [300, 250],
  ]);
  const c = (await corners(page))!;
  expect(c[0]).toEqual({ x: 100, y: 100 });
  expect(c[2].x).toBeCloseTo(300, 0);
  expect(c[2].y).toBeCloseTo(250, 0);
  // Not applied yet: the layer still holds the original pixels.
  expect(await pixel(page, 150, 120)).toEqual(RED);
  expect(await pixel(page, 280, 230)).toEqual(WHITE);
  expect((await hist(page)).length).toBe(0);

  await page.keyboard.press('Escape');
  expect(await live(page)).toBeNull();
  expect(await tool(page)).toBe(before);
  expect(await pixel(page, 150, 120)).toEqual(RED);
  expect((await hist(page)).length).toBe(0);

  // Number fields: double the width about the centre, then apply from the options bar.
  await page.keyboard.press('Control+t');
  expect(await info(page)).toMatchObject({ x: 150, y: 125, w: 100, h: 100, angle: 0, skew: 0, distorted: false });
  await setField(page, 'Width', '200');
  expect((await info(page))!.w).toBeCloseTo(200, 6);
  await page.getByRole('toolbar').getByRole('button', { name: 'Apply' }).click();
  expect(await live(page)).toBeNull();
  expect(await tool(page)).toBe(before);
  expect(await pixel(page, 60, 120)).toEqual(RED);
  expect(await pixel(page, 245, 145)).toEqual(RED);
  expect(await pixel(page, 40, 120)).toEqual(WHITE);
  await expect(page.locator('.history-list li', { hasText: 'Free transform' })).toHaveCount(1);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 60, 120)).toEqual(WHITE);
  expect(await pixel(page, 150, 120)).toEqual(RED);
});

test('rotates a selection by the numbers and keeps the transformed selection', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate((blue) => {
    const k = window.__pigmentoTest!;
    k.fillLayer(k.layers().activeId, blue, { x: 300, y: 300, w: 200, h: 100 });
  }, BLUE);
  await page.keyboard.press('s');
  await page.evaluate(() => window.__pigmentoTest!.selectRect(300, 300, 200, 100));
  await page.keyboard.press('Control+t');
  // Enter in the field sets the angle and returns to the canvas; the next Enter applies.
  await setField(page, 'Angle', '90');
  expect(await live(page)).toBe('transform');
  expect((await info(page))!.angle).toBeCloseTo(90, 6);
  await page.keyboard.press('Enter');
  await expect.poll(() => live(page)).toBeNull();
  expect(await tool(page)).toBe('select');
  // 200×100 about its centre (400, 350): now 100×200.
  expect(await page.evaluate(() => window.__pigmentoTest!.selection())).toEqual({ x: 350, y: 250, w: 100, h: 200 });
  expect(await pixel(page, 400, 260)).toEqual(BLUE);
  expect(await pixel(page, 310, 320)).toEqual(WHITE);
  expect(await pixel(page, 490, 380)).toEqual(WHITE);
});

test('distorts with Ctrl and makes perspective from the options bar', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate((blue) => {
    const k = window.__pigmentoTest!;
    k.fillLayer(k.layers().activeId, blue, { x: 200, y: 200, w: 400, h: 200 });
  }, BLUE);
  await page.keyboard.press('Control+t');
  // Ctrl+drag a corner moves just that corner.
  await page.keyboard.down('Control');
  await drag(page, [
    [600, 200],
    [700, 150],
  ]);
  await page.keyboard.up('Control');
  let c = (await corners(page))!;
  expect(c[1].x).toBeCloseTo(700, 0);
  expect(c[1].y).toBeCloseTo(150, 0);
  expect(c[0]).toEqual({ x: 200, y: 200 });
  expect((await info(page))!.distorted).toBe(true);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+t');
  await page.getByRole('radio', { name: 'Perspective' }).click();
  // Pull the top-left corner in: the top-right one comes in the same amount.
  await drag(page, [
    [200, 200],
    [300, 200],
  ]);
  c = (await corners(page))!;
  expect(c[0].x).toBeCloseTo(300, 0);
  expect(c[1].x).toBeCloseTo(500, 0);
  expect(c[2]).toEqual({ x: 600, y: 400 });
  await page.getByRole('toolbar').getByRole('button', { name: 'Apply' }).click();
  // A trapezoid: narrow at the top, full width at the bottom.
  expect(await pixel(page, 250, 210)).toEqual(WHITE);
  expect(await pixel(page, 400, 210)).toEqual(BLUE);
  expect(await pixel(page, 210, 395)).toEqual(BLUE);
});

test('carries on from a moved floating selection, nudges and flips', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate(([red, blue]) => {
    const k = window.__pigmentoTest!;
    const id = k.layers().activeId;
    k.fillLayer(id, red, { x: 100, y: 100, w: 50, h: 50 });
    k.fillLayer(id, blue, { x: 150, y: 100, w: 50, h: 50 });
  }, [RED, BLUE] as const);
  await page.keyboard.press('s');
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 100, 50));
  // Move it 200 px right as a floating selection, then free-transform without changing it.
  await drag(page, [
    [150, 125],
    [350, 125],
  ]);
  expect(await live(page)).toBe('float');
  await page.keyboard.press('Control+t');
  expect(await live(page)).toBe('transform');
  expect((await corners(page))![0]).toEqual({ x: 300, y: 100 });
  // Arrow keys nudge the transform; the flip button mirrors it in place.
  await page.mouse.move(5, 5);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  expect((await corners(page))![0]).toEqual({ x: 300, y: 103 });
  await page.getByRole('toolbar').getByRole('button', { name: 'Flip horizontally' }).click();
  await page.keyboard.press('Enter');
  await expect.poll(() => live(page)).toBeNull();
  // The earlier move counts, and the halves swapped sides.
  expect(await pixel(page, 120, 120)).toEqual(WHITE);
  expect(await pixel(page, 320, 130)).toEqual(BLUE);
  expect(await pixel(page, 380, 130)).toEqual(RED);
});
