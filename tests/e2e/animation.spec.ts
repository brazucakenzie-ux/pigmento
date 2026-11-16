import { expect, test } from '@playwright/test';
import { launchApp, ready } from './harness';

// Animation: pieces cut from a selection, keyframes, frames and undo.
test('pieces show on screen at the current frame', async () => {
  const h = await launchApp();
  const { page } = h;
  await ready(page);
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
  expect(h.errors).toEqual([]);
  await h.close();
});
