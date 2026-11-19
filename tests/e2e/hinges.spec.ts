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
