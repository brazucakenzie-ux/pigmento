// AI assistants, Stop 8B: layers, selections and moving pixels (8.8), through an MCP client.
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, firstText } from './assistantClient';
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

type LayerView = { id: string; name: string; kind: string; opacity: number; blend: string; locked: boolean; active: boolean; children?: LayerView[] };
const RED = { r: 230, g: 20, b: 20, a: 255 };

test('an assistant arranges layers, selects and moves pixels, each change one named undo step', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined };
  };
  const layers = async () => ((await call('get_picture_info')).data as { layers: LayerView[] }).layers;
  const steps = () => page.locator('.history-list button').allTextContents();
  const bg = (await layers())[0].id;

  // Layers: add, add a shapes layer above the background, move, group, set, delete.
  const sky = (await call('add_layer', { name: 'Sky' })).data!.layer as string;
  expect((await layers()).map((l) => [l.name, l.active])).toEqual([
    ['Sky', true],
    ['Layer 1', false],
  ]);
  const shapes = (await call('add_layer', { kind: 'shapes', name: 'Lines', above: bg })).data!.layer as string;
  expect((await layers()).map((l) => [l.name, l.kind])).toEqual([
    ['Sky', 'pixels'],
    ['Lines', 'shapes'],
    ['Layer 1', 'pixels'],
  ]);
  expect((await call('move_layer', { layer: sky, to: 'bottom' })).ok).toBe(true);
  expect((await layers()).map((l) => l.name)).toEqual(['Lines', 'Layer 1', 'Sky']);
  expect((await call('move_layer', { layer: sky, to: 'bottom' })).text).toMatch(/already there/);
  const group = (await call('group_layers', { layers: [shapes, bg], name: 'Scene' })).data!.layer as string;
  const tree = await layers();
  expect(tree.map((l) => l.name)).toEqual(['Scene', 'Sky']);
  expect(tree[0].children!.map((l) => l.name)).toEqual(['Lines', 'Layer 1']);
  expect((await call('move_layer', { layer: sky, into: group })).ok).toBe(true);
  expect((await layers())[0].children!.map((l) => l.name)).toEqual(['Sky', 'Lines', 'Layer 1']);
  expect((await call('move_layer', { layer: sky, into: 'picture', to: 'bottom' })).ok).toBe(true);
  expect((await call('set_layer', { layer: sky, opacity: 0.5, blend: 'multiply', name: 'Sky glow' })).ok).toBe(true);
  expect((await layers()).find((l) => l.id === sky)).toMatchObject({ name: 'Sky glow', opacity: 0.5, blend: 'multiply' });
  expect((await call('delete_layer', { layer: shapes })).ok).toBe(true);
  expect((await layers())[0].children!.map((l) => l.name)).toEqual(['Layer 1']);
  expect((await call('delete_layer', { layer: 'nope' })).text).toMatch(/no layer nope/);
  expect((await call('move_layer', { layer: sky, into: bg })).text).toMatch(/isn’t a group/);

  // Each call was one step of its own, named for the assistant.
  expect((await steps()).slice(1)).toEqual([
    'Assistant: Add layer',
    'Assistant: Add layer',
    'Assistant: Move layer',
    'Assistant: Group layers',
    'Assistant: Move layer',
    'Assistant: Move layer',
    'Assistant: Set layer',
    'Assistant: Delete layer',
  ]);
  // Undo takes the deletion back, in one go.
  await page.keyboard.press('Control+z');
  expect((await layers())[0].children!.map((l) => l.name)).toEqual(['Lines', 'Layer 1']);

  // Selections: shapes, combined, all, none, the opposite.
  expect((await call('select', { shape: 'rectangle', x: 10, y: 20, width: 100, height: 50 })).data).toMatchObject({ selection: { x: 10, y: 20, width: 100, height: 50 } });
  expect((await call('select', { shape: 'ellipse', x: 200, y: 20, width: 40, height: 40, mode: 'add' })).data).toMatchObject({ selection: { x: 10, y: 20, width: 230, height: 50 } });
  expect((await call('select', { shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 60 }] })).data).toMatchObject({ selection: { x: 0, y: 0 } });
  expect(await call('select', { shape: 'none' })).toMatchObject({ text: 'Nothing is selected.' });
  expect((await call('select', { shape: 'all' })).data).toMatchObject({ selection: { x: 0, y: 0, width: 1280, height: 800 } });
  expect((await call('select', { shape: 'invert' })).data).toMatchObject({ selection: null });
  expect((await call('select', { shape: 'grow', amount: 4 })).text).toMatch(/no selection to grow/);

  // The magic wand and colour range find a red square on the background.
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 300, y: 200, w: 120, h: 80 }), [bg, RED] as const);
  expect((await call('select', { shape: 'wand', x: 350, y: 240, layer: bg })).data).toMatchObject({ selection: { x: 300, y: 200, width: 120, height: 80 } });
  expect((await layers())[0].children!.find((l) => l.id === bg)?.active).toBe(true);
  expect((await call('select', { shape: 'color', color: '#e61414', tolerance: 5 })).data).toMatchObject({ selection: { x: 300, y: 200, width: 120, height: 80 } });
  expect((await call('select', { shape: 'grow', amount: 5 })).data).toMatchObject({ selection: { x: 295, y: 195, width: 130, height: 90 } });
  expect((await call('select', { shape: 'wand', x: 5000, y: 5 })).text).toMatch(/outside the picture/);

  // Moving pixels: the selected square moves right, leaving see-through, and your tool stays.
  await call('select', { shape: 'rectangle', x: 300, y: 200, width: 120, height: 80 });
  const moved = await call('transform_pixels', { dx: 200 });
  expect(moved).toMatchObject({ ok: true, text: 'Moved the selected pixels.' });
  const px = (x: number, y: number) => page.evaluate(([a, b]) => window.__pigmentoTest!.pixel(a, b), [x, y] as const);
  expect(await px(350, 240)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(await px(550, 240)).toEqual(RED);
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('pencil');
  // Everything on the layer, flipped, when nothing is selected: red (500–620) and blue (100–140) swap ends.
  const BLUE = { r: 20, g: 40, b: 230, a: 255 };
  await page.evaluate(([id, c]) => window.__pigmentoTest!.fillLayer(id, c, { x: 100, y: 220, w: 40, h: 40 }), [bg, BLUE] as const);
  await call('select', { shape: 'none' });
  expect((await call('transform_pixels', { flip: 'horizontal', layer: bg })).text).toMatch(/Moved the layer “Layer 1”/);
  expect(await px(150, 240)).toEqual(RED);
  expect(await px(600, 240)).toEqual(BLUE);
  // A locked layer, or a shapes layer, can't be moved.
  await call('set_layer', { layer: bg, locked: true });
  expect((await call('transform_pixels', { dx: 5, layer: bg })).text).toMatch(/is locked\. set_layer with locked: false/);
  expect((await call('transform_pixels', { dx: 5, layer: shapes })).text).toMatch(/is a shapes layer/);
  expect((await steps()).filter((s) => s.startsWith('Assistant: ')).length).toBeGreaterThan(15);
});
