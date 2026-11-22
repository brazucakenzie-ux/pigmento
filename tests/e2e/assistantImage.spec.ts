// AI assistants, Stop 8B: the image, effects, actions and settings (8.10), through an MCP client.
import { expect, test } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectStdio, firstText, setAssistants } from './assistantClient';
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

test('an assistant resizes, crops, rotates, applies effects, runs actions and changes settings', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined };
  };
  const info = async () => (await call('get_picture_info')).data as { width: number; height: number; selection: unknown; layers: { id: string }[] };
  const px = (x: number, y: number) => page.evaluate(([a, b]) => window.__pigmentoTest!.pixel(a, b), [x, y] as const);
  const steps = async () => (await page.locator('.history-list button').allTextContents()).filter((s) => s.startsWith('Assistant: '));

  // Resize keeps the shape when given one side; a selection is let go first.
  expect((await call('resize_image', { width: 640 })).data).toMatchObject({ width: 640, height: 400 });
  await call('select', { shape: 'rectangle', x: 10, y: 10, width: 50, height: 50 });
  expect((await call('resize_image', { scale: 0.5 })).data).toMatchObject({ width: 320, height: 200 });
  expect((await info()).selection).toBeNull();
  // Canvas size, crop, rotate and flip.
  expect((await call('canvas_size', { width: 400, height: 300, anchor: 'c' })).data).toMatchObject({ width: 400, height: 300 });
  expect((await call('crop')).text).toMatch(/Give a rectangle to crop to, or select something first/);
  expect((await call('crop', { x: 50, y: 40, width: 120, height: 80 })).data).toMatchObject({ width: 120, height: 80 });
  expect((await call('rotate_flip', { rotate: 90 })).text).toMatch(/Rotated 90°: the picture is 80 × 120 pixels/);
  expect((await call('rotate_flip', { flip: 'horizontal' })).ok).toBe(true);
  expect(await info()).toMatchObject({ width: 80, height: 120 });

  // An effect with its settings: red goes grey, and the settings are checked.
  const layer = (await info()).layers[0].id;
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 200, g: 40, b: 40, a: 255 }), layer);
  expect((await call('apply_effect', { effect: 'grayscale' })).text).toMatch(/^Applied .* to “Layer 1”\.$/);
  const grey = await px(40, 60);
  expect(Math.abs(grey.r - grey.g) + Math.abs(grey.g - grey.b)).toBeLessThan(4);
  expect((await call('apply_effect', { effect: 'gaussianBlur', settings: { nope: 3 } })).text).toMatch(/has no setting nope\. Its settings are/);
  expect((await call('apply_effect', { effect: 'nope' })).text).toMatch(/no effect nope\. list_available/);

  // Actions by id: invert colours, duplicate the layer, and the grid (a setting).
  const before = await px(40, 60);
  expect((await call('run_action', { action: 'invertColors' })).ok).toBe(true);
  expect((await px(40, 60)).r).toBe(255 - before.r);
  expect((await call('run_action', { action: 'layerDuplicate' })).ok).toBe(true);
  expect((await info()).layers).toHaveLength(2);
  const view = async () => ((await call('get_settings')).data as { view: { gridlines: boolean; rulers: boolean } }).view;
  const grid = (await view()).gridlines;
  expect((await call('run_action', { action: 'gridlines' })).ok).toBe(true);
  expect((await view()).gridlines).toBe(!grid);
  // File actions have their own tools; actions with a dialog are for the user (the dialog doesn't stay).
  expect((await call('run_action', { action: 'save' })).text).toMatch(/file action: use new_picture, open_file, save_file/);
  expect((await call('run_action', { action: 'stopAssistants' })).text).toMatch(/Only the user can stop AI assistants/);
  expect((await call('run_action', { action: 'canvasSize' })).text).toMatch(/opens a dialog, which is for the user/);
  await expect(page.getByRole('dialog', { name: 'Canvas size' })).toHaveCount(0);
  // (No empty popover is left showing either: the badge's own stays hidden until it's opened.)
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await call('run_action', { action: 'nope' })).text).toMatch(/no action nope/);

  // Settings: seen without the assistants' own, changed by section, checked, and never the assistants'.
  const all = (await call('get_settings')).data!;
  expect(all).toHaveProperty('view');
  expect(all).not.toHaveProperty('assistants');
  expect((await call('change_settings', { changes: { view: { rulers: true } } })).text).toBe('Changed view.');
  expect((await view()).rulers).toBe(true);
  expect((await call('change_settings', { changes: { view: { gridSize: 1 } } })).text).toMatch(/view\.gridSize/);
  expect((await call('change_settings', { changes: { assistants: { look: 'deny' } } })).text).toMatch(/can only be changed by the user/);
  expect((await call('change_settings', { changes: { nope: 1 } })).text).toMatch(/no settings section nope/);
  // Not allowed to change settings: change_settings and setting actions are refused; other actions aren't.
  await setAssistants(h, { settings: 'deny' });
  expect((await call('change_settings', { changes: { view: { rulers: false } } })).text).toMatch(/doesn’t let AI assistants change Pigmento’s settings/);
  expect((await call('run_action', { action: 'gridlines' })).text).toMatch(/doesn’t let AI assistants change Pigmento’s settings/);
  expect((await call('run_action', { action: 'invertColors' })).ok).toBe(true);

  // One step each (the grid isn't an undo step: it's a setting).
  expect(await steps()).toEqual([
    'Assistant: Resize',
    'Assistant: Select',
    'Assistant: Resize',
    'Assistant: Canvas size',
    'Assistant: Crop',
    'Assistant: Rotate or flip',
    'Assistant: Rotate or flip',
    'Assistant: Effect',
    'Assistant: Action',
    'Assistant: Action',
    'Assistant: Action',
  ]);
});
