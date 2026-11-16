// Animation: pieces cut from a selection, keyframes, frames and undo.
import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { drag, launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

/** Make the next native Save dialog return `file`. */
async function stubSave(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
}

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

test('the timeline scrubs, plays, retimes keyframes and renames pieces', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 200, g: 40, b: 40, a: 255 }, { x: 100, y: 100, w: 50, h: 50 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 50, 50));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  // Making a piece shows the timeline.
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).toBeVisible();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 8, { x: 400 }), id);
  await expect(timeline.getByRole('button', { name: /^Frame 9: keyframe of Piece 1/ })).toBeVisible();

  // Click the ruler to go to a frame; the arrow keys step from there.
  const ruler = timeline.getByRole('slider', { name: 'Frames' });
  const box = (await ruler.boundingBox())!;
  await page.mouse.click(box.x + 4 * 14 + 7, box.y + box.height / 2);
  await expect(ruler).toHaveAttribute('aria-valuenow', '5');
  await ruler.press('ArrowRight');
  await expect(ruler).toHaveAttribute('aria-valuetext', 'Frame 6 of 24');
  await ruler.press('End');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).frame).toBe(23);
  // The frame shortcuts work from the canvas.
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('Shift+Comma');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).frame).toBe(8);
  await page.keyboard.press('Comma');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).frame).toBe(7);

  // Play: frames advance; clicking the picture stops it.
  await page.keyboard.press('Control+Space');
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().frame), { timeout: 5000 }).not.toBe(7);
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).playing).toBe(true);
  const c = await page.evaluate(() => window.__pigmentoTest!.docToScreen(600, 600));
  await page.mouse.click(c.x, c.y);
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).playing).toBe(false);

  // Drag the frame-9 keyframe to frame 13.
  const key = timeline.getByRole('button', { name: /^Frame 9: keyframe/ });
  const kb = (await key.boundingBox())!;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.move(kb.x + kb.width / 2 + 4 * 14, kb.y + kb.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(timeline.getByRole('button', { name: /^Frame 13: keyframe/ })).toBeVisible();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].keys.map((k) => k.frame)).toEqual([0, 12]);

  // Its menu sets the easing of the first keyframe.
  await timeline.getByRole('button', { name: /^Frame 1: keyframe/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Easing' }).hover();
  await page.getByRole('menuitemcheckbox', { name: 'Ease in and out' }).click();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].keys[0].easing).toBe('easeInOut');

  // Double-click the name to rename the piece.
  await timeline.getByRole('button', { name: 'Piece 1', exact: true }).dblclick();
  const field = timeline.getByRole('textbox', { name: 'Piece name' });
  await field.fill('Ball');
  await field.press('Enter');
  await expect(timeline.getByRole('button', { name: 'Ball', exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].name).toBe('Ball');

  // Undo walks back the rename, the easing and the retiming.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces[0]).toMatchObject({ name: 'Piece 1', keys: [{ frame: 0, easing: 'linear' }, { frame: 8, easing: 'linear' }] });
});

test('a free-form piece survives a flip, a still save and a project save and reopen', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 20, g: 90, b: 220, a: 255 }, { x: 300, y: 200, w: 120, h: 120 }), layerId);
  // A free-form selection, lifted as a copy ("Leave the original").
  await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Free-form select' }).click();
  await drag(page, [
    [320, 220],
    [400, 220],
    [400, 300],
    [320, 300],
    [320, 222],
  ]);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Leave the original' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 6, { x: 700, y: 500 }), id);
  // The original stays where it was.
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(360, 260))).toEqual({ r: 20, g: 90, b: 220, a: 255 });
  await page.evaluate(() => window.__pigmentoTest!.setFrame(6));
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(700, 500))).toEqual({ r: 20, g: 90, b: 220, a: 255 });

  // Flip the whole picture: the piece flips with it, and undo puts it back.
  await page.getByRole('tab', { name: 'Image' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Flip horizontal' }).click();
  const w = (await page.evaluate(() => window.__pigmentoTest!.doc())).width;
  expect(await page.evaluate((x) => window.__pigmentoTest!.pixel(x, 500), w - 700)).toEqual({ r: 20, g: 90, b: 220, a: 255 });
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(700, 500))).toEqual({ r: 20, g: 90, b: 220, a: 255 });

  // A PNG holds the frame on screen, and says so.
  const png = tempFile('frame.png');
  await stubSave(png);
  await page.keyboard.press('Control+Shift+s');
  await expect(page.locator('.toast', { hasText: 'Saved frame 7 as the still picture frame.png' })).toBeVisible();

  // The project keeps the animation; reopening it shows the timeline at the same frame.
  const project = path.join(path.dirname(png), 'moving.pigm');
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  // Go elsewhere and hide the timeline, so the reopened file has to bring them back.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  await page.getByRole('button', { name: 'Hide the timeline' }).click();
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces).toHaveLength(1);
  expect(info.frame).toBe(6);
  expect(info.pieces[0].keys.map((k) => k.frame)).toEqual([0, 6]);
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(700, 500))).toEqual({ r: 20, g: 90, b: 220, a: 255 });
});

