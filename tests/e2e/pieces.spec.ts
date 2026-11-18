// Pieces in 1.2.0: made from a layer, a picture file or the clipboard, any size, anywhere.
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { docToScreen, drag, launchApp, pixel, ready, settle, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

async function stubOpen(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
}

/** A PNG w × h: red on the left half, blue on the right (drawn by the renderer's own canvas). */
async function twoColourPng(page: Page, w: number, h: number): Promise<string> {
  const bytes = await page.evaluate(
    async ([pw, ph]) => {
      const c = new OffscreenCanvas(pw, ph);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, pw / 2, ph);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(pw / 2, 0, pw / 2, ph);
      const blob = await c.convertToBlob({ type: 'image/png' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [w, h] as const,
  );
  const file = tempFile('wide.png');
  writeFileSync(file, Uint8Array.from(bytes));
  return file;
}

const red = (c: { r: number; g: number; b: number }) => c.r > 200 && c.g < 40 && c.b < 40;
const blue = (c: { r: number; g: number; b: number }) => c.b > 200 && c.r < 40 && c.g < 40;

test('Place image adds a piece wider than the canvas, centred and hanging off both sides', async () => {
  const { page } = h;
  const { width: W, height: H } = await page.evaluate(() => window.__pigmentoTest!.doc());
  await stubOpen(await twoColourPng(page, W * 2, 40));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Place image…' }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(1);
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  const info = await page.evaluate((pid) => window.__pigmentoTest!.pieceInfo(pid), id);
  expect(info).toMatchObject({ w: W * 2, h: 40, home: { x: -W / 2, y: Math.round((H - 40) / 2), w: W * 2, h: 40 } });
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('animate');
  // The canvas shows the middle of the picture: red up to its centre, blue after it.
  const y = Math.round(H / 2);
  expect(red(await pixel(page, 10, y))).toBe(true);
  expect(blue(await pixel(page, W - 10, y))).toBe(true);
  expect(red(await page.evaluate(([x, py]) => window.__pigmentoTest!.screenPixel(x, py), [10, y] as const))).toBe(true);
  expect(blue(await page.evaluate(([x, py]) => window.__pigmentoTest!.screenPixel(x, py), [W - 10, y] as const))).toBe(true);
  // One undo step takes it away again.
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(0);
});

test('pieces outside the canvas show faded around it, Fit takes them in, and the Animate tool grabs them there', async () => {
  const { page } = h;
  const { width: W, height: H } = await page.evaluate(() => window.__pigmentoTest!.doc());
  await stubOpen(await twoColourPng(page, W * 2, 40));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Place image…' }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(1);
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  // Fit: the whole picture, from half a canvas left of it to half a canvas right of it, is on screen.
  await page.keyboard.press('Control+0');
  await settle(page);
  const y = Math.round(H / 2);
  const box = await page.locator('.pg-view-canvas').boundingBox();
  for (const x of [-W / 2 + 2, W * 1.5 - 2]) {
    const s = await docToScreen(page, x, y);
    expect(s.x).toBeGreaterThan(box!.x);
    expect(s.x).toBeLessThan(box!.x + box!.width);
  }
  // Off the canvas it's faded over the workspace; turning it off leaves just the workspace.
  const outside = () => page.evaluate(([x, py]) => window.__pigmentoTest!.displayPixel(x, py), [-W / 4, y] as const);
  const shown = await outside();
  await page.getByRole('tab', { name: 'View' }).click();
  const toggle = page.locator('.ribbon').getByRole('button', { name: 'Pieces outside the canvas' });
  await toggle.click();
  const workspace = await outside();
  // Red at 40 % over the workspace, whatever colour the theme gives it.
  expect(Math.abs(shown.r - (0.4 * 255 + 0.6 * workspace.r))).toBeLessThan(12);
  expect(Math.abs(shown.b - 0.6 * workspace.b)).toBeLessThan(12);
  // Never in the picture itself, or exported: the composite only covers the canvas.
  await toggle.click();
  expect(await outside()).toEqual(shown);
  // Click the piece where it hangs off the canvas to pick it, then drag it from there.
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().selectedId)).toBeNull();
  const before = (await page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 0), id))!;
  await drag(page, [
    [-W / 4, y],
    [-W / 4 + 30, y + 10],
    [-W / 4 + 60, y + 20],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().selectedId)).toBe(id);
  const after = (await page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 0), id))!;
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(20, 0);
});

test('Piece from layer lifts the whole layer under the pieces already on it', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((lid) => window.__pigmentoTest!.fillLayer(lid, { r: 0, g: 200, b: 0, a: 255 }, { x: 40, y: 30, w: 100, h: 60 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(40, 30, 20, 20));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  const first = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  const before = await pixel(page, 100, 60);
  expect(await page.evaluate(() => window.__pigmentoTest!.pieceFromLayer(false))).toBe(true);
  const pieces = await page.evaluate(() => window.__pigmentoTest!.anim().pieces.map((p) => p.id));
  expect(pieces).toHaveLength(2);
  // The layer's pixels went under the piece that was already there.
  expect(pieces[1]).toBe(first);
  // Everything left on the layer (the first piece's hole is only the top-left corner).
  expect(await page.evaluate((pid) => window.__pigmentoTest!.pieceInfo(pid), pieces[0])).toMatchObject({ home: { x: 40, y: 30, w: 100, h: 60 } });
  expect(await pixel(page, 100, 60)).toEqual(before);
  // One undo step puts the layer back as it was, with one piece.
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().pieces.map((p) => p.id))).toEqual([first]);
  expect(await pixel(page, 100, 60)).toEqual(before);
});
