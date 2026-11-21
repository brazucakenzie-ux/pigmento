// Pieces along paths: following a path, facing the way it goes, and motion path to shape (1.3.0, Stop 7A).
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clickDoc, docToScreen, drag, launchApp, ready, tempFile, type AppHandle } from './harness';

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
const BLUE = { r: 20, g: 40, b: 220, a: 255 };

/** A 120 × 40 rocket pointing right (red, its nose blue) lifted into a piece; returns its id. */
async function rocket(page: Page): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  const fill = (c: typeof RED, r: { x: number; y: number; w: number; h: number }) => page.evaluate(([lid, col, rect]) => window.__pigmentoTest!.fillLayer(lid as string, col as typeof RED, rect as typeof r), [layerId, c, r] as const);
  await fill(RED, { x: 100, y: 60, w: 100, h: 40 });
  await fill(BLUE, { x: 200, y: 60, w: 20, h: 40 });
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 60, 120, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  return page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
}

/** Where a point of the piece's own pixels is on the canvas at `frame`. */
async function at(page: Page, id: string, frame: number, x = 60, y = 20): Promise<{ x: number; y: number }> {
  await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), frame);
  return page.evaluate(([pid, px, py]) => window.__pigmentoTest!.pieceHandle(pid as string, px as number, py as number), [id, x, y] as const);
}

/** Which way the rocket's nose points on the canvas at `frame` (degrees, 0 = right, 90 = down). */
async function noseAngle(page: Page, id: string, frame: number): Promise<number> {
  const mid = await at(page, id, frame);
  const nose = await at(page, id, frame, 120, 20);
  return (Math.atan2(nose.y - mid.y, nose.x - mid.x) * 180) / Math.PI;
}

const current = (page: Page) => page.evaluate(() => window.__pigmentoTest!.anim().current!);
const selectPiece = (page: Page, name: string) => page.locator('.tl-names').getByRole('button', { name, exact: true }).click();

