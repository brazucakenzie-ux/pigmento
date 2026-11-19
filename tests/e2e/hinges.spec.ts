// Hinged pieces, groups and boxes (1.2.0, Stop 6C).
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

/** A size × size piece of one colour lifted at (x, y); returns its id. */
async function square(page: Page, x: number, y: number, size: number, c: { r: number; g: number; b: number; a: number }): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([lid, col, r]) => window.__pigmentoTest!.fillLayer(lid as string, col as typeof c, r as { x: number; y: number; w: number; h: number }), [layerId, c, { x, y, w: size, h: size }] as const);
  await page.evaluate(([sx, sy, s]) => window.__pigmentoTest!.selectRect(sx, sy, s, s), [x, y, size] as const);
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  return page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
}

const corner = (page: Page, id: string, x: number, y: number) => page.evaluate(([pid, px, py]) => window.__pigmentoTest!.pieceHandle(pid as string, px as number, py as number), [id, x, y] as const);
const info = (page: Page, id: string) => page.evaluate((pid) => window.__pigmentoTest!.anim().pieces.find((p) => p.id === pid)!, id);

test('dragging a piece’s edge onto another’s hinges it (Alt doesn’t); it folds and unhinges, each one undo step', async () => {
  const { page } = h;
  const a = await square(page, 200, 140, 120, { r: 220, g: 40, b: 40, a: 255 });
  const b = await square(page, 420, 140, 120, { r: 40, g: 180, b: 60, a: 255 });
  await page.keyboard.press('m');
  // (Grabbed beside its middle: the pivot there has a handle of its own.) Alt held all the way: it just moves.
  await page.keyboard.down('Alt');
  await drag(page, [
    [500, 230],
    [450, 232],
    [403, 232],
  ]);
  await page.keyboard.up('Alt');
  expect((await info(page, b)).parent).toBeNull();
  await page.keyboard.press('Control+z');
  // Without Alt, its left edge lands on the other's right edge, lights up, and hinges when let go.
  await drag(page, [
    [500, 230],
    [450, 232],
    [403, 232],
  ]);
  expect(await info(page, b)).toMatchObject({ parent: a, hinged: true });
  expect(await info(page, a)).toMatchObject({ parent: expect.any(String) });
  const group = (await info(page, a)).parent!;
  expect((await info(page, group)).kind).toBe('group');
  for (const [cb, ca] of [
    [[0, 0], [120, 0]],
    [[0, 120], [120, 120]],
  ] as const) {
    const pb = await corner(page, b, cb[0], cb[1]);
    const pa = await corner(page, a, ca[0], ca[1]);
    expect(pb.x).toBeCloseTo(pa.x, 6);
    expect(pb.y).toBeCloseTo(pa.y, 6);
  }
  // The Fold field folds it back round that edge: its far edge comes in towards the hinge.
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().current!.link)).toBe('hinged');
  const fold = page.getByRole('textbox', { name: 'Fold', exact: true });
  await fold.fill('60');
  await fold.press('Enter');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().current!.fold)).toBeCloseTo(60, 6);
  const far = await corner(page, b, 120, 60);
  expect(far.x).toBeGreaterThan(320);
  expect(far.x).toBeLessThan(440 - 20);
  // Up and down fold it from the keyboard, with the canvas focused (Shift: 15°).
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('Shift+ArrowUp');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().current!.fold)).toBeCloseTo(75, 6);
  // Unhinge lets it go where it is.
  const before = await corner(page, b, 120, 60);
  await page.getByRole('button', { name: 'Unhinge' }).click();
  expect((await info(page, b)).parent).toBeNull();
  const after = await corner(page, b, 120, 60);
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y).toBeCloseTo(before.y, 3);
  // Back through each step: unhinge, the two folds, the hinge.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  expect((await info(page, b)).parent).toBeNull();
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().pieces.length)).toBe(2);
  const home = await corner(page, b, 0, 0);
  expect(home.x).toBeCloseTo(420, 6);
});

test('the Follows list makes a piece move with another, and lets it go again', async () => {
  const { page } = h;
  const a = await square(page, 200, 140, 100, { r: 220, g: 40, b: 40, a: 255 });
  const b = await square(page, 400, 140, 60, { r: 40, g: 80, b: 220, a: 255 });
  await page.keyboard.press('m');
  const follows = page.getByRole('combobox', { name: 'Follows' });
  await follows.selectOption(a);
  expect(await info(page, b)).toMatchObject({ parent: a, hinged: false });
  const was = await corner(page, b, 0, 0);
  expect(was.x).toBeCloseTo(400, 6);
  // Moving the one it follows moves it too.
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 0, { x: 250 + 50 }), a);
  const moved = await corner(page, b, 0, 0);
  expect(moved.x).toBeCloseTo(450, 6);
  await follows.selectOption('');
  expect((await info(page, b)).parent).toBeNull();
  expect((await corner(page, b, 0, 0)).x).toBeCloseTo(450, 6);
});

