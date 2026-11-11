import { expect, test, type Page } from '@playwright/test';
import { docToScreen, drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

/** Brush tool, red, 10 px, hard. */
async function brush(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  const size = page.getByRole('textbox', { name: 'Size' });
  await size.fill('10');
  await size.press('Enter');
  const hard = page.getByRole('textbox', { name: 'Hardness' });
  await hard.fill('100');
  await hard.press('Enter');
}

async function symmetry(page: Page, mode: string, segments?: number): Promise<void> {
  await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
  const pop = page.getByRole('dialog', { name: 'Symmetry' });
  await pop.getByRole('radio', { name: mode }).click();
  if (segments !== undefined) {
    const box = pop.getByRole('textbox', { name: 'Segments' });
    await box.fill(String(segments));
    await box.press('Enter');
  }
  await page.keyboard.press('Escape');
}

test('mirrors strokes left–right, four ways and radially, around a movable centre', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await brush(page);
  await symmetry(page, 'Left–right');
  await expect(page.locator('.opt-pop-btn', { hasText: 'Symmetry' })).toContainText('Left–right');
  await drag(page, [
    [100, 100],
    [200, 100],
  ]);
  // The canvas is 1280 wide: the copy runs from 1180 to 1080.
  expect(await pixel(page, 150, 100)).toEqual(RED);
  expect(await pixel(page, 1130, 100)).toEqual(RED);
  expect(await pixel(page, 640, 100)).toEqual(WHITE);
  // One stroke, one undo step for both copies.
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 1130, 100)).toEqual(WHITE);

  // Drag the centre to x = 400; a stroke at 100 now mirrors to 700.
  await drag(page, [
    [640, 400],
    [400, 400],
  ]);
  await drag(page, [
    [100, 200],
    [120, 200],
  ]);
  expect(await pixel(page, 110, 200)).toEqual(RED);
  expect(await pixel(page, 690, 200)).toEqual(RED);
  expect(await pixel(page, 400, 400)).toEqual(WHITE);

  // Back to the middle, four ways: one dab gives four.
  await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
  await page.getByRole('dialog', { name: 'Symmetry' }).getByRole('button', { name: 'Centre on the canvas' }).click();
  await page.keyboard.press('Escape');
  await symmetry(page, 'Four ways');
  const s = await docToScreen(page, 300, 300);
  await page.mouse.click(s.x, s.y);
  for (const [x, y] of [
    [300, 300],
    [980, 300],
    [300, 500],
    [980, 500],
  ]) expect(await pixel(page, x, y)).toEqual(RED);

  // Radial with 3 segments: copies a third of a turn apart around (640, 400).
  await symmetry(page, 'Radial', 3);
  const r = await docToScreen(page, 640, 300);
  await page.mouse.click(r.x, r.y);
  expect(await pixel(page, 640, 300)).toEqual(RED);
  // 100 px above the centre, turned 120°: (640 + 86.6, 400 + 50).
  expect(await pixel(page, 727, 450)).toEqual(RED);
  expect(await pixel(page, 553, 450)).toEqual(RED);
  // Remembered for next time.
  await page.waitForTimeout(900);
  expect((await page.evaluate(() => window.pigmento.settings.get())).drawing).toEqual({ symmetry: 'radial', segments: 3 });
});

test('stabilises strokes and still ends where the pointer is released', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await brush(page);
  const smooth = page.getByRole('textbox', { name: 'Smoothing' });
  await smooth.fill('100');
  await smooth.press('Enter');
  // A short move stays inside the stabiliser's string: nothing is drawn there yet…
  const a = await docToScreen(page, 100, 300);
  const b = await docToScreen(page, 130, 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  const live = await page.evaluate(([x, y]) => window.__pigmentoTest!.screenPixel(x, y), [b.x, b.y] as const);
  expect(live.r).toBeGreaterThan(200);
  expect(live.g).toBeGreaterThan(200);
  // …until the pointer is let go: the stroke catches up to it.
  await page.mouse.up();
  expect(await pixel(page, 130, 300)).toEqual(RED);
  expect(await pixel(page, 115, 300)).toEqual(RED);

  // Shift draws a straight line from where the stroke started, ignoring the wobble.
  await smooth.fill('0');
  await smooth.press('Enter');
  const p0 = await docToScreen(page, 100, 500);
  const p1 = await docToScreen(page, 300, 560);
  const p2 = await docToScreen(page, 500, 500);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.keyboard.up('Shift');
  await page.mouse.up();
  expect(await pixel(page, 300, 500)).toEqual(RED);
  expect(await pixel(page, 300, 560)).toEqual(WHITE);
});