test('a rocket follows a curved path and faces its way: dragged and nudged along it, saved and reopened, exported as a GIF', async () => {
  const { page, app } = h;
  const id = await rocket(page);
  // A curve with the Pen tool: up from the bottom left, over a smooth top, down to the bottom right.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  const click = async (x: number, y: number) => {
    const s = await docToScreen(page, x, y);
    await page.mouse.click(s.x, s.y);
  };
  await click(200, 600);
  await drag(page, [
    [640, 200],
    [740, 200],
    [840, 200],
  ]);
  await click(1080, 600);
  await page.keyboard.press('Enter');
  const shapes = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('vector');
  const drawn = (await page.evaluate(() => window.__pigmentoTest!.vectorObjects()))!;
  const anchors = (drawn[0].subpaths as { anchors: { x: number; y: number }[] }[])[0].anchors;
  expect(anchors).toHaveLength(3);

  // The Animate tool, the rocket still selected: it picks the curve under Path, and goes along it over the timeline.
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().selectedId)).toBe(id);
  const bar = page.locator('.optionsbar');
  await expect(bar.getByRole('textbox', { name: 'X', exact: true })).toBeVisible();
  await bar.getByRole('combobox', { name: 'Path' }).selectOption({ index: 1 });
  expect((await current(page)).follow).toMatchObject({ layerId: shapes, sub: 0 });
  expect((await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id)).map((k) => [k.frame, k.progress])).toEqual([
    [0, 0],
    [23, 1],
  ]);
  // Along replaces X and Y.
  await expect(bar.getByRole('textbox', { name: 'X', exact: true })).toHaveCount(0);
  await expect(bar.getByRole('textbox', { name: 'Along', exact: true })).toHaveValue('0.0');
  // From the path's start to its end (its pivot on the path).
  const start = await at(page, id, 0);
  expect(start.x).toBeCloseTo(anchors[0].x, 3);
  expect(start.y).toBeCloseTo(anchors[0].y, 3);
  const end = await at(page, id, 23);
  expect(end.x).toBeCloseTo(anchors[2].x, 3);
  expect(end.y).toBeCloseTo(anchors[2].y, 3);
  // An even speed: frames 11 and 12 sit either side of the top, as far from it (the curve is near enough symmetric).
  const a11 = await at(page, id, 11);
  const a12 = await at(page, id, 12);
  expect(Math.abs(a11.x + a12.x - 2 * anchors[1].x)).toBeLessThan(3);
  expect(Math.abs(a11.y - a12.y)).toBeLessThan(3);
  expect(a12.y).toBeLessThan(230);

  // Not facing yet: level all the way. Facing its way: nose up on the way up, level over the top, down after.
  expect(await noseAngle(page, id, 3)).toBeCloseTo(0, 6);
  await bar.getByRole('checkbox', { name: 'Face its way' }).check();
  await expect(bar.getByRole('textbox', { name: 'Art points', exact: true })).toHaveValue('0.0');
  const up = await noseAngle(page, id, 3);
  expect(up).toBeLessThan(-20);
  expect(up).toBeGreaterThan(-90);
  expect(Math.abs(await noseAngle(page, id, 12))).toBeLessThan(15);
  expect(await noseAngle(page, id, 20)).toBeGreaterThan(20);

  // Dragged on the canvas, it slides along the path (and keys how far along it is there).
  await page.evaluate(() => window.__pigmentoTest!.setFrame(12));
  const steps = await page.evaluate(() => window.__pigmentoTest!.history().length);
  const grab = await at(page, id, 12, 90, 20);
  await drag(page, [
    [grab.x, grab.y],
    [grab.x + 150, grab.y + 60],
    [grab.x + 330, grab.y + 230],
  ]);
  const along = (await current(page)).progress;
  expect(along).toBeGreaterThan(70);
  expect(along).toBeLessThan(100);
  expect(await page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(steps + 1);
  expect((await at(page, id, 12)).y).toBeGreaterThan(300);
  await page.keyboard.press('Control+z');
  expect((await current(page)).progress).toBeCloseTo((12 / 23) * 100, 6);
  // The arrow keys move it along too (Shift: ten times as far).
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('ArrowRight');
  expect((await current(page)).progress).toBeCloseTo((12 / 23) * 100 + 1, 6);
  await page.keyboard.press('Shift+ArrowLeft');
  expect((await current(page)).progress).toBeCloseTo((12 / 23) * 100 - 9, 6);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  // Saved and opened again: still on the path, still facing its way.
  const before = [await at(page, id, 3), await at(page, id, 12), await at(page, id, 20, 120, 20)];
  const dir = path.dirname(tempFile('x'));
  const project = path.join(dir, 'rocket.pigm');
  const gif = path.join(dir, 'rocket.gif');
  const stubSave = (fp: string) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, fp);
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const back = await page.evaluate(() => window.__pigmentoTest!.anim().pieces[0].id);
  // (The timeline, to pick it by its row: opening an animated picture may show it already.)
  await page.getByRole('tab', { name: 'Animate' }).click();
  if (!(await page.locator('.tl-names').isVisible())) await page.locator('.ribbon').getByRole('button', { name: 'Timeline', exact: true }).click();
  await selectPiece(page, 'Piece 1');
  expect(await current(page)).toMatchObject({ follow: { sub: 0 }, face: true, faceAngle: 0 });
  const after = [await at(page, back, 3), await at(page, back, 12), await at(page, back, 20, 120, 20)];
  after.forEach((p, i) => {
    expect(p.x).toBeCloseTo(before[i].x, 6);
    expect(p.y).toBeCloseTo(before[i].y, 6);
  });

  // Exported as a GIF: along the curve, nose first.
  await stubSave(gif);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText('24 frames');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const bytes = readFileSync(gif);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  const seen = await page.evaluate(async (b64) => {
    const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/gif' });
    await dec.tracks.ready;
    await dec.completed;
    const frames = dec.tracks.selectedTrack!.frameCount;
    // Where the red body and the blue nose are on frames 4 and 13 (as fractions of the picture).
    const spots: { body: { x: number; y: number }; nose: { x: number; y: number } }[] = [];
    for (const i of [3, 12]) {
      const { image } = await dec.decode({ frameIndex: i });
      const w = image.displayWidth;
      const hh = image.displayHeight;
      const c = new OffscreenCanvas(w, hh);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      image.close();
      const d = ctx.getImageData(0, 0, w, hh).data;
      const sum = { rx: 0, ry: 0, rn: 0, bx: 0, by: 0, bn: 0 };
      for (let y = 0; y < hh; y++) {
        for (let x = 0; x < w; x++) {
          const k = (y * w + x) * 4;
          if (d[k] > 170 && d[k + 1] < 90 && d[k + 2] < 90) {
            sum.rx += x;
            sum.ry += y;
            sum.rn++;
          } else if (d[k + 2] > 170 && d[k] < 90 && d[k + 1] < 110) {
            sum.bx += x;
            sum.by += y;
            sum.bn++;
          }
        }
      }
      spots.push({ body: { x: sum.rx / sum.rn / w, y: sum.ry / sum.rn / hh }, nose: { x: sum.bx / sum.bn / w, y: sum.by / sum.bn / hh } });
    }
    return { frames, spots };
  }, bytes.toString('base64'));
  expect(seen.frames).toBe(24);
  const [rising, top] = seen.spots;
  // Over the top it's level, near the curve's peak, nose ahead (to the right).
  expect(top.body.x).toBeGreaterThan(0.4);
  expect(top.body.x).toBeLessThan(0.55);
  expect(top.body.y).toBeLessThan(0.32);
  expect(top.nose.x).toBeGreaterThan(top.body.x);
  expect(Math.abs(top.nose.y - top.body.y)).toBeLessThan(0.02);
  // On the way up, the nose is above and ahead of the body.
  expect(rising.body.x).toBeLessThan(0.35);
  expect(rising.nose.y).toBeLessThan(rising.body.y - 0.01);
  expect(rising.nose.x).toBeGreaterThan(rising.body.x);
});

