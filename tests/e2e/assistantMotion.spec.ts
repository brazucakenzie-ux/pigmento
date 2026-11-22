// AI assistants, Stop 8C: motion (8.14): following a path and facing its way, trails, trims and spin.
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, firstText, imageOf } from './assistantClient';
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

test('an assistant sends a piece along a path with a trail, draws a path on, and spins a piece forever', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined, raw: r };
  };
  /** Count the pixels of a frame near a colour, inside a box (the assistant's view of it). */
  const count = async (frame: number, box: { x: number; y: number; w: number; h: number }, test: string) => {
    const r = await call('get_picture_image', { frame, maxSize: 2048 });
    const b64 = imageOf(r.raw)!.data!;
    return page.evaluate(
      async ([data, b, kind]) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(b.x, b.y, b.w, b.h).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [r, g, bl] = [d[i], d[i + 1], d[i + 2]];
          if (kind === 'red' ? r > 180 && g < 90 && bl < 90 : kind === 'green' ? g > 120 && r < 110 && bl < 110 : kind === 'blue' ? bl > 180 && r < 90 && g < 90 : r < 60 && g < 60 && bl < 60) n++;
        }
        return n;
      },
      [b64, box, test] as const,
    );
  };
  const info = async () => (await call('get_picture_info')).data as { layers: { id: string; name: string; objects?: { id: string; kind: string }[] }[]; animation: { pieces: { id: string; path: unknown; facesItsWay: boolean; spins: boolean; trails: string[] }[] } };

  // A path on a shapes layer: its object id comes back, and picture info lists it.
  const shapes = (await call('add_layer', { kind: 'shapes', name: 'Paths' })).data!.layer as string;
  const route = await call('draw_path', { points: [{ x: 100, y: 600 }, { x: 1100, y: 200 }], outline: '#000000', outlineWidth: 2 });
  const routeId = route.data!.object as string;
  expect(route.text).toMatch(/Its object id is /);
  expect((await info()).layers.find((l) => l.id === shapes)!.objects).toEqual([{ id: routeId, kind: 'path' }]);

  // The rocket: a red square on the pixels layer, made a piece, with keyframes at 1 and 24.
  const pixels = (await info()).layers.find((l) => l.name === 'Layer 1')!.id;
  await call('set_layer', { layer: pixels, active: true });
  await call('select', { shape: 'rectangle', x: 40, y: 40, width: 40, height: 40 });
  await call('fill', { color: '#dc1e1e' });
  const rocket = (await call('make_piece', { from: 'selection', name: 'Rocket' })).data!.piece as string;
  await call('set_keyframe', { piece: rocket, frame: 24, opacity: 1 });
  // It follows the path, start to end, facing its way.
  expect((await call('set_piece', { piece: rocket, path: { object: routeId }, facesItsWay: true })).ok).toBe(true);
  expect((await info()).animation.pieces.find((p) => p.id === rocket)).toMatchObject({ path: { layer: shapes, object: routeId }, facesItsWay: true });
  const near = (x: number, y: number) => ({ x: x - 40, y: y - 40, w: 80, h: 80 });
  expect(await count(1, near(100, 600), 'red')).toBeGreaterThan(400);
  expect(await count(24, near(1100, 200), 'red')).toBeGreaterThan(400);
  expect(await count(1, near(60, 60), 'red')).toBe(0);
  // A quarter of the way along at frame 12.
  expect((await call('set_keyframe', { piece: rocket, frame: 12, progress: 0.25 })).ok).toBe(true);
  expect(await count(12, near(350, 500), 'red')).toBeGreaterThan(400);
  expect((await call('set_piece', { piece: rocket, path: { object: 'nope' } })).text).toMatch(/no shape nope on a shapes layer/);

  // A trail of green smoke behind it.
  const trail = await call('set_trail', { piece: rocket, add: 'rocketSmoke' });
  const trailId = trail.data!.trail as string;
  expect((await info()).animation.pieces.find((p) => p.id === rocket)!.trails).toEqual([trailId]);
  expect((await call('set_trail', { piece: rocket, settings: { size: 30, colors: ['#22cc44', '#118822'], opacity: 1, fade: 0.2 } })).ok).toBe(true);
  const smoke = await count(20, { x: 100, y: 200, w: 1000, h: 440 }, 'green');
  expect(smoke).toBeGreaterThan(200);
  expect(await count(1, { x: 100, y: 200, w: 1000, h: 440 }, 'green')).toBeLessThan(smoke / 4);
  expect((await call('set_trail', { piece: rocket, remove: true })).text).toMatch(/Removed the trail/);
  expect((await info()).animation.pieces.find((p) => p.id === rocket)!.trails).toEqual([]);

  // Draw on: a second path is drawn from nothing at frame 1 to all of it at frame 10.
  await call('set_layer', { layer: shapes, active: true });
  const line = (await call('draw_path', { points: [{ x: 200, y: 750 }, { x: 1000, y: 750 }], outline: '#000000', outlineWidth: 10 })).data!.object as string;
  const trim = await call('set_trim', { layer: shapes, objects: [line], effect: 'drawOn', from: 1, to: 10 });
  expect(trim.text).toBe('The shape is drawn on from frame 1 to 10.');
  const end = { x: 900, y: 740, w: 90, h: 20 };
  expect(await count(1, end, 'dark')).toBe(0);
  expect(await count(10, end, 'dark')).toBeGreaterThan(300);
  expect((await call('set_trim', { layer: shapes, objects: [line], tie: { piece: rocket, end: 'end' } })).text).toMatch(/tied to “Rocket”/);
  expect((await call('set_trim', { layer: pixels, objects: [line], effect: 'drawOn' })).text).toMatch(/isn’t a shapes layer/);

  // Spin forever: a bar half a turn a second, upright a quarter turn later (12 frames a second).
  await call('set_layer', { layer: pixels, active: true });
  await call('select', { shape: 'rectangle', x: 560, y: 380, width: 160, height: 20 });
  await call('fill', { color: '#1e3cdc' });
  const bar = (await call('make_piece', { from: 'selection', name: 'Bar' })).data!.piece as string;
  expect((await call('set_piece', { piece: bar, spin: { spin: 0.5 } })).ok).toBe(true);
  expect((await info()).animation.pieces.find((p) => p.id === bar)!.spins).toBe(true);
  const upright = { x: 630, y: 320, w: 20, h: 40 };
  expect(await count(1, upright, 'blue')).toBe(0);
  expect(await count(7, upright, 'blue')).toBeGreaterThan(300);
  expect((await call('set_piece', { piece: bar, spin: 'stop' })).ok).toBe(true);
  expect((await info()).animation.pieces.find((p) => p.id === bar)!.spins).toBe(false);

  const steps = (await page.locator('.history-list button').allTextContents()).filter((s) => s.startsWith('Assistant: '));
  expect(steps).toEqual(expect.arrayContaining(['Assistant: Trail', 'Assistant: Trim', 'Assistant: Piece']));
});
