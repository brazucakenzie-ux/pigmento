// AI assistants, Stop 8C (8.16): an MCP client animates two scenes the way an assistant would and
// exports them as GIFs, checked frame by frame: a red square that switches to one with a blue line
// across it, cycling, and a rocket leaving smoke along a path.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, decodeGif, firstText, type Pixel } from './assistantClient';
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

const isRed = (p: Pixel) => p.r > 170 && p.g < 90 && p.b < 90;
const isBlue = (p: Pixel) => p.b > 170 && p.r < 90 && p.g < 110;

test('an assistant animates a cycling square and a rocket with smoke, exported as GIFs checked frame by frame', async () => {
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, `${name}: ${firstText(r)}`).toBeFalsy();
    return (r.structuredContent ?? {}) as Record<string, unknown>;
  };
  const out = test.info().outputDir;
  mkdirSync(out, { recursive: true });

  // 1. The square: drawing 1 is flat red; drawing 2, a copy from frame 2, has a blue line across
  //    it; they cycle every frame, and Animate selection lifts both drawings into a piece.
  await call('new_picture', { width: 320, height: 240, paper: '#ffffff', where: 'this', unsaved: 'discard' });
  await call('set_animation', { length: 24, fps: 12, loop: 'loop' });
  await call('select', { shape: 'rectangle', x: 110, y: 70, width: 100, height: 100 });
  await call('fill', { color: '#dc1e1e' });
  await call('select', { shape: 'none' });
  await call('edit_drawing', { action: 'copy', frame: 2 });
  await call('draw_line', { from: { x: 110, y: 120 }, to: { x: 210, y: 120 }, width: 10, color: '#1e3cdc' });
  await call('edit_drawing', { action: 'loop', loop: 'cycle' });
  await call('select', { shape: 'rectangle', x: 100, y: 60, width: 120, height: 120 });
  const square = await call('make_piece', { from: 'selection', name: 'Square' });
  expect(square.pieces).toHaveLength(1);
  const squareGif = path.join(out, 'square.gif');
  await call('export_animation', { path: squareGif });
  const probes = Array.from({ length: 24 }, (_, f) => [
    { frame: f, x: 160, y: 90 },
    { frame: f, x: 160, y: 120 },
  ]).flat();
  const s = await decodeGif(h, readFileSync(squareGif).toString('base64'), probes);
  expect(s.frames).toBe(24);
  for (let f = 0; f < 24; f++) {
    const [body, line] = [s.pixels[f * 2], s.pixels[f * 2 + 1]];
    expect(isRed(body), `frame ${f + 1}: the square`).toBe(true);
    // Frames 1, 3, 5… are the flat square; 2, 4, 6… have the line.
    expect(isBlue(line), `frame ${f + 1}: the line`).toBe(f % 2 === 1);
    if (f % 2 === 0) expect(isRed(line), `frame ${f + 1}: no line`).toBe(true);
  }

  // 2. The rocket: a sky, a straight path on a hidden shapes layer, and a red rocket that follows
  //    it facing its way, leaving dark smoke.
  await call('new_picture', { width: 640, height: 400, paper: '#ffffff', where: 'this', unsaved: 'discard' });
  await call('set_animation', { length: 24, fps: 12, loop: 'loop' });
  await call('fill', { color: '#8cc8ff' });
  const paths = (await call('add_layer', { kind: 'shapes', name: 'Flight path' })).layer as string;
  const route = (await call('draw_path', { points: [{ x: 60, y: 340 }, { x: 580, y: 60 }], outline: '#000000', outlineWidth: 2 })).object as string;
  await call('set_layer', { layer: paths, visible: false });
  const rocketLayer = (await call('add_layer', { name: 'Rocket' })).layer as string;
  await call('draw_shape', { shape: 'rectangle', x: 10, y: 10, width: 44, height: 20, fill: '#d81e1e', outline: 'none', layer: rocketLayer });
  await call('select', { shape: 'rectangle', x: 6, y: 6, width: 52, height: 28 });
  const rocket = (await call('make_piece', { from: 'selection', name: 'Rocket' })).piece as string;
  await call('set_keyframe', { piece: rocket, frame: 24, opacity: 1 });
  await call('set_piece', { piece: rocket, path: { object: route }, facesItsWay: true });
  const trail = (await call('set_trail', { piece: rocket, add: 'rocketSmoke' })).trail as string;
  await call('set_trail', { piece: rocket, trail, settings: { colors: ['#3a3a3a', '#7a7a7a'], opacity: 1, size: 18 } });
  const rocketGif = path.join(out, 'rocket.gif');
  await call('export_animation', { path: rocketGif });
  // Where the rocket should be at each frame: evenly along the path, from its start to its end.
  const at = (f: number) => ({ x: Math.round(60 + (520 * f) / 23), y: Math.round(340 - (280 * f) / 23) });
  const frames = [0, 5, 11, 17, 23];
  const r = await decodeGif(
    h,
    readFileSync(rocketGif).toString('base64'),
    frames.flatMap((f) => [{ frame: f, ...at(f) }, { frame: f, x: at(f).x + 30, y: at(f).y + 50 }]),
  );
  expect(r.frames).toBe(24);
  frames.forEach((f, i) => {
    expect(isRed(r.pixels[i * 2]), `frame ${f + 1}: the rocket on the path`).toBe(true);
    // Below and to the right of the path, away from the smoke, it's sky.
    expect(r.pixels[i * 2 + 1].b, `frame ${f + 1}: sky`).toBeGreaterThan(200);
  });
  // Smoke: grey puffs along the path behind the rocket, more of them as it goes.
  const smokeAt = async (f: number) => {
    const pts = Array.from({ length: 30 }, (_, k) => ({ frame: f, ...at(Math.max(0, f - 2 - Math.floor(k / 3))) }));
    const d = await decodeGif(h, readFileSync(rocketGif).toString('base64'), pts);
    return d.pixels.filter((p) => Math.abs(p.r - p.g) < 25 && Math.abs(p.g - p.b) < 25 && p.r < 170).length;
  };
  expect(await smokeAt(20)).toBeGreaterThan(5);
  expect(await smokeAt(0)).toBe(0);

  // Kept for the report.
  copyFileSync(squareGif, path.join(out, 'assistant-square.gif'));
  copyFileSync(rocketGif, path.join(out, 'assistant-rocket.gif'));
});
