// AI assistants, Stop 8C: the timeline and frame-by-frame drawings on layers and pieces (8.13).
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, decode, firstText, imageOf, type Pixel } from './assistantClient';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;
const clients: Client[] = [];

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  expect(h.errors).toEqual([]);
  await h.close();
});

const isRed = (p: Pixel) => p.r > 180 && p.g < 80 && p.b < 80;
const isBlue = (p: Pixel) => p.b > 180 && p.r < 80 && p.g < 80;

test('an assistant draws frame by frame, retimes and loops the drawings, and plays the animation', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined, raw: r };
  };
  /** The square's middle and a point on the blue line, at a frame. */
  const at = async (frame: number) => {
    const r = await call('get_picture_image', { frame, maxSize: 2048 });
    const [middle, line] = (await decode(h, imageOf(r.raw)!.data!, [{ x: 150, y: 120 }, { x: 150, y: 150 }])).pixels;
    return { red: isRed(middle), blue: isBlue(line) };
  };

  // Drawing 1: a flat red square.
  await call('select', { shape: 'rectangle', x: 100, y: 100, width: 100, height: 100 });
  await call('fill', { color: '#dc1e1e' });
  await call('select', { shape: 'none' });
  // Drawing 2, a copy from frame 3, gets a blue line across; the two cycle.
  expect((await call('edit_drawing', { action: 'copy', frame: 3 })).data).toMatchObject({ drawings: [1, 3], loop: null });
  expect(await page.evaluate(() => window.__pigmentoTest!.anim().frame)).toBe(2);
  expect((await call('draw_line', { from: { x: 100, y: 150 }, to: { x: 200, y: 150 }, width: 8, color: '#1e3cdc' })).ok).toBe(true);
  const looped = await call('edit_drawing', { action: 'loop', loop: 'cycle' });
  expect(looped.text).toMatch(/drawings starting at frames 1, 3, cycling to frame 4/);
  expect(looped.data).toMatchObject({ loop: { mode: 'cycle', end: 4 } });
  const cycle = [];
  for (const f of [1, 2, 3, 4, 5, 6, 7, 8, 23, 24]) cycle.push((await at(f)).blue);
  // A for frames 1–2, B for 3–4, round again: frames 23 and 24 (22 and 23 mod 4 = 2 and 3) are B.
  expect(cycle).toEqual([false, false, true, true, false, false, true, true, true, true]);
  expect((await at(5)).red).toBe(true);

  // Retime: within a loop ending at frame 4, the second drawing can't start at 5 (and says why);
  // with the loop ending at frame 8 it can.
  expect((await call('edit_drawing', { action: 'retime', drawing: 2, start: 5 })).text).toMatch(/loop until frame 4, so a drawing can’t start after that/);
  expect((await call('edit_drawing', { action: 'loop', loop: 'cycle', loopEnd: 8 })).data).toMatchObject({ loop: { mode: 'cycle', end: 8 } });
  expect((await call('edit_drawing', { action: 'retime', drawing: 2, start: 5 })).data).toMatchObject({ drawings: [1, 5] });
  expect([(await at(4)).blue, (await at(5)).blue, (await at(9)).blue, (await at(13)).blue]).toEqual([false, true, false, true]);
  // Off: the last drawing holds after it starts.
  expect((await call('edit_drawing', { action: 'loop', loop: 'off' })).data).toMatchObject({ loop: null });
  expect([(await at(4)).blue, (await at(20)).blue]).toEqual([false, true]);
  // A new blank drawing at frame 10, cleared and deleted drawings.
  expect((await call('edit_drawing', { action: 'new', frame: 10 })).data).toMatchObject({ drawings: [1, 5, 10] });
  expect(await at(12)).toEqual({ red: false, blue: false });
  expect((await call('edit_drawing', { action: 'delete', frame: 12 })).data).toMatchObject({ drawings: [1, 5] });
  expect((await call('edit_drawing', { action: 'clear', frame: 6 })).ok).toBe(true);
  expect(await at(6)).toEqual({ red: false, blue: false });
  expect((await at(1)).red).toBe(true);
  expect((await call('edit_drawing', { action: 'retime', drawing: 2 })).text).toMatch(/retime needs the drawing/);

  // The timeline: length, frame rate, the frame shown, and playing for the user.
  expect((await call('set_animation', { length: 12, fps: 6 })).text).toMatch(/12 frames at 6 a second/);
  expect((await call('set_animation', { frame: 13 })).text).toMatch(/frame can be 1 to 12/);
  await call('set_animation', { play: true });
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().playing)).toBe(true);
  await call('set_animation', { play: false });
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.anim().playing)).toBe(false);

  // Drawings on a piece: lifted from the frame-by-frame layer, then given a new one.
  await call('edit_drawing', { action: 'loop', loop: 'cycle' });
  await call('select', { shape: 'rectangle', x: 90, y: 90, width: 120, height: 120 });
  const piece = (await call('make_piece', { from: 'selection', name: 'Flag' })).data!.piece as string;
  const pieceInfo = async () => (((await call('get_picture_info')).data as { animation: { pieces: { id: string; drawings: number[] | null }[] } }).animation.pieces.find((p) => p.id === piece)!);
  expect((await pieceInfo()).drawings).toEqual([1, 5]);
  // Past the first cycle is a repeat: refused in Pigmento's own words; inside it, a new drawing.
  expect((await call('edit_drawing', { on: piece, action: 'copy', frame: 9 })).text).toContain('repeat of the loop. Add drawings in the first cycle (frames 1 to 8)');
  expect((await call('edit_drawing', { on: piece, action: 'copy', frame: 7 })).text).toMatch(/^The piece “Flag” has drawings starting at frames 1, 5, 7, cycling to frame 8.$/);
  expect((await pieceInfo()).drawings).toEqual([1, 5, 7]);
  const steps = (await page.locator('.history-list button').allTextContents()).filter((s) => s === 'Assistant: Drawing');
  expect(steps.length).toBeGreaterThanOrEqual(10);
});
