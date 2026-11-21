// The user's test for drawings on pieces: a flat red square, then (not moved) the same square with
// a blue line across it, cycling between the two for the whole animation; saved, reopened, exported.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { drag, launchApp, ready, tempFile, type AppHandle } from './harness';

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
type Rgb = { r: number; g: number; b: number };
const isRed = (p: Rgb) => p.r > 180 && p.g < 90 && p.b < 90;
const isBlue = (p: Rgb) => p.b > 150 && p.r < 120;
const FRAMES = 24;
/** Where the line goes across the square (500…700 × 300…500), a point above it, and the square's corner. */
const ON_LINE = { x: 600, y: 400 };
const OFF_LINE = { x: 600, y: 330 };
const CORNER = { x: 505, y: 495 };
const OUTSIDE = { x: 495, y: 400 };

/** The probes at a frame: from the picture (CPU), the screen, or an export frame. */
function read(page: Page, frame: number, from: 'cpu' | 'screen' | 'export'): Promise<Rgb[]> {
  return page.evaluate(
    async ([f, pts, src]) => {
      const t = window.__pigmentoTest!;
      t.setFrame(f);
      if (src === 'screen') return t.screenPixels([...pts]);
      return pts.map((p) => (src === 'cpu' ? t.pixel(p.x, p.y) : t.exportFramePixel(f, p.x, p.y)));
    },
    [frame, [ON_LINE, OFF_LINE, CORNER, OUTSIDE], from] as const,
  );
}

/** Frame f shows the line on every other frame (the second drawing), the plain square otherwise, never moving. */
function check(f: number, [on, off, corner, outside]: Rgb[], where: string): void {
  const line = f % 2 === 1;
  expect(line ? isBlue(on) : isRed(on), `${where}, frame ${f + 1}: line`).toBe(true);
  expect(isRed(off), `${where}, frame ${f + 1}: square`).toBe(true);
  expect(isRed(corner), `${where}, frame ${f + 1}: corner`).toBe(true);
  expect(isRed(outside) || isBlue(outside), `${where}, frame ${f + 1}: outside`).toBe(false);
}

test('a red square, then the same square with a blue line across it, cycling for the whole animation without moving', async () => {
  const { page, app } = h;
  // Blue for the line to come.
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  // A flat red square, lifted with Animate selection: its first drawing.
  const layer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 500, y: 300, w: 200, h: 200 }), [layer, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(500, 300, 200, 200));
  await page.getByRole('tab', { name: 'Animate' }).click();
  const ribbon = page.locator('.ribbon');
  await ribbon.getByRole('button', { name: 'Animate selection' }).click();
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
  const keys0 = await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id);

  // Its second drawing, on frame 2: a copy with a blue line drawn across it, painting on the piece.
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('b');
  await page.getByRole('checkbox', { name: 'Paint on piece' }).check();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(1));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await ribbon.getByRole('button', { name: 'Copy drawing' }).click();
  await drag(page, [
    [470, 400],
    [600, 400],
    [730, 400],
  ]);

  // Cycling: square, square with the line, square… for the whole animation.
  await ribbon.getByRole('combobox', { name: 'Loop drawings' }).selectOption({ label: 'Cycle' });
  const piece = (await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0];
  expect(piece.drawings).toEqual([0, 1]);
  expect(piece.drawingLoop).toEqual({ mode: 'cycle', end: 2 });
  // It never moved: its keyframes are as lifted.
  expect(await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id)).toEqual(keys0);
  // Its drawings have their row in the timeline.
  await expect(page.getByRole('region', { name: 'Timeline' }).locator('.tl-drawings-row .tl-cel-start')).toHaveCount(2);

  // Every frame, in the picture; the screen and export frames agree.
  for (let f = 0; f < FRAMES; f++) check(f, await read(page, f, 'cpu'), 'picture');
  for (const f of [0, 1, 10, 23]) {
    check(f, await read(page, f, 'screen'), 'screen');
    check(f, await read(page, f, 'export'), 'export frame');
  }

  // Saved and opened again: the same drawings and loop.
  const project = tempFile('flicker.pigm');
  const stubSave = (fp: string) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, fp);
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const back = (await page.evaluate(() => window.__pigmentoTest!.anim().pieces))[0];
  expect(back.drawings).toEqual([0, 1]);
  expect(back.drawingLoop).toEqual({ mode: 'cycle', end: 2 });
  for (const f of [0, 1, 22, 23]) check(f, await read(page, f, 'cpu'), 'reopened');

  // Exported as a GIF: the line on every other frame, all the way through, the square never moving.
  const gif = path.join(path.dirname(project), 'flicker.gif');
  await stubSave(gif);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await ribbon.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText(`${FRAMES} frames`);
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const bytes = readFileSync(gif);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  const frames = await page.evaluate(
    async ([b64, pts]) => {
      const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/gif' });
      await dec.tracks.ready;
      await dec.completed;
      const out: { r: number; g: number; b: number }[][] = [];
      for (let i = 0; i < dec.tracks.selectedTrack!.frameCount; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        out.push(pts.map((p) => {
          const d = ctx.getImageData(p.x, p.y, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2] };
        }));
      }
      return out;
    },
    [bytes.toString('base64'), [ON_LINE, OFF_LINE, CORNER, OUTSIDE]] as const,
  );
  expect(frames).toHaveLength(FRAMES);
  frames.forEach((px, f) => check(f, px, 'GIF'));
});
