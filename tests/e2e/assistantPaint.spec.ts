// AI assistants, Stop 8B: painting (8.9), through an MCP client: colours, fill, strokes, lines,
// shapes, paths and text, watched as they're drawn, each one undo step.
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

type Px = { r: number; g: number; b: number; a: number };
const isColor = (p: Px, c: [number, number, number], tol = 40) => Math.abs(p.r - c[0]) <= tol && Math.abs(p.g - c[1]) <= tol && Math.abs(p.b - c[2]) <= tol;

test('an assistant paints strokes, fills, lines, shapes, paths and text that you watch, each one undo step', async () => {
  const { page } = h;
  const client = await connectStdio(h, clients);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { ok: !r.isError, text: firstText(r), data: r.structuredContent as Record<string, unknown> | undefined };
  };
  const px = (x: number, y: number) => page.evaluate(([a, b]) => window.__pigmentoTest!.pixel(a, b), [x, y] as const);
  /** How many pixels in a box are dark (text). */
  const dark = (x: number, y: number, w: number, hh: number) =>
    page.evaluate(
      ([x0, y0, bw, bh]) => {
        let n = 0;
        for (let yy = y0; yy < y0 + bh; yy += 2) for (let xx = x0; xx < x0 + bw; xx += 2) if (window.__pigmentoTest!.pixel(xx, yy).r < 90) n++;
        return n;
      },
      [x, y, w, hh] as const,
    );
  const steps = () => page.locator('.history-list button').allTextContents();

  // Colours: set on purpose; painting in another colour leaves them alone.
  expect((await call('set_colors', { primary: '#112233' })).data).toMatchObject({ primary: '#112233ff' });

  // A brush stroke, watched over about half a second, in red; your tool and colours stay.
  const t0 = Date.now();
  const stroke = await call('brush_stroke', { points: [{ x: 100, y: 100 }, { x: 300, y: 100, pressure: 0.8 }], size: 12, color: '#ff0000' });
  const watched = Date.now() - t0;
  expect(stroke.ok, stroke.text).toBe(true);
  expect(watched).toBeGreaterThanOrEqual(450);
  expect(isColor(await px(200, 100), [255, 0, 0])).toBe(true);
  expect(isColor(await px(200, 130), [255, 255, 255], 2)).toBe(true);
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('pencil');
  expect(((await call('get_picture_info')).data as { colors: { primary: string } }).colors.primary).toBe('#112233ff');
  // Erasing takes it away (the white paper shows), and instant drawing doesn't wait.
  await setAssistants(h, { pace: 'instant' });
  const t1 = Date.now();
  expect((await call('brush_stroke', { points: [{ x: 120, y: 100 }, { x: 180, y: 100 }], size: 30, erase: true })).text).toMatch(/^Erased a stroke/);
  // (The pace comes with each call, so the window needn't have seen the setting change.)
  expect(Date.now() - t1).toBeLessThan(300);
  expect(isColor(await px(150, 100), [255, 255, 255], 2)).toBe(true);
  expect(isColor(await px(250, 100), [255, 0, 0])).toBe(true);
  await setAssistants(h, { pace: 'watch' });

  // Fill: the selection on a new layer.
  await call('add_layer', { name: 'Fills' });
  await call('select', { shape: 'rectangle', x: 700, y: 500, width: 100, height: 100 });
  expect((await call('fill', { color: '#0000ff' })).text).toMatch(/Filled the selection on “Fills”/);
  expect(isColor(await px(750, 550), [0, 0, 255], 2)).toBe(true);
  expect(isColor(await px(650, 550), [255, 255, 255], 2)).toBe(true);
  await call('select', { shape: 'none' });
  // And from a point: the blue square becomes green, and nothing around it.
  expect((await call('fill', { x: 750, y: 550, color: '#00ff00', tolerance: 5 })).ok).toBe(true);
  expect(isColor(await px(750, 550), [0, 255, 0], 2)).toBe(true);
  expect(isColor(await px(650, 550), [255, 255, 255], 2)).toBe(true);

  // A library shape on pixels, a line with an arrow, a closed path, and text.
  expect((await call('draw_shape', { shape: 'circle', x: 900, y: 100, width: 100, height: 100, fill: '#ffff00' })).text).toMatch(/^Drew a .* on “Fills”\.$/);
  expect(isColor(await px(950, 150), [255, 255, 0], 2)).toBe(true);
  expect(isColor(await px(905, 105), [255, 255, 255], 2)).toBe(true);
  expect((await call('draw_line', { from: { x: 100, y: 600 }, to: { x: 400, y: 600 }, width: 6, color: '#ff00ff', arrowEnd: 'triangle' })).ok).toBe(true);
  expect(isColor(await px(250, 600), [255, 0, 255], 2)).toBe(true);
  const tri = await call('draw_path', { points: [{ x: 500, y: 300 }, { x: 600, y: 300 }, { x: 550, y: 380 }], closed: true, fill: '#00ffff', outline: 'none' });
  expect(tri.text).toMatch(/closed path of 3 points/);
  expect(isColor(await px(550, 320), [0, 255, 255], 2)).toBe(true);
  expect(await dark(500, 650, 200, 80)).toBe(0);
  expect((await call('add_text', { text: 'Hi there', x: 500, y: 650, size: 36, color: '#000000', bold: true })).ok).toBe(true);
  expect(await dark(500, 650, 200, 80)).toBeGreaterThan(20);

  // On a shapes layer, a shape stays an object; text needs pixels.
  await call('add_layer', { kind: 'shapes', name: 'Objects' });
  expect((await call('draw_shape', { shape: 'star-5', x: 1000, y: 400, width: 120, height: 120, fill: '#ff8800', rotate: 15 })).text).toMatch(/on “Objects” \(an object you can still edit\)/);
  expect(isColor(await px(1060, 465), [255, 136, 0], 2)).toBe(true);
  expect((await call('add_text', { text: 'No', x: 10, y: 10 })).text).toMatch(/is a shapes layer/);

  // What isn't there is explained.
  expect((await call('brush_stroke', { points: [{ x: 1, y: 1 }], brush: 'nope', layer: 'nope' })).text).toMatch(/no layer nope/);
  const fills = ((await call('get_picture_info')).data as { layers: { id: string; name: string }[] }).layers.find((l) => l.name === 'Fills')!.id;
  expect((await call('brush_stroke', { points: [{ x: 1, y: 1 }], brush: 'nope', layer: fills })).text).toMatch(/no brush nope\. list_available/);
  expect((await call('draw_shape', { shape: 'nope', x: 0, y: 0, width: 10, height: 10 })).text).toMatch(/no shape nope/);
  expect((await call('fill', { x: 99999, y: 5 })).text).toMatch(/outside the picture/);

  // Each was one step, named for the assistant; one undo takes the text away.
  const named = (await steps()).filter((s) => s.startsWith('Assistant: '));
  expect(named).toEqual([
    'Assistant: Brush stroke',
    'Assistant: Brush stroke',
    'Assistant: Add layer',
    'Assistant: Select',
    'Assistant: Fill',
    'Assistant: Select',
    'Assistant: Fill',
    'Assistant: Shape',
    'Assistant: Line',
    'Assistant: Path',
    'Assistant: Text',
    'Assistant: Add layer',
    'Assistant: Shape',
  ]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await dark(500, 650, 200, 80)).toBe(0);
  expect(isColor(await px(550, 320), [0, 255, 255], 2)).toBe(true);
});