test('Simple mode hides the Animate tab and the timeline, and keeps the frame on screen', async () => {
  const { page } = h;
  await page.evaluate(() => window.__pigmentoTest!.selectRect(10, 10, 30, 30));
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 0, b: 0, a: 255 }, { x: 10, y: 10, w: 30, h: 30 }), layerId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
  await page.getByRole('button', { name: 'Full', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Animate' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0);
  // The picture still shows the frame (the piece at home).
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(20, 20))).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  await page.getByRole('button', { name: 'Simple', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible();
});

test('motion paths bend from the canvas, keyframes move there, and straighten again', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 160, b: 0, a: 255 }, { x: 200, y: 200, w: 60, h: 40 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(200, 200, 60, 40));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 10, { x: 630 }), id);

  // Alt-drag the last keyframe's dot upwards: the path now arrives from above.
  const end = await page.evaluate(() => window.__pigmentoTest!.docToScreen(630, 220));
  const up = await page.evaluate(() => window.__pigmentoTest!.docToScreen(630, 120));
  await page.mouse.move(end.x, end.y);
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(up.x, up.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  let keys = await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id);
  expect(keys[1].out).toBeNull();
  expect(keys[1].in!.y).toBeLessThan(-80);
  const mid = (await page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 5), id))!;
  expect(mid.y).toBeLessThan(205);
  expect((await page.evaluate(() => window.__pigmentoTest!.history())).length).toBeGreaterThan(0);

  // Drag that keyframe's dot (not the frame shown) to move it (after a pause: a quick second
  // press on a dot is a double-click, which straightens it).
  await page.waitForTimeout(700);
  await page.mouse.move(end.x, end.y);
  await page.mouse.down();
  const lower = await page.evaluate(() => window.__pigmentoTest!.docToScreen(630, 400));
  await page.mouse.move(lower.x, lower.y, { steps: 6 });
  await page.mouse.up();
  keys = await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id);
  expect(Math.round(keys[1].y)).toBe(400);
  expect(keys.map((k) => k.frame)).toEqual([0, 10]);

  // Straighten from the options bar at that keyframe.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(10));
  const bar = page.getByRole('toolbar', { name: /options/i });
  await bar.getByRole('button', { name: 'Straighten the motion path at this keyframe' }).click();
  keys = await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id);
  expect(keys[1].in).toBeNull();
  await expect(bar.getByRole('button', { name: 'Straighten the motion path at this keyframe' })).toBeDisabled();
  // Undo brings the bend back.
  await page.keyboard.press('Control+z');
  keys = await page.evaluate((pid) => window.__pigmentoTest!.pieceKeys(pid), id);
  expect(keys[1].in).not.toBeNull();
});