/**
 * Where the front (160 × 120) meets each side of a box 100 deep: points along that edge at t
 * (0 … 1) in the front's pixels, and points just inside the front and inside that side, each as
 * [x, y, dx, dy] for (x + t·dx, y + t·dy).
 */
type Line = [number, number, number, number];
const SEAMS: Record<'right' | 'top' | 'left' | 'bottom', { edge: Line; inFront: Line; inSide: Line }> = {
  right: { edge: [160, 0, 0, 120], inFront: [156, 0, 0, 120], inSide: [4, 0, 0, 120] },
  top: { edge: [0, 0, 160, 0], inFront: [0, 4, 160, 0], inSide: [0, 96, 160, 0] },
  left: { edge: [0, 0, 0, 120], inFront: [4, 0, 0, 120], inSide: [96, 0, 0, 120] },
  bottom: { edge: [0, 120, 160, 0], inFront: [0, 116, 160, 0], inSide: [0, 4, 160, 0] },
};

test('a box’s hinges show no line, on screen or in the picture, at any angle', async () => {
  const { page } = h;
  for (const [tilt, turn] of [
    [0.35, -0.6],
    [-0.45, 0.75],
    [0.25, 0.4],
  ]) {
    // Backs hidden, so the inside of the box doesn't fill a gap: the white page would show through it.
    const ids = (await page.evaluate(([t, r]) => window.__pigmentoTest!.addTestBox(640, 400, { w: 160, h: 120, d: 100 }, t, r, true), [tilt, turn] as const))!;
    expect(ids).not.toBeNull();
    // Every pixel along each edge between two faces the camera sees (elsewhere the edge is the box's outline):
    // how much lighter it is than the lighter of the faces either side, on screen and in the picture.
    const worst = await page.evaluate(
      async ([box, seams]) => {
        const t = window.__pigmentoTest!;
        const lum = (c: { r: number; g: number; b: number }) => 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
        const out = { screenPixel: -Infinity, pixel: -Infinity, checked: 0 };
        for (const [side, at] of Object.entries(seams) as [keyof typeof seams, (typeof seams)['right']][]) {
          if (!t.pieceFront(box[side])) continue;
          const along = (l: [number, number, number, number], u: number): [number, number] => [l[0] + u * l[2], l[1] + u * l[3]];
          for (let k = 8; k <= 112; k++) {
            const u = k / 120;
            const e = t.pieceHandle(box.front, ...along(at.edge, u));
            const a = t.pieceHandle(box.front, ...along(at.inFront, u));
            const b = t.pieceHandle(box[side], ...along(at.inSide, u));
            for (const read of ['screenPixel', 'pixel'] as const) {
              const px = async (q: { x: number; y: number }) => (read === 'pixel' ? t.pixel(Math.floor(q.x), Math.floor(q.y)) : await t.screenPixel(Math.floor(q.x), Math.floor(q.y)));
              const excess = lum(await px(e)) - Math.max(lum(await px(a)), lum(await px(b)));
              out[read] = Math.max(out[read], excess);
            }
            out.checked++;
          }
        }
        return out;
      },
      [ids, SEAMS] as const,
    );
    expect(worst.checked).toBeGreaterThan(150);
    expect(worst.screenPixel, `on screen, tilt ${tilt} turn ${turn}`).toBeLessThanOrEqual(4);
    expect(worst.pixel, `in the picture, tilt ${tilt} turn ${turn}`).toBeLessThanOrEqual(4);
    await page.keyboard.press('Control+z');
  }
});

