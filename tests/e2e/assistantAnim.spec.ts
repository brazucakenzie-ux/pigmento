// AI assistants, Stop 8C: pieces, keyframes, links, boxes and the 3D scene (8.12), through an MCP client.
import path from 'node:path';
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

const RED = { r: 220, g: 30, b: 30, a: 255 };
const BLUE = { r: 30, g: 60, b: 220, a: 255 };
const isRed = (p: Pixel) => p.r > 180 && p.g < 80 && p.b < 80;

type PieceView = { id: string; name: string; kind: string; keyframes: number[]; loop: string; follows: string | null; hinged: boolean };
type Anim = { frame: number; length: number; fps: number; loop: string; pieces: PieceView[]; camera: { x: number; y: number; strength: number }; cameraMoves: number[]; light: { angle: number; height: number } };

test('an assistant makes pieces and animates them with keyframes, links, a box, the camera and the light', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined, raw: r };
  };
  const anim = async () => ((await call('get_picture_info')).data as { animation: Anim }).animation;
  const piece = async (id: string) => (await anim()).pieces.find((p) => p.id === id)!;
  /** The picture at a frame, as the assistant sees it: the pixels at some points. */
  const seen = async (frame: number, points: { x: number; y: number }[]) => {
    const r = await call('get_picture_image', { frame, maxSize: 2048 });
    return (await decode(h, imageOf(r.raw)!.data!, points)).pixels;
  };
  const layer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);

  // A red square becomes a piece, from the selection.
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 100, y: 100, w: 100, h: 100 }), [layer, RED] as const);
  await call('select', { shape: 'rectangle', x: 100, y: 100, width: 100, height: 100 });
  const made = await call('make_piece', { from: 'selection', name: 'Square' });
  expect(made.text).toMatch(/^Made the piece “Square”/);
  const square = made.data!.piece as string;
  expect(await piece(square)).toMatchObject({ name: 'Square', kind: 'piece', keyframes: [1] });

  // Keyframes: it slides right by frame 12, linearly; the timeline goes there and shows.
  expect((await call('set_keyframe', { piece: square, frame: 1, easing: 'linear' })).ok).toBe(true);
  const key = await call('set_keyframe', { piece: square, frame: 12, x: 650, opacity: 1 });
  expect(key.data).toMatchObject({ frame: 12, keyframes: [1, 12] });
  expect((await anim()).frame).toBe(12);
  await expect(page.locator('.timeline')).toBeVisible();
  const [start, mid, end] = [await seen(1, [{ x: 150, y: 150 }, { x: 650, y: 150 }]), await seen(6, [{ x: 150, y: 150 }, { x: 400, y: 150 }, { x: 650, y: 150 }]), await seen(12, [{ x: 150, y: 150 }, { x: 650, y: 150 }])];
  expect([isRed(start[0]), isRed(start[1])]).toEqual([true, false]);
  // Frame 6 is 5/11 of the way: the square's middle is near x = 150 + 500 × 5/11 ≈ 377.
  expect([isRed(mid[0]), isRed(mid[1]), isRed(mid[2])]).toEqual([false, true, false]);
  expect([isRed(end[0]), isRed(end[1])]).toEqual([false, true]);
  // Rotation, scale and fading at a frame; a keyframe removed.
  expect((await call('set_keyframe', { piece: square, frame: 24, rotate: 45, scale: 0.5, opacity: 0.3 })).data).toMatchObject({ keyframes: [1, 12, 24] });
  const faded = (await seen(24, [{ x: 650, y: 150 }]))[0];
  expect(faded.r).toBeGreaterThan(200);
  expect(faded.g).toBeGreaterThan(150);
  expect((await call('set_keyframe', { piece: square, frame: 24, remove: true })).data).toMatchObject({ keyframes: [1, 12] });
  expect((await call('set_keyframe', { piece: square, frame: 24, remove: true })).text).toMatch(/no keyframe at frame 24; it has them at 1, 12/);
  expect((await call('set_keyframe', { piece: square, frame: 99, x: 1 })).text).toMatch(/frame can be 1 to 24/);
  expect((await call('set_keyframe', { piece: 'nope', frame: 1, x: 1 })).text).toMatch(/no piece nope/);

  // Loops, following and hinges.
  expect((await call('set_piece', { piece: square, loop: 'pingpong', name: 'Box face' })).ok).toBe(true);
  expect(await piece(square)).toMatchObject({ name: 'Box face', loop: 'pingpong' });
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 100, y: 400, w: 60, h: 60 }), [layer, BLUE] as const);
  await call('select', { shape: 'rectangle', x: 100, y: 400, width: 60, height: 60 });
  const moon = (await call('make_piece', { from: 'selection', name: 'Moon' })).data!.piece as string;
  expect((await call('set_piece', { piece: moon, follow: square })).ok).toBe(true);
  expect(await piece(moon)).toMatchObject({ follows: square, hinged: false });
  // A piece can't follow one that follows it: told why, in Pigmento's own words.
  const loop = await call('set_piece', { piece: square, follow: moon });
  expect(loop.ok).toBe(false);
  expect(loop.text.length).toBeGreaterThan(10);
  expect((await call('set_piece', { piece: moon, follow: 'none' })).ok).toBe(true);
  expect(await piece(moon)).toMatchObject({ follows: null });
  expect((await call('set_piece', { piece: moon, hinge: { to: square, edge: 's', fold: 30 } })).ok).toBe(true);
  expect(await piece(moon)).toMatchObject({ hinged: true });

  // A 3D box: a group and its six faces.
  const box = await call('make_piece', { from: 'box', width: 120, height: 80, depth: 60, name: 'Crate' });
  expect(box.text).toMatch(/^Made the piece “Crate” .* with 6 faces\.$/);
  expect((box.data!.pieces as unknown[]).length).toBe(7);

  // An image file placed as a piece (it goes through the files permission and the path checks).
  const png = path.join(h.userData, 'Stamp.png');
  await call('export_image', { path: png, scale: 0.1 });
  expect((await call('make_piece', { from: 'image', path: png, name: 'Stamp' })).text).toMatch(/^Made the piece “Stamp”/);
  expect((await call('make_piece', { from: 'image', path: 'Stamp.png' })).text).toMatch(/full path/);

  // The animation as a whole, the camera and the light.
  const set = await call('set_animation', { length: 48, fps: 24, loop: 'pingpong', camera: { strength: 80 }, light: { angle: 45, height: 30 }, cameraMove: { frame: 30, push: 100 } });
  expect(set.text).toMatch(/48 frames at 24 a second, played back and forth, showing frame 30/);
  expect(await anim()).toMatchObject({ length: 48, fps: 24, loop: 'pingpong', frame: 30, camera: { strength: 80 }, light: { angle: 45, height: 30 } });
  // (The first camera move keys the camera at rest at frame 1 too.)
  expect((await anim()).cameraMoves).toEqual([1, 30]);
  expect((await call('set_animation', { frame: 3 })).data).toMatchObject({ frame: 3 });

  // Deleting a piece; and each call was one step.
  expect((await call('set_piece', { piece: moon, delete: true })).text).toBe('Deleted the piece “Moon”.');
  expect((await anim()).pieces.find((p) => p.id === moon)).toBeUndefined();
  const steps = (await page.locator('.history-list button').allTextContents()).filter((s) => s.startsWith('Assistant: '));
  expect(steps.filter((s) => s === 'Assistant: Make piece')).toHaveLength(4);
  // (Frame 1's easing was already linear: a call that changes nothing makes no step.)
  expect(steps.filter((s) => s === 'Assistant: Keyframe')).toHaveLength(3);
  // (Showing a frame isn't an undo step.)
  expect(steps.filter((s) => s === 'Assistant: Animation')).toHaveLength(1);
});
