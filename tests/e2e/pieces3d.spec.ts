// Pieces in 3D (1.2.0): drawn on the GPU, matching the CPU path used for flatten and still export.
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

/** A 240 × 120 piece of four colour bands, lifted at (200, 140); returns its id. */
async function bandedPiece(page: Page): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  const bands = [
    { r: 230, g: 40, b: 40, a: 255 },
    { r: 40, g: 200, b: 60, a: 255 },
    { r: 40, g: 80, b: 230, a: 255 },
    { r: 240, g: 200, b: 30, a: 255 },
  ];
  for (const [i, c] of bands.entries()) {
    await page.evaluate(([lid, col, x]) => window.__pigmentoTest!.fillLayer(lid as string, col as { r: number; g: number; b: number; a: number }, { x: x as number, y: 140, w: 60, h: 120 }), [layerId, c, 200 + i * 60] as const);
  }
  await page.evaluate(() => window.__pigmentoTest!.selectRect(200, 140, 240, 120));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  return page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
}

/**
 * Compare the screen (GPU) with the picture (CPU path) on a grid inside r: the share of grid
 * points that differ by more than `tol` in some channel.
 */
async function mismatch(page: Page, r: { x: number; y: number; w: number; h: number }, step: number, tol: number): Promise<{ checked: number; off: number; painted: number }> {
  return page.evaluate(
    async ({ r, step, tol }) => {
      const t = window.__pigmentoTest!;
      let checked = 0;
      let off = 0;
      let painted = 0;
      for (let y = r.y; y < r.y + r.h; y += step) {
        for (let x = r.x; x < r.x + r.w; x += step) {
          const js = t.pixel(x, y);
          const gpu = await t.screenPixel(x, y);
          checked++;
          if (js.r < 200 || js.g < 200 || js.b < 200) painted++;
          if (Math.max(Math.abs(js.r - gpu.r), Math.abs(js.g - gpu.g), Math.abs(js.b - gpu.b)) > tol) off++;
        }
      }
      return { checked, off, painted };
    },
    { r, step, tol },
  );
}

test('a tilted and turned piece looks the same on screen as in the picture, and flat pieces are untouched', async () => {
  const { page } = h;
  expect(await page.evaluate(() => window.__pigmentoTest!.gpuPlanes())).toBe(true);
  const id = await bandedPiece(page);
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { tilt: 0.7, turn: -0.4, depth: 150 }), id);
  // Smaller and slanted round its pivot, and the screen agrees with the picture except along the band edges.
  const m = await mismatch(page, { x: 150, y: 100, w: 340, h: 200 }, 9, 24);
  expect(m.painted).toBeGreaterThan(m.checked / 8);
  expect(m.painted).toBeLessThan(m.checked / 2);
  expect(m.off).toBeLessThan(m.checked * 0.02);
  // Pushed back only (no tilt or turn), it stays a flat piece: smaller, centred on its pivot.
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { tilt: 0, turn: 0, depth: 0 }), id);
  const flat = await mismatch(page, { x: 205, y: 145, w: 230, h: 110 }, 15, 2);
  expect(flat.off).toBe(0);
});

test('the Perspective plane tool tilts, turns and pushes a piece back, with fields that key it', async () => {
  const { page } = h;
  const id = await bandedPiece(page);
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('plane');
  const state = () => page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 0)!, id);
  // The top handle (the middle of the top edge, at 320, 140) dragged 60 px down tilts the top back.
  await drag(page, [
    [320, 140],
    [320, 170],
    [320, 200],
  ]);
  expect((await state()).tilt).toBeCloseTo(60 / 150, 1);
  // The right-hand handle dragged 45 px in turns it like a door.
  const before = await state();
  const right = await page.evaluate(([pid]) => {
    // Where the middle of its right edge shows now (it's tilted).
    return window.__pigmentoTest!.pieceHandle(pid as string, 240, 60);
  }, [id] as const);
  await drag(page, [
    [right.x, right.y],
    [right.x - 25, right.y],
    [right.x - 45, right.y],
  ]);
  expect((await state()).turn - before.turn).toBeCloseTo(45 / 150, 1);
  // Ctrl-drag up on the sheet (beside the pivot, which has a handle of its own) pushes it away;
  // the fields show it and set it.
  await page.keyboard.down('Control');
  await drag(page, [
    [290, 200],
    [290, 150],
  ]);
  await page.keyboard.up('Control');
  expect((await state()).depth).toBeGreaterThan(100);
  const depth = page.getByRole('textbox', { name: 'Depth', exact: true });
  await depth.fill('400');
  await depth.press('Enter');
  expect((await state()).depth).toBeCloseTo(400, 6);
  await page.getByRole('textbox', { name: 'Tilt', exact: true }).fill('0');
  await page.getByRole('textbox', { name: 'Tilt', exact: true }).press('Enter');
  expect((await state()).tilt).toBe(0);
  // Each change is one undo step.
  await page.keyboard.press('Control+z');
  expect((await state()).tilt).toBeCloseTo(60 / 150, 1);
});