test('frame-by-frame: new and copied drawings, holding longer, and undo that shows the frame', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  // Frame 1: a blue block.
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 0, b: 255, a: 255 }, { x: 100, y: 100, w: 60, h: 60 }), layerId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Timeline' }).click();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  // Frame 4: a new, blank drawing; draw a red line on it with the pencil.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(3));
  await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(120, 120))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.keyboard.press('p');
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await drag(page, [
    [300, 300],
    [500, 300],
  ]);
  expect((await page.evaluate(() => window.__pigmentoTest!.pixel(400, 300))).r).toBeGreaterThan(150);
  // Frames 1–3 still show the blue block; frames 4 onwards the red line.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(120, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(400, 300))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.evaluate(() => window.__pigmentoTest!.setFrame(20));
  expect((await page.evaluate(() => window.__pigmentoTest!.pixel(400, 300))).r).toBeGreaterThan(150);

  // The layer's row: two drawings. Drag the second one's start from frame 4 to frame 6.
  const second = timeline.getByRole('button', { name: /^Frame 4: drawing on .*, to frame 24/ });
  await expect(timeline.getByRole('button', { name: /^Frame 1: drawing on .*, to frame 3/ })).toBeVisible();
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 4 + 2 * 14, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(timeline.getByRole('button', { name: /^Frame 6: drawing on/ })).toBeVisible();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).cels[layerId]).toEqual([0, 5]);

  // Undo the hold, then undo the pencil stroke from frame 1: the timeline goes to frame 4 to show it.
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).cels[layerId]).toEqual([0, 3]);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).frame).toBe(3);
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(400, 300))).toEqual({ r: 255, g: 255, b: 255, a: 255 });

  // Copy drawing at frame 2: a copy of the blue block drawing.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(1));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Copy drawing' }).click();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).cels[layerId]).toEqual([0, 1, 3]);
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(120, 120))).toEqual({ r: 0, g: 0, b: 255, a: 255 });
});

test('each drawing keeps its own copy on screen, so moving between frames shows the right one', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  const colours = [
    { r: 200, g: 0, b: 0, a: 255 },
    { r: 0, g: 160, b: 0, a: 255 },
    { r: 0, g: 0, b: 220, a: 255 },
  ];
  // Drawings at frames 1, 5 and 9, each filled with its own colour.
  for (const [i, c] of colours.entries()) {
    await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), i * 4);
    if (i > 0) await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
    await page.evaluate(([id, col]) => window.__pigmentoTest!.fillLayer(id, col, { x: 50, y: 50, w: 100, h: 100 }), [layerId, c] as const);
  }
  // Back and forth across them: the screen always shows that frame's drawing.
  for (const f of [0, 9, 4, 2, 11, 6, 0]) {
    await page.evaluate((n) => window.__pigmentoTest!.setFrame(n), f);
    expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(100, 100))).toEqual(colours[Math.min(2, Math.floor(f / 4))]);
  }
  expect(await page.evaluate(() => window.__pigmentoTest!.celMirrors())).toBe(3);
  // Deleting a drawing lets its copy go.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(8));
  await page.locator('.ribbon').getByRole('button', { name: 'Delete drawing' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(100, 100))).toEqual(colours[1]);
  expect(await page.evaluate(() => window.__pigmentoTest!.celMirrors())).toBe(2);
});