test('motion path to shape: the piece follows its own motion path as a shape, the same way; deleting the shape keeps the motion', async () => {
  const { page } = h;
  const id = await rocket(page);
  const raster = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  for (const [f, x, y] of [
    [0, 200, 600],
    [12, 640, 200],
    [23, 1080, 600],
  ] as const) {
    await page.evaluate(([pid, frame, px, py]) => window.__pigmentoTest!.setPieceKey(pid as string, frame as number, { x: px as number, y: py as number }), [id, f, x, y] as const);
  }
  const frames = [0, 5, 12, 17, 23];
  const where = async () => {
    const out: { x: number; y: number }[] = [];
    for (const f of frames) out.push(await at(page, id, f));
    return out;
  };
  const expectSame = (a: { x: number; y: number }[], b: { x: number; y: number }[]) =>
    a.forEach((p, i) => {
      expect(p.x).toBeCloseTo(b[i].x, 3);
      expect(p.y).toBeCloseTo(b[i].y, 3);
    });
  const was = await where();
  await page.keyboard.press('a');
  const steps = await page.evaluate(() => window.__pigmentoTest!.history().length);
  await page.locator('.optionsbar').getByRole('button', { name: 'Motion path to shape' }).click();
  // A new shape layer just under the piece's layer, holding the path (an anchor at each keyframe).
  const tree = await page.evaluate(() => window.__pigmentoTest!.layers().tree);
  expect(tree.map((l) => l.kind)).toEqual(['vector', 'raster']);
  expect(tree[1].id).toBe(raster);
  const objects = (await page.evaluate((lid) => window.__pigmentoTest!.vectorObjects(lid), tree[0].id))!;
  expect(objects).toHaveLength(1);
  const sub = (objects[0].subpaths as { anchors: { x: number; y: number }[]; closed: boolean }[])[0];
  expect(sub.anchors.map((a) => [a.x, a.y])).toEqual([
    [200, 600],
    [640, 200],
    [1080, 600],
  ]);
  expect(sub.closed).toBe(false);
  expect((await current(page)).follow).toMatchObject({ layerId: tree[0].id });
  expectSame(await where(), was);
  // One undo step.
  expect(await page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(steps + 1);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.layers().tree.length)).toBe(1);
  expect((await current(page)).follow).toBeNull();
  expectSame(await where(), was);
  await page.keyboard.press('Control+y');
  expect((await current(page)).follow).not.toBeNull();

  // Deleting the shape layer: the piece keeps moving just as it did, on keyframes, in the same undo step.
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('vector');
  const count = await page.evaluate(() => window.__pigmentoTest!.history().length);
  await page.getByRole('region', { name: 'Layers' }).getByRole('button', { name: 'Delete layer' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.layers().tree.length)).toBe(1);
  expect(await page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(count + 1);
  expect((await current(page)).follow).toBeNull();
  expect((await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id)).length).toBe(24);
  expectSame(await where(), was);
  await page.keyboard.press('Control+z');
  expect((await current(page)).follow).toMatchObject({ layerId: tree[0].id });
  expectSame(await where(), was);
});

