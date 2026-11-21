// Drawings on pieces (side step after 1.3.0): lifted from a layer drawn frame by frame, and drawn on a piece with Paint on piece.
import { expect, test, type Page } from '@playwright/test';
import { drag, launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const RED = { r: 220, g: 30, b: 30, a: 255 };
const BLUE = { r: 30, g: 60, b: 220, a: 255 };
type Rgb = { r: number; g: number; b: number };
const isRed = (p: Rgb) => p.r > 180 && p.g < 90 && p.b < 90;
const isBlue = (p: Rgb) => p.b > 150 && p.r < 120;
const isPaper = (p: Rgb) => p.r > 240 && p.g > 240 && p.b > 240;

/** The picture's pixel (CPU path) at a frame. */
const pixelAt = (page: Page, frame: number, x: number, y: number) =>
  page.evaluate(([f, px, py]) => {
    window.__pigmentoTest!.setFrame(f);
    return window.__pigmentoTest!.pixel(px, py);
  }, [frame, x, y] as const);

test('Animate selection on a layer drawn frame by frame lifts every drawing, with its timing and loop', async () => {
  const { page } = h;
  const layer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  const ribbon = page.locator('.ribbon');
  // Drawing A (red) from frame 1, drawing B (blue) from frame 3, cycling.
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 300, y: 200, w: 120, h: 120 }), [layer, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  await ribbon.getByRole('button', { name: 'New drawing' }).click();
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 300, y: 200, w: 120, h: 120 }), [layer, BLUE] as const);
  await ribbon.getByRole('combobox', { name: 'Loop drawings' }).selectOption({ label: 'Cycle' });
  await page.evaluate(() => window.__pigmentoTest!.selectRect(280, 180, 160, 160));
  await ribbon.getByRole('button', { name: 'Animate selection' }).click();
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces).toHaveLength(1);
  const piece = info.pieces[0];
  expect(piece.drawings).toEqual([0, 2]);
  expect(piece.drawingLoop).toEqual({ mode: 'cycle', end: 4 });
  // The piece shows each drawing in turn, round and round.
  for (const [f, red] of [
    [0, true],
    [2, false],
    [5, true],
    [6, false],
  ] as const) {
    const p = await pixelAt(page, f, 360, 260);
    expect(red ? isRed(p) : isBlue(p), `frame ${f + 1}`).toBe(true);
  }
  // Both of the layer's drawings had the area lifted out: moved off, the piece leaves paper behind it.
  // (It was lifted at frame 3, so it has a keyframe there; one at frame 1 too.)
  await page.evaluate((id) => {
    window.__pigmentoTest!.setPieceKey(id, 2, { x: 900 });
    window.__pigmentoTest!.setPieceKey(id, 0, { x: 900 });
  }, piece.id);
  expect(isPaper(await pixelAt(page, 0, 360, 260))).toBe(true);
  expect(isPaper(await pixelAt(page, 2, 360, 260))).toBe(true);
  // Its drawings have a row of their own in the timeline.
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline.locator('.tl-drawings-row .tl-cel-start')).toHaveCount(2);
  await expect(timeline.getByRole('button', { name: 'Piece 1 · drawings', exact: true })).toBeVisible();
  // Undone (the two moves, then the lift): the layer has both drawings back, and there's no piece.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(0);
  expect(isRed(await pixelAt(page, 0, 360, 260))).toBe(true);
  expect(isBlue(await pixelAt(page, 2, 360, 260))).toBe(true);
});

test('with Paint on piece on, the drawing commands act on the piece and painting paints the drawing on show', async () => {
  const { page } = h;
  const layer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 500, y: 300, w: 200, h: 200 }), [layer, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(500, 300, 200, 200));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  // Paint on piece, then a copy of its drawing from frame 4.
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('b');
  await page.getByRole('checkbox', { name: 'Paint on piece' }).check();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(3));
  await page.getByRole('tab', { name: 'Animate' }).click();
  const ribbon = page.locator('.ribbon');
  await ribbon.getByRole('button', { name: 'Copy drawing' }).click();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0].drawings).toEqual([0, 3]);
  // The layer is untouched (still, with nothing drawn frame by frame).
  expect(await page.evaluate((l) => window.__pigmentoTest!.anim().cels[l], layer)).toBeUndefined();
  // A line across it on this drawing only.
  await drag(page, [
    [480, 400],
    [600, 400],
    [720, 400],
  ]);
  expect(isBlue(await pixelAt(page, 3, 600, 400))).toBe(true);
  expect(isRed(await pixelAt(page, 3, 600, 340))).toBe(true);
  expect(isRed(await pixelAt(page, 0, 600, 400))).toBe(true);
  // Looping Cycle from the ribbon: line, no line, line… on and on.
  await ribbon.getByRole('combobox', { name: 'Loop drawings' }).selectOption({ label: 'Cycle' });
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0].drawingLoop).toEqual({ mode: 'cycle', end: 6 });
  for (const [f, line] of [
    [6, false],
    [9, true],
    [13, false],
    [16, true],
  ] as const) {
    const p = await pixelAt(page, f, 600, 400);
    expect(line ? isBlue(p) : isRed(p), `frame ${f + 1}`).toBe(true);
  }
  // The screen shows what the picture has, on both drawings.
  for (const f of [0, 3]) {
    const pts = [
      { x: 600, y: 400 },
      { x: 600, y: 340 },
      { x: 520, y: 480 },
    ];
    const both = await page.evaluate(
      async ([n, p]) => {
        const t = window.__pigmentoTest!;
        t.setFrame(n);
        const screen = await t.screenPixels(p);
        return { screen, cpu: p.map((q) => t.pixel(q.x, q.y)) };
      },
      [f, pts] as const,
    );
    both.cpu.forEach((c, i) => {
      const s = both.screen[i];
      expect(Math.max(Math.abs(c.r - s.r), Math.abs(c.g - s.g), Math.abs(c.b - s.b)), `frame ${f + 1}, point ${i}`).toBeLessThanOrEqual(2);
    });
  }
  // Undo the line: only that drawing changes back.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(isRed(await pixelAt(page, 3, 600, 400))).toBe(true);
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0].drawings).toEqual([0, 3]);
});

test('Piece from layer on a layer drawn frame by frame takes every drawing', async () => {
  const { page } = h;
  const layer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  const ribbon = page.locator('.ribbon');
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 100, y: 100, w: 80, h: 80 }), [layer, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(4));
  await ribbon.getByRole('button', { name: 'New drawing' }).click();
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 300, y: 100, w: 80, h: 80 }), [layer, BLUE] as const);
  expect(await page.evaluate(() => window.__pigmentoTest!.pieceFromLayer(false))).toBe(true);
  const piece = (await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0];
  expect(piece.drawings).toEqual([0, 4]);
  // Its box covers both drawings; the picture looks the same at each frame.
  expect(await page.evaluate((id) => window.__pigmentoTest!.pieceInfo(id)!.home, piece.id)).toEqual({ x: 100, y: 100, w: 280, h: 80 });
  expect(isRed(await pixelAt(page, 0, 140, 140))).toBe(true);
  expect(isPaper(await pixelAt(page, 0, 340, 140))).toBe(true);
  expect(isBlue(await pixelAt(page, 5, 340, 140))).toBe(true);
  expect(isPaper(await pixelAt(page, 5, 140, 140))).toBe(true);
});
