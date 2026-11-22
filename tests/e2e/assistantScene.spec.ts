// AI assistants, Stop 8B (8.11): an MCP client paints a small scene the way an assistant would
// (a sky, a hill, a sun with a glow, grass, a word), undo takes its steps back one by one, and
// the scene is saved and opened again.
import { mkdirSync, writeFileSync } from 'node:fs';
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

const near = (p: Pixel, c: [number, number, number], tol = 30) => Math.abs(p.r - c[0]) <= tol && Math.abs(p.g - c[1]) <= tol && Math.abs(p.b - c[2]) <= tol;

test('an assistant paints a scene, undo takes it back step by step, and it saves and opens again', async () => {
  const { page } = h;
  const testInfo = test.info();
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError, `${name}: ${firstText(r)}`).toBeFalsy();
    return r;
  };
  const layer = async (name: string) => ((await call('add_layer', { name })).structuredContent as { layer: string }).layer;
  // Points the test looks at: sky, hill, the sun, its glow, grass, the word.
  const at = { sky: { x: 60, y: 60 }, hill: { x: 320, y: 340 }, sun: { x: 520, y: 90 }, glow: { x: 520, y: 150 }, grass: { x: 100, y: 384 }, word: { x: 0, y: 0 } };
  const look = async () => {
    const r = await call('get_picture_image', { maxSize: 2048 });
    return { png: imageOf(r)!.data!, px: (await decode(h, imageOf(r)!.data!, Object.values(at))).pixels };
  };

  await call('new_picture', { width: 640, height: 400, paper: '#ffffff' });
  // The sky: a layer filled blue.
  await layer('Sky');
  await call('fill', { color: '#6fb6ff' });
  // A green hill: a closed curved path.
  await layer('Hill');
  await call('draw_path', {
    points: [
      { x: 0, y: 400 },
      { x: 0, y: 300, out: { x: 160, y: 200 } },
      { x: 640, y: 290, in: { x: 460, y: 200 } },
      { x: 640, y: 400 },
    ],
    closed: true,
    fill: '#3f9f4a',
    outline: 'none',
  });
  // The sun, softened with a blur so it glows.
  const sun = await layer('Sun');
  await call('draw_shape', { shape: 'circle', x: 470, y: 40, width: 100, height: 100, fill: '#ffd23f', outline: 'none' });
  await call('apply_effect', { effect: 'gaussianBlur', settings: { radius: 12 }, layer: sun });
  // Grass along the bottom, with a grassy brush stroke.
  await layer('Grass');
  await call('brush_stroke', { points: Array.from({ length: 9 }, (_, i) => ({ x: 20 + i * 75, y: 384 + (i % 2) * 6, pressure: 0.6 + (i % 3) * 0.15 })), size: 18, color: '#2c7a35' });
  // A word in the sky.
  await layer('Words');
  await call('add_text', { text: 'Hello', x: 60, y: 120, size: 40, bold: true, color: '#1d1b2b' });

  const painted = await look();
  const [sky, hill, sunPx, glow, grass] = painted.px;
  expect(near(sky, [0x6f, 0xb6, 0xff], 4), JSON.stringify(sky)).toBe(true);
  expect(near(hill, [0x3f, 0x9f, 0x4a], 4), JSON.stringify(hill)).toBe(true);
  expect(near(sunPx, [0xff, 0xd2, 0x3f]), JSON.stringify(sunPx)).toBe(true);
  // Outside the circle, the blur spread some yellow into the sky.
  expect(glow.r).toBeGreaterThan(sky.r + 20);
  expect(near(grass, [0x2c, 0x7a, 0x35], 40), JSON.stringify(grass)).toBe(true);
  const ink = () => page.evaluate(() => {
    let n = 0;
    for (let y = 120; y < 180; y += 2) for (let x = 60; x < 220; x += 2) if (window.__pigmentoTest!.pixel(x, y).r < 80) n++;
    return n;
  });
  expect(await ink()).toBeGreaterThan(30);
  mkdirSync(testInfo.outputDir, { recursive: true });
  writeFileSync(path.join(testInfo.outputDir, 'assistant-scene.png'), Buffer.from(painted.png, 'base64'));

  // Each call was one step; undo takes them back one at a time, newest first.
  const steps = async () => (await page.locator('.history-list button').allTextContents()).slice(1);
  const done = await steps();
  expect(done).toEqual([
    'Assistant: Add layer',
    'Assistant: Fill',
    'Assistant: Add layer',
    'Assistant: Path',
    'Assistant: Add layer',
    'Assistant: Shape',
    'Assistant: Effect',
    'Assistant: Add layer',
    'Assistant: Brush stroke',
    'Assistant: Add layer',
    'Assistant: Text',
  ]);
  const current = () => page.locator('.history-list button.current').textContent();
  const px = (p: { x: number; y: number }) => page.evaluate(([x, y]) => window.__pigmentoTest!.pixel(x, y), [p.x, p.y] as const);
  await page.keyboard.press('Control+z');
  expect(await current()).toBe('Assistant: Add layer');
  expect(await ink()).toBe(0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await current()).toBe('Assistant: Add layer');
  expect(near(await px(at.grass), [0x3f, 0x9f, 0x4a], 4)).toBe(true);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await current()).toBe('Assistant: Shape');
  // The blur is gone: the sky next to the sun is plain sky again.
  expect(near(await px(at.glow), [0x6f, 0xb6, 0xff], 2)).toBe(true);
  expect(near(await px(at.sun), [0xff, 0xd2, 0x3f], 2)).toBe(true);
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z');
  expect(await current()).not.toMatch(/^Assistant: /);
  expect(near(await px(at.sky), [255, 255, 255], 0)).toBe(true);
  // And redo brings them all back.
  for (let i = 0; i < done.length; i++) await page.keyboard.press('Control+y');
  expect(await current()).toBe('Assistant: Text');
  expect(await ink()).toBeGreaterThan(30);

  // Saved, then opened again: the same scene, with its layers.
  const file = path.join(h.userData, 'Scene.pigm');
  await call('save_file', { path: file });
  await call('new_picture', { width: 100, height: 100 });
  await call('open_file', { path: file });
  const info = (await call('get_picture_info')).structuredContent as { width: number; height: number; layers: { name: string }[] };
  expect(info).toMatchObject({ width: 640, height: 400 });
  expect(info.layers.map((l) => l.name)).toEqual(['Words', 'Grass', 'Sun', 'Hill', 'Sky', 'Layer 1']);
  const reopened = await look();
  reopened.px.forEach((p, i) => expect(near(p, [painted.px[i].r, painted.px[i].g, painted.px[i].b], 1), `point ${i}`).toBe(true));
});