test('a rocket on a dotted path erases it behind itself, the dots ahead staying put', async () => {
  const { page } = h;
  const id = await rocket(page);
  // A straight dotted line across the canvas with the Pen, as a shape.
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  // Dots, in the outline's options.
  await page.locator('.opt-pop-btn', { hasText: 'Outline' }).click();
  const pop = page.getByRole('dialog', { name: 'Outline' });
  await pop.getByRole('radio', { name: 'Dots' }).click();
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await clickDoc(page, 200, 500);
  await clickDoc(page, 1000, 500);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('vector');
  // The rocket goes along it over the timeline.
  await page.keyboard.press('a');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().selectedId)).toBe(id);
  await page.locator('.optionsbar').getByRole('combobox', { name: 'Path' }).selectOption({ index: 1 });
  // The path's trim tied to it: erased behind the rocket.
  await page.keyboard.press('v');
  await clickDoc(page, 900, 500);
  const tie = page.locator('.optionsbar').getByRole('combobox', { name: 'Tie' });
  await tie.selectOption({ label: 'Erase behind Piece 1' });
  // Dark pixels along the line, between two x positions.
  const ink = (frame: number, x0: number, x1: number) =>
    page.evaluate(
      ([f, a, b]) => {
        const t = window.__pigmentoTest!;
        t.setFrame(f);
        const out: number[] = [];
        for (let x = a; x <= b; x++) {
          const p = t.pixel(x, 500);
          if (p.r < 120 && p.g < 120 && p.b < 120) out.push(x);
        }
        return out;
      },
      [frame, x0, x1] as const,
    );
  // Half way (the rocket's middle near x = 617): nothing behind it, the dots still ahead.
  expect(await ink(12, 260, 540)).toEqual([]);
  const ahead = await ink(12, 720, 990);
  expect(ahead.length).toBeGreaterThan(30);
  // Dotted: gaps between them.
  expect(ahead.length).toBeLessThan(200);
  // The dots don't crawl as the rocket goes: the same ones, earlier on.
  expect(await ink(6, 720, 990)).toEqual(ahead);
  // Before it sets off, the whole line is there.
  expect((await ink(0, 300, 540)).length).toBeGreaterThan(30);
  // A gap leaves some of the line showing behind it.
  const gap = page.locator('.optionsbar').getByRole('textbox', { name: 'Gap', exact: true });
  await gap.fill('120');
  await gap.press('Enter');
  expect((await ink(12, 500, 540)).length).toBeGreaterThan(5);
  expect(await ink(12, 260, 470)).toEqual([]);
  // Undo twice: untied, the whole line shows again.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect((await ink(12, 260, 540)).length).toBeGreaterThan(30);
});

test('a line draws itself on over the timeline: Draw on, its row in the timeline, saved and reopened', async () => {
  const { page, app } = h;
  // A straight line across the canvas with the Pen, as a shape.
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await clickDoc(page, 200, 400);
  await clickDoc(page, 1000, 400);
  await page.keyboard.press('Enter');
  // Selected with the Move tool, then drawn on from the first frame to the last.
  await page.keyboard.press('v');
  await clickDoc(page, 600, 400);
  await page.locator('.optionsbar').getByRole('button', { name: 'Draw on…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Draw on' });
  await expect(dlg.getByRole('textbox', { name: 'From frame' })).toHaveValue('1');
  await expect(dlg.getByRole('textbox', { name: 'To frame' })).toHaveValue('24');
  await dlg.getByRole('combobox', { name: 'Easing' }).selectOption('linear');
  await dlg.getByRole('button', { name: 'Key it' }).click();
  await expect(dlg).toBeHidden();
  // How far along the line it's drawn at a frame (its last dark pixel), or -1.
  const reach = (frame: number) =>
    page.evaluate((f) => {
      const t = window.__pigmentoTest!;
      t.setFrame(f);
      let last = -1;
      for (let x = 190; x <= 1010; x += 2) {
        const p = t.pixel(x, 400);
        if (p.r < 120 && p.g < 120 && p.b < 120) last = x;
      }
      return last;
    }, frame);
  expect(await reach(0)).toBe(-1);
  const half = await reach(12);
  expect(half).toBeGreaterThan(200 + 800 * (12 / 23) - 20);
  expect(half).toBeLessThan(200 + 800 * (12 / 23) + 20);
  expect(await reach(23)).toBeGreaterThan(990);
  // Its row in the timeline, under its layer: two keyframes; Alt+Left moves the last one a frame earlier.
  await page.getByRole('tab', { name: 'Animate' }).click();
  if (!(await page.locator('.tl-names').isVisible())) await page.locator('.ribbon').getByRole('button', { name: 'Timeline', exact: true }).click();
  await expect(page.locator('.tl-names').getByRole('button', { name: 'Shapes 1 · shape 1' })).toBeVisible();
  const keys = page.locator('.tl-shape-row .tl-key');
  await expect(keys).toHaveCount(2);
  await keys.nth(1).focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('.tl-shape-row .tl-key').nth(1)).toHaveAttribute('data-frame', '22');
  expect(await reach(22)).toBeGreaterThan(990);
  // Saved and opened again: drawn on just the same.
  const before = await reach(12);
  const project = path.join(path.dirname(tempFile('x')), 'draw-on.pigm');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
  }, project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  expect(await reach(12)).toBe(before);
  expect(await reach(0)).toBe(-1);
});