test('a repeating floor runs to the horizon on screen as in the picture, and a hidden back isn’t drawn', async () => {
  const { page } = h;
  const id = await bandedPiece(page);
  const { height: H } = await page.evaluate(() => window.__pigmentoTest!.doc());
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceRepeat(pid, 'both'), id);
  // Laid flat, below the vanishing point: a floor to the horizon.
  await page.evaluate(([pid, y]) => window.__pigmentoTest!.setPieceKey(pid, 0, { tilt: Math.PI / 2, y }), [id, Math.round(H * 0.8)] as const);
  // Near the camera the bands are wide and the two agree; towards the horizon, where bands get thinner
  // than a pixel, the GPU's anisotropic filtering and the CPU's mip levels average them a little differently.
  const near = await mismatch(page, { x: 20, y: Math.round(H * 0.85), w: 600, h: Math.round(H * 0.14) }, 23, 32);
  expect(near.painted).toBeGreaterThan(near.checked * 0.9);
  expect(near.off).toBeLessThan(near.checked * 0.06);
  // So far off, compare what an area averages to rather than pixel by pixel.
  const avg = await page.evaluate(async (y0) => {
    const t = window.__pigmentoTest!;
    const js = [0, 0, 0];
    const gpu = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y0 + 60; y += 3) {
      for (let x = 40; x < 600; x += 7) {
        const a = t.pixel(x, y);
        const b = await t.screenPixel(x, y);
        js[0] += a.r;
        js[1] += a.g;
        js[2] += a.b;
        gpu[0] += b.r;
        gpu[1] += b.g;
        gpu[2] += b.b;
        n++;
      }
    }
    return { js: js.map((v) => v / n), gpu: gpu.map((v) => v / n) };
  }, Math.round(H * 0.6));
  for (let k = 0; k < 3; k++) expect(Math.abs(avg.js[k] - avg.gpu[k])).toBeLessThan(20);
  // Above the horizon there's only the paper, on screen and in the picture.
  const sky = await page.evaluate(async (y) => [window.__pigmentoTest!.pixel(300, y), await window.__pigmentoTest!.screenPixel(300, y)], Math.round(H * 0.3));
  expect(sky[0]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(sky[1]).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  // Turned round with its back hidden, it isn't drawn at all.
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceRepeat(pid, 'none'), id);
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { tilt: 0, y: 200, turn: Math.PI - 0.3 }), id);
  expect((await page.evaluate(() => window.__pigmentoTest!.pixel(320, 200))).b).toBeLessThan(200);
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceBack(pid, 'hide'), id);
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(320, 200))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(320, 200))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test('the camera: drag its vanishing point, set its perspective, and show the grid guide', async () => {
  const { page } = h;
  const { width: W, height: H } = await page.evaluate(() => window.__pigmentoTest!.doc());
  const id = await bandedPiece(page);
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { turn: 0.6 }), id);
  await page.keyboard.press('m');
  const camera = () => page.evaluate(() => window.__pigmentoTest!.anim().camera);
  expect(await camera()).toEqual({ x: W / 2, y: H / 2, strength: 50 });
  const corner = () => page.evaluate((pid) => window.__pigmentoTest!.pieceHandle(pid, 240, 0), id);
  const before = await corner();
  // The vanishing point, dragged 200 px left and 100 up: the turned piece is seen from elsewhere.
  await drag(page, [
    [W / 2, H / 2],
    [W / 2 - 100, H / 2 - 50],
    [W / 2 - 200, H / 2 - 100],
  ]);
  const moved = await camera();
  expect(moved.x).toBeCloseTo(W / 2 - 200, 0);
  expect(moved.y).toBeCloseTo(H / 2 - 100, 0);
  const after = await corner();
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(2);
  // Perspective strength from the options bar (and the same field on the Animate tab).
  const field = page.locator('.optionsbar').getByRole('textbox', { name: 'Perspective', exact: true });
  await field.fill('90');
  await field.press('Enter');
  expect((await camera()).strength).toBe(90);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await expect(page.locator('.ribbon').getByRole('textbox', { name: 'Perspective', exact: true })).toHaveValue('90');
  // One undo step each.
  await page.keyboard.press('Control+z');
  expect((await camera()).strength).toBe(50);
  await page.keyboard.press('Control+z');
  expect((await camera()).x).toBe(W / 2);
  // The perspective grid guide is a View option (on screen only).
  await page.getByRole('tab', { name: 'View' }).click();
  const grid = page.locator('.ribbon').getByRole('button', { name: 'Perspective grid' });
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(5, 5))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});