test('the box maker folds a box; dragging a face moves it all, Alt-dragging folds just that face', async () => {
  const { page } = h;
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.getByRole('button', { name: 'Box…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make a box' });
  await dialog.getByRole('textbox', { name: 'Width' }).fill('160');
  await dialog.getByRole('textbox', { name: 'Height' }).fill('120');
  await dialog.getByRole('textbox', { name: 'Depth' }).fill('100');
  await dialog.getByRole('button', { name: 'Make' }).click();
  await expect(dialog).toBeHidden();
  const anim = () => page.evaluate(() => window.__pigmentoTest!.anim());
  const pieces = (await anim()).pieces;
  expect(pieces).toHaveLength(7);
  expect(pieces.map((p) => p.name)).toEqual(['Group 1', 'Front', 'Top', 'Bottom', 'Left', 'Right', 'Back']);
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('plane');
  const [group, front, , , , right] = pieces.map((p) => p.id);
  expect((await anim()).selectedId).toBe(front);
  const state = (id: string) => page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 0)!, id);
  // Its sides show beside the front, and it came as one undo step.
  expect(await page.evaluate((id) => window.__pigmentoTest!.pieceFront(id), right)).toBe(true);
  const steps = (await page.evaluate(() => window.__pigmentoTest!.history())).index;
  // Centre pivot is there for a box's face; a box is made with its pivot in the middle, so nothing changes.
  const before = await corner(page, front, 0, 0);
  await page.getByRole('button', { name: 'Centre pivot' }).click();
  const after = await corner(page, front, 0, 0);
  expect(after.x).toBeCloseTo(before.x, 6);
  expect(after.y).toBeCloseTo(before.y, 6);
  expect((await page.evaluate(() => window.__pigmentoTest!.history())).index).toBe(steps);
  // Dragging the front (away from the handles round the box's middle) moves the whole box.
  const g0 = await state(group);
  const f0 = await state(front);
  const grab = await corner(page, front, 24, 100);
  await drag(page, [
    [grab.x, grab.y],
    [grab.x + 30, grab.y + 15],
    [grab.x + 60, grab.y + 30],
  ]);
  const g1 = await state(group);
  expect(g1.x - g0.x).toBeCloseTo(60, 0);
  expect(g1.y - g0.y).toBeCloseTo(30, 0);
  expect(await state(front)).toEqual(f0);
  // Alt-dragging the right side (high up, clear of the handles round the box's middle) folds just it, out from the box.
  const side = await corner(page, right, 60, 18);
  const fold0 = (await state(right)).fold;
  await page.keyboard.down('Alt');
  await drag(page, [
    [side.x, side.y],
    [side.x + 40, side.y],
    [side.x + 80, side.y],
  ]);
  await page.keyboard.up('Alt');
  expect((await state(right)).fold).toBeLessThan(fold0 - 0.2);
  expect(await state(group)).toEqual(g1);
  // Back through the fold and the move: the box is where it was made.
  for (let i = 0; i < 2; i++) await page.keyboard.press('Control+z');
  expect(await state(group)).toEqual(g0);
  expect((await page.evaluate(() => window.__pigmentoTest!.history())).index).toBe(steps);
});

test('a box folds open over 24 frames on its own rows, and the camera row pans past it by depth', async () => {
  const { page } = h;
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.getByRole('button', { name: 'Box…' }).click();
  await page.getByRole('dialog', { name: 'Make a box' }).getByRole('button', { name: 'Make' }).click();
  const ids = Object.fromEntries((await page.evaluate(() => window.__pigmentoTest!.anim().pieces)).map((p) => [p.name, p.id]));
  // The group's row, with its faces indented under it (the back hangs off the right side).
  const rows = await page.locator('.tl-piece-name').evaluateAll((els) => els.map((el) => [el.textContent?.trim() ?? '', Number((el as HTMLElement).dataset.level)]));
  expect(rows).toEqual([
    ['Group 1', 0],
    ['Front', 1],
    ['Right', 2],
    ['Back', 3],
    ['Left', 2],
    ['Bottom', 2],
    ['Top', 2],
  ]);
  // The right side, folded shut on frame 1, folds open by the last frame.
  await page.locator('.tl-names').getByRole('button', { name: 'Right', exact: true }).click();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(23));
  const fold = page.getByRole('textbox', { name: 'Fold', exact: true });
  await fold.fill('0');
  await fold.press('Enter');
  expect((await page.evaluate((id) => window.__pigmentoTest!.pieceKeys(id), ids.Right)).map((k) => k.frame)).toEqual([0, 23]);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(12));
  expect((await page.evaluate((id) => window.__pigmentoTest!.pieceAt(id, 12)!, ids.Right)).fold).toBeCloseTo(Math.PI / 2 * (1 - 12 / 23), 6);
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.fold))).toBeCloseTo(90 * (1 - 12 / 23), 6);
  // The camera row: panned 120 px by the last frame, the front (about on the canvas: the box is
  // turned a little) slides back by nearly all of it, and the far corner of the left side (still
  // folded shut) by clearly less.
  const at = async (frame: number, id: string) => {
    await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), frame);
    return corner(page, id, 0, 0);
  };
  const front0 = await at(23, ids.Front);
  const far0 = await at(23, ids.Left);
  await page.locator('.tl-names').getByRole('button', { name: 'Camera' }).click();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).cameraSelected).toBe(true);
  const pan = page.getByRole('textbox', { name: 'Pan X', exact: true });
  await pan.fill('120');
  await pan.press('Enter');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).cameraKeys.map((k) => k.frame)).toEqual([0, 23]);
  const front1 = await at(23, ids.Front);
  const far1 = await at(23, ids.Left);
  const near = front1.x - front0.x;
  const far = far1.x - far0.x;
  expect(near).toBeLessThan(-100);
  expect(near).toBeGreaterThan(-125);
  expect(far).toBeLessThan(-60);
  expect(far).toBeGreaterThan(near + 5);
  // Halfway through, the camera is halfway there (the front itself doesn't move).
  expect((await at(12, ids.Front)).x - front0.x).toBeCloseTo((near * 12) / 23, 3);
  expect((await at(0, ids.Front)).x).toBeCloseTo(front0.x, 6);
});
