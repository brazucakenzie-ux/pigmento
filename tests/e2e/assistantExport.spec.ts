// AI assistants, Stop 8C: exporting the animation as a GIF or an MP4 (8.15), with the file rules.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, decodeGif, firstText, setAssistants, type Pixel } from './assistantClient';
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

test('an assistant exports the animation as a GIF or an MP4, all of it or some frames, at a scale', async () => {
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined };
  };
  const dir = path.join(h.userData, 'Out');
  mkdirSync(path.join(dir, 'Limited'), { recursive: true });
  const gif = (name: string) => readFileSync(path.join(dir, name)).toString('base64');

  // A red square sliding right over 12 frames, 6 a second.
  await call('set_animation', { length: 12, fps: 6, loop: 'loop' });
  await call('select', { shape: 'rectangle', x: 100, y: 100, width: 100, height: 100 });
  await call('fill', { color: '#dc1e1e' });
  const square = (await call('make_piece', { from: 'selection', name: 'Square' })).data!.piece as string;
  await call('set_keyframe', { piece: square, frame: 1, easing: 'linear' });
  await call('set_keyframe', { piece: square, frame: 12, x: 1050 });

  // All of it as a GIF: 12 frames a sixth of a second each, the square moving across.
  const all = await call('export_animation', { path: path.join(dir, 'Slide.gif') });
  expect(all.text).toMatch(/Exported .*Slide\.gif: 12 frames, 1280 × 800 pixels, at 6 a second\./);
  const g = await decodeGif(h, gif('Slide.gif'), [
    { frame: 0, x: 150, y: 150 },
    { frame: 11, x: 1050, y: 150 },
    { frame: 11, x: 150, y: 150 },
  ]);
  expect([g.width, g.height, g.frames]).toEqual([1280, 800, 12]);
  expect(g.delays.every((d) => Math.abs(d - 167) <= 10)).toBe(true);
  expect(g.pixels.map(isRed)).toEqual([true, true, false]);
  // Some frames, half size, back and forth (3 4 5 6 5 4).
  const part = await call('export_animation', { path: path.join(dir, 'Part.gif'), from: 3, to: 6, scale: 0.5, playback: 'pingpong' });
  expect(part.data).toMatchObject({ frames: 6, width: 640, height: 400 });
  const p = await decodeGif(h, gif('Part.gif'), []);
  expect([p.width, p.height, p.frames]).toEqual([640, 400, 6]);
  // An MP4 video.
  const mp4 = await call('export_animation', { path: path.join(dir, 'Slide.mp4'), quality: 'medium' });
  expect(mp4.ok, mp4.text).toBe(true);
  const head = readFileSync(path.join(dir, 'Slide.mp4'));
  expect(head.subarray(4, 8).toString('latin1')).toBe('ftyp');
  expect(head.length).toBeGreaterThan(1000);

  // The file rules: no replacing without saying so, only .gif and .mp4, the folder limit, the permission.
  expect((await call('export_animation', { path: path.join(dir, 'Slide.gif') })).text).toMatch(/already exists\. Say overwrite: true/);
  expect((await call('export_animation', { path: path.join(dir, 'Slide.gif'), overwrite: true, to: 2 })).data).toMatchObject({ frames: 2 });
  expect((await call('export_animation', { path: path.join(dir, 'Slide.png') })).text).toMatch(/exported as a \.gif or an \.mp4/);
  expect((await call('export_animation', { path: path.join(dir, 'x.gif'), to: 40 })).text).toMatch(/frame can be 1 to 12/);
  await setAssistants(h, { folder: path.join(dir, 'Limited') });
  expect((await call('export_animation', { path: path.join(dir, 'Out.gif') })).text).toMatch(/only lets AI assistants use files in/);
  expect((await call('export_animation', { path: path.join(dir, 'Limited', 'In.gif'), to: 1 })).ok).toBe(true);
  await setAssistants(h, { folder: null, files: 'deny' });
  expect((await call('export_animation', { path: path.join(dir, 'Denied.gif') })).text).toMatch(/doesn’t let AI assistants open, save or export files/);
  expect(existsSync(path.join(dir, 'Denied.gif'))).toBe(false);
});
