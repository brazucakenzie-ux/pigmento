// Pieces in 1.2.0: made from a layer, a picture file or the clipboard, any size, anywhere.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { clickDoc, docToScreen, drag, launchApp, pixel, ready, settle, tempFile, type AppHandle } from './harness';

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

test('a repeating piece tiles across the canvas, scrolls, and looks the same on screen as in the picture', async () => {
  const { page } = h;
  const { width: W } = await page.evaluate(() => window.__pigmentoTest!.doc());
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((lid) => window.__pigmentoTest!.fillLayer(lid, { r: 220, g: 0, b: 0, a: 255 }, { x: 100, y: 50, w: 20, h: 20 }), layerId);
  await page.evaluate((lid) => window.__pigmentoTest!.fillLayer(lid, { r: 0, g: 0, b: 220, a: 255 }, { x: 120, y: 50, w: 20, h: 20 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 50, 40, 20));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
  // Repeat across from the options bar; the Scroll X field appears with it.
  await page.getByRole('combobox', { name: 'Repeat' }).selectOption({ label: 'Across' });
  await expect(page.getByRole('textbox', { name: 'Scroll X', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Scroll Y', exact: true })).toHaveCount(0);
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { scrollX: 7.5 }), id);
  // Copies all the way across, red and blue in turn, slid 7.5 px right; the same on screen.
  const xs = [3, 27.5, 101, 118, 133, W - 4].map(Math.floor);
  for (const x of xs) {
    const js = await pixel(page, x, 60);
    const gpu = await page.evaluate(([px, py]) => window.__pigmentoTest!.screenPixel(px, py), [x, 60] as const);
    for (const k of ['r', 'g', 'b', 'a'] as const) expect(Math.abs(js[k] - gpu[k])).toBeLessThanOrEqual(3);
    // Piece pixel (x - 100 - 7.5) mod 40: the first half is red.
    const local = (((x + 0.5 - 100 - 7.5) % 40) + 40) % 40;
    if (local > 1 && local < 19) expect(js.r).toBeGreaterThan(200);
    if (local > 21 && local < 39) expect(js.b).toBeGreaterThan(200);
  }
  // Above and below the strip there's nothing but the paper.
  expect(await pixel(page, 5, 40)).toEqual(await pixel(page, 5, 10));
});

test('Paint on piece paints a scaled piece’s own pixels under the brush, as one undo step', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((lid) => window.__pigmentoTest!.fillLayer(lid, { r: 0, g: 200, b: 0, a: 255 }, { x: 100, y: 100, w: 40, h: 40 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 40, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
  // Twice the size, about its middle (120, 120): it covers 80…160 on the canvas.
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { sx: 2, sy: 2 }), id);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.keyboard.press('b');
  const paintOn = page.getByRole('checkbox', { name: 'Paint on piece' });
  await paintOn.check();
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().paintOnPiece)).toBe(true);
  const before = await page.evaluate(() => window.__pigmentoTest!.history().index);
  // Across the canvas from 90 to 150 at y = 140: piece pixels 5 … 35 at y = 30.
  await drag(page, [
    [90, 140],
    [120, 140],
    [150, 140],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.history().index)).toBe(before + 1);
  const ink = await page.evaluate((pid) => window.__pigmentoTest!.piecePixel(pid, 20, 30), id);
  expect(ink!.g).toBeLessThan(100);
  // Elsewhere the piece is untouched, and so is the layer under it (the brush went to the piece).
  expect(await page.evaluate((pid) => window.__pigmentoTest!.piecePixel(pid, 20, 5), id)).toEqual({ r: 0, g: 200, b: 0, a: 255 });
  expect((await pixel(page, 30, 140)).g).toBeGreaterThan(200);
  // On the canvas the stroke shows where it was drawn, the same on screen.
  const js = await pixel(page, 120, 140);
  const gpu = await page.evaluate(() => window.__pigmentoTest!.screenPixel(120, 140));
  expect(js.g).toBeLessThan(100);
  for (const k of ['r', 'g', 'b'] as const) expect(Math.abs(js[k] - gpu[k])).toBeLessThanOrEqual(3);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate((pid) => window.__pigmentoTest!.piecePixel(pid, 20, 30), id)).toEqual({ r: 0, g: 200, b: 0, a: 255 });
  // A locked layer's pieces can't be painted.
  await page.evaluate((lid) => window.__pigmentoTest!.setLayerProps(lid, { locked: true }), layerId);
  await drag(page, [
    [90, 140],
    [150, 140],
  ]);
  expect(await page.evaluate((pid) => window.__pigmentoTest!.piecePixel(pid, 20, 30), id)).toEqual({ r: 0, g: 200, b: 0, a: 255 });
  await page.evaluate((lid) => window.__pigmentoTest!.setLayerProps(lid, { locked: false }), layerId);
  // Fill paints the piece too, from the piece pixel under the pointer.
  await page.keyboard.press('f');
  await expect(paintOn).toBeChecked();
  await clickDoc(page, 130, 100);
  await expect.poll(() => page.evaluate((pid) => window.__pigmentoTest!.piecePixel(pid, 2, 2)!.g, id)).toBeLessThan(100);
  expect((await pixel(page, 30, 140)).g).toBeGreaterThan(200);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('b');
  // Turned off, the brush paints the layer again.
  await paintOn.uncheck();
  await drag(page, [
    [20, 20],
    [40, 20],
  ]);
  expect((await pixel(page, 30, 20)).g).toBeLessThan(100);
});

