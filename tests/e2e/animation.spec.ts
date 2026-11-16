// Animation: pieces cut from a selection, keyframes, frames and undo.
import { expect, test } from '@playwright/test';
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

test('pieces show on screen at the current frame', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 0, b: 255, a: 255 }, { x: 100, y: 100, w: 40, h: 40 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 40, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces).toHaveLength(1);
  const id = info.pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 10, { x: 420, angle: Math.PI / 4 }), id);
  // Frame 0: still at home.
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(120, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  await page.evaluate(() => window.__pigmentoTest!.setFrame(10));
  // The hole shows the paper; the piece is at x 420, turned.
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(120, 120))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(420, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  // The pixel path agrees with the screen.
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(420, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  // Corner of the turned square: (420 + 20√2, 120) is just inside along the diagonal.
  expect((await page.evaluate(() => window.__pigmentoTest!.screenPixel(446, 120))).b).toBeGreaterThan(200);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(5));
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(270, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  // Undo: the piece goes away and the pixels come back.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().pieces)).toHaveLength(0);
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(120, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
});

test('the Animate tool keys a piece by dragging it, its handles and its fields', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 160, b: 0, a: 255 }, { x: 200, y: 200, w: 60, h: 40 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(200, 200, 60, 40));
  // The Animate tab: Animate selection makes the piece and switches to the Animate tool.
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.tool())).toBe('animate');
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).selectedId).toBe(id);
  const bar = page.getByRole('toolbar', { name: /options/i });
  await expect(bar.getByRole('textbox', { name: 'X' })).toHaveValue('230');

  // Frame 10: drag the piece 200 px right; that keys it there, as one undo step.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(10));
  // (Grab it away from its middle, where the pivot is.)
  await drag(page, [
    [215, 210],
    [415, 210],
  ]);
  let info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces[0].keys.map((k) => k.frame)).toEqual([0, 10]);
  expect(info.current).toMatchObject({ keyed: true });
  expect(Math.round(info.current!.x)).toBe(430);
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(430, 220))).toEqual({ r: 0, g: 160, b: 0, a: 255 });

  // Stretch it from the east edge, then type a turn into the options bar.
  await drag(page, [
    [460, 220],
    [520, 220],
  ]);
  info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.current!.w).toBeCloseTo(200, -1);
  expect(info.current!.h).toBeCloseTo(100);
  const angle = bar.getByRole('textbox', { name: 'Angle' });
  await angle.fill('90');
  await angle.press('Enter');
  await expect.poll(async () => Math.round((await page.evaluate(() => window.__pigmentoTest!.anim())).current!.angle)).toBe(90);
  // Half way, the piece is half way along.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(5));
  info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.current!.keyed).toBe(false);
  expect(info.current!.angle).toBeCloseTo(45);

  // Undo the turn, the stretch and the move.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces[0].keys.map((k) => k.frame)).toEqual([0]);
});