test('onion skin shows the drawings before and after on screen only', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  // Frame 1: a black block on the left; frame 5: one on the right.
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 0, b: 0, a: 255 }, { x: 100, y: 100, w: 80, h: 80 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(4));
  await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 0, g: 0, b: 0, a: 255 }, { x: 400, y: 100, w: 80, h: 80 }), layerId);
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await timeline.getByRole('button', { name: 'Onion skin' }).click();
  await expect(timeline.getByRole('button', { name: 'Onion skin' })).toHaveAttribute('aria-pressed', 'true');

  // At frame 5, the frame-1 drawing shows as a faint orange ghost on the white paper.
  let ghost = await page.evaluate(() => window.__pigmentoTest!.screenPixel(140, 140));
  expect(ghost.r).toBeGreaterThan(ghost.b + 60);
  expect(ghost.g).toBeLessThan(250);
  // The picture itself (what's saved and exported) has no ghost.
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(140, 140))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  // At frame 1, the frame-5 drawing shows as a blue ghost.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  ghost = await page.evaluate(() => window.__pigmentoTest!.screenPixel(440, 140));
  expect(ghost.b).toBeGreaterThan(ghost.r + 60);
  // Stronger onion skin is darker.
  const strength = timeline.getByRole('textbox', { name: 'Onion skin strength' });
  await strength.fill('80');
  await strength.press('Enter');
  const strong = await page.evaluate(() => window.__pigmentoTest!.screenPixel(440, 140));
  expect(strong.r).toBeLessThan(ghost.r);
  // Off again: no ghost.
  await timeline.getByRole('button', { name: 'Onion skin' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.screenPixel(440, 140))).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test('frame-by-frame drawings save, reopen, and export frame by frame without the onion skin', async () => {
  const { page } = h;
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  // Drawings at frames 1, 3 and 5: a block moving right.
  for (const [i, x] of [100, 300, 500].entries()) {
    await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), i * 2);
    if (i > 0) await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
    await page.evaluate(([id, bx]) => window.__pigmentoTest!.fillLayer(id, { r: 20, g: 120, b: 40, a: 255 }, { x: bx, y: 100, w: 60, h: 60 }), [layerId, x] as const);
  }
  // Onion skin on: it shows on screen, but the frames exported never have it.
  await page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'Onion skin' }).click();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  // The previous drawing's ghost (orange) where the block was at frame 1.
  const ghost = await page.evaluate(() => window.__pigmentoTest!.screenPixel(130, 130));
  expect(ghost.r).toBeGreaterThan(ghost.b + 60);
  expect(ghost.g).toBeLessThan(250);
  expect(await page.evaluate(() => window.__pigmentoTest!.pixel(130, 130))).toEqual({ r: 255, g: 255, b: 255, a: 255 });

  // Save the project and open it again: three drawings, frame 3 showing.
  const project = tempFile('flipbook.pigm');
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const id = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.cels[id]).toEqual([0, 2, 4]);
  expect(info.frame).toBe(2);
  // Each frame's pixels (what export and the colour picker read) come from that frame's drawing alone.
  for (const [f, x] of [
    [0, 130],
    [3, 330],
    [9, 530],
  ] as const) {
    await page.evaluate((n) => window.__pigmentoTest!.setFrame(n), f);
    expect(await page.evaluate((px) => window.__pigmentoTest!.pixel(px, 130), x)).toEqual({ r: 20, g: 120, b: 40, a: 255 });
    for (const other of [130, 330, 530].filter((o) => o !== x)) {
      expect(await page.evaluate((px) => window.__pigmentoTest!.pixel(px, 130), other)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    }
  }
});

test('with many layers, a piece’s keyframes sit under its layer and dragging the last one retimes the move', async () => {
  const { page } = h;
  const base = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  // The piece is on the bottom layer, with four more layers above it.
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 200, g: 0, b: 0, a: 255 }, { x: 100, y: 100, w: 40, h: 40 }), base);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 40, 40));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 8, { x: 600 }), id);
  for (let i = 0; i < 4; i++) await page.evaluate(() => window.__pigmentoTest!.addLayer());
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const ruler = timeline.getByRole('slider', { name: 'Frames' });
  const rulerTop = (await ruler.boundingBox())!.y;

  // The piece's row comes straight after its layer's row.
  const names = await timeline.getByRole('list', { name: 'Layers and their pieces' }).getByRole('listitem').allInnerTexts();
  expect(names.indexOf('Piece 1')).toBe(names.length - 1);
  expect(names[names.length - 2]).toBe(await page.evaluate((lid) => window.__pigmentoTest!.layers().tree.find((n) => n.id === lid)!.name, base));

  // Drag the end keyframe from frame 9 to frame 17: the move now takes twice as long.
  const end = timeline.getByRole('button', { name: /^Frame 9: keyframe of Piece 1/ });
  await end.scrollIntoViewIfNeeded();
  // Scrolling the rows leaves the ruler where it was.
  expect((await ruler.boundingBox())!.y).toBeCloseTo(rulerTop, 0);
  let box = (await end.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8 * 14, box.y + box.height / 2, { steps: 6 });
  // While dragging, a label says where it will land.
  await expect(timeline.getByText('Frame 17', { exact: true })).toBeVisible();
  await page.mouse.up();
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].keys.map((k) => k.frame)).toEqual([0, 16]);
  expect((await page.evaluate((pid) => window.__pigmentoTest!.pieceAt(pid, 8), id))!.x).toBeCloseTo((120 + 600) / 2, 0);

  // Dragging past the last frame makes the timeline longer to fit.
  const moved = timeline.getByRole('button', { name: /^Frame 17: keyframe of Piece 1/ });
  box = (await moved.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 14 * 14, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.pieces[0].keys.map((k) => k.frame)).toEqual([0, 30]);
  expect(info.length).toBe(31);
});
