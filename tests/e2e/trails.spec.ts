// Trails: smoke, sparks, comet tails, speed lines and echoes behind moving pieces (1.3.0, Stop 7C).
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

/** A 120 × 40 piece lifted from the active layer at (100, 60); returns its id. */
async function piece(page: Page): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([lid, col]) => window.__pigmentoTest!.fillLayer(lid as string, col as typeof RED, { x: 100, y: 60, w: 120, h: 40 }), [layerId, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 60, 120, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  return page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
}

const trails = (page: Page) => page.evaluate(() => window.__pigmentoTest!.anim().current!.trails);
const at = (page: Page, id: string, x: number, y: number) => page.evaluate(([pid, px, py]) => window.__pigmentoTest!.pieceHandle(pid as string, px as number, py as number), [id, x, y] as const);

test('trail options: added from the options bar, made over as a preset, its emitter dragged on the canvas, every change undoable', async () => {
  const { page } = h;
  const id = await piece(page);
  await page.keyboard.press('a');
  await page.locator('.optionsbar .opt-pop-btn', { hasText: 'Trail' }).click();
  const pop = page.getByRole('dialog', { name: 'Trail' });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('This piece leaves no trail');
  // Added as Rocket smoke, from the middle of the piece.
  await pop.getByRole('button', { name: 'Add a trail' }).click();
  expect(await trails(page)).toMatchObject([{ kind: 'puffs', brush: 'round-soft', emitter: { x: 60, y: 20 } }]);
  await expect(pop.getByRole('button', { name: 'Trail 1: Puffs' })).toBeVisible();
  // Made over as Sparkles, bigger, with another colour, and its emission keyed off at the first frame.
  await pop.getByRole('combobox', { name: 'Preset' }).selectOption({ label: 'Sparkles' });
  expect((await trails(page))[0].brush).toBe('sparkles');
  const size = pop.getByRole('textbox', { name: 'Size', exact: true });
  await size.fill('30');
  await size.press('Enter');
  expect((await trails(page))[0].size).toBe(30);
  await pop.getByRole('button', { name: 'Add a colour' }).click();
  expect((await trails(page))[0].colors.map((c) => Math.round(c.pos * 100))).toEqual([0, 33, 67, 100]);
  const emission = pop.getByRole('textbox', { name: 'Emission', exact: true });
  await emission.fill('0');
  await emission.press('Enter');
  expect((await trails(page))[0]).toMatchObject({ keys: [{ frame: 0, amount: 0 }], emission: 0, keyed: true });
  await expect(pop).toContainText('Keyed at frames 1');
  // Esc (from the field just typed in) closes the popover and nothing else: the piece stays selected.
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().selectedId)).toBe(id);

  // Its emitter, a ring on the piece, dragged to the piece's left edge (its nozzle).
  const from = await at(page, id, 60, 20);
  const to = await at(page, id, 0, 20);
  await drag(page, [
    [from.x, from.y],
    [from.x - 30, from.y],
    [to.x, to.y],
  ]);
  const moved = (await trails(page))[0].emitter;
  expect(moved.x).toBeCloseTo(0, 0);
  expect(moved.y).toBeCloseTo(20, 0);
  // The piece itself stayed put.
  expect(await at(page, id, 60, 20)).toEqual(from);

  // Every change is its own undo step: the emitter, the key, the colour, the size, the preset, the trail.
  await page.keyboard.press('Control+z');
  expect((await trails(page))[0].emitter).toEqual({ x: 60, y: 20 });
  await page.keyboard.press('Control+z');
  expect((await trails(page))[0].keys).toEqual([]);
  await page.keyboard.press('Control+z');
  expect((await trails(page))[0].colors).toHaveLength(3);
  await page.keyboard.press('Control+z');
  expect((await trails(page))[0].size).not.toBe(30);
  await page.keyboard.press('Control+z');
  expect((await trails(page))[0].brush).toBe('round-soft');
  await page.keyboard.press('Control+z');
  expect(await trails(page)).toEqual([]);
});