/** Decode a GIF in the page and read some pixels (frame, x, y). */
async function gifPixels(page: Page, file: string, probes: { frame: number; x: number; y: number }[]): Promise<{ frames: number; pixels: number[][] }> {
  const b64 = readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ b64, probes }) => {
      const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/gif' });
      await dec.tracks.ready;
      await dec.completed;
      const pixels: number[][] = [];
      for (const p of probes) {
        const { image } = await dec.decode({ frameIndex: p.frame });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        pixels.push(Array.from(ctx.getImageData(p.x, p.y, 1, 1).data));
        image.close();
      }
      return { frames: dec.tracks.selectedTrack!.frameCount, pixels };
    },
    { b64, probes },
  );
}

test('a scrolling background: placed twice as wide, looped, painted off the canvas, saved, reopened and exported', async () => {
  const { page } = h;
  const { width: W, height: H } = await page.evaluate(() => window.__pigmentoTest!.doc());
  await stubOpen(await twoColourPng(page, W * 2, 40));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Place image…' }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(1);
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  const n = await page.evaluate(() => window.__pigmentoTest!.anim().length);
  // Repeat across, then loop the scroll: one whole tile (two canvases) over the timeline.
  await page.getByRole('combobox', { name: 'Repeat' }).selectOption({ label: 'Across' });
  await page.getByRole('button', { name: /^Loop the scroll/ }).click();
  expect((await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id)).map((k) => k.frame)).toEqual([0, n - 1]);
  const half = Math.floor(n / 2);
  expect((await page.evaluate(([pid, f]) => window.__pigmentoTest!.pieceAt(pid, f), [id, half] as const))!.scrollX).toBeCloseTo((-half * 2 * W) / n, 6);

  // At frame 0 the left quarter of the picture hangs off the canvas: paint a dash on it there.
  const y = Math.round((H - 40) / 2) + 20;
  await page.keyboard.press('Control+0');
  await settle(page);
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.keyboard.press('b');
  await page.getByRole('checkbox', { name: 'Paint on piece' }).check();
  await drag(page, [
    [-W / 4 - 20, y],
    [-W / 4, y],
    [-W / 4 + 20, y],
  ]);
  const dark = (c: { r: number; g: number; b: number }) => c.r < 80 && c.g < 80 && c.b < 80;
  // Picture x −W/4 is the piece's own pixel W/4 (it was placed half a canvas left of the canvas).
  expect(dark((await page.evaluate(([pid, px]) => window.__pigmentoTest!.piecePixel(pid, px, 20), [id, W / 4] as const))!)).toBe(true);
  // Nothing on the canvas changed at frame 0…
  expect(dark(await pixel(page, W / 4, y))).toBe(false);
  // …but as the background scrolls left by one canvas, the dash comes in three quarters of the way across.
  await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), half);
  const at = Math.round(-W / 4 - (half * 2 * W) / n + 2 * W);
  expect(dark(await pixel(page, at, y))).toBe(true);

  // Saved and opened again, it's all there.
  const project = tempFile('scroll.pigm');
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const back = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  expect(await page.evaluate((pid) => window.__pigmentoTest!.pieceInfo(pid), back)).toMatchObject({ w: W * 2, h: 40 });
  expect((await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), back)).map((k) => k.frame)).toEqual([0, n - 1]);
  await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), half);
  expect(dark(await pixel(page, at, y))).toBe(true);

  // An animated GIF shows the dash coming in.
  const gif = tempFile('scroll.gif');
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, gif);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const out = await gifPixels(page, gif, [
    { frame: 0, x: at, y },
    { frame: half, x: at, y },
  ]);
  expect(out.frames).toBe(n);
  expect(out.pixels[0][0] > 80 || out.pixels[0][2] > 80).toBe(true);
  expect(out.pixels[1].slice(0, 3).every((v) => v < 80)).toBe(true);
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
