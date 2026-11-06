import { expect, test } from '@playwright/test';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
});

const MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'difference',
  'soft-light',
  'hard-light',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

test('saved pixels match the screen for every blend mode', async () => {
  h = await launchApp();
  await ready(h.page);
  const result = await h.page.evaluate(async (modes) => {
    const t = window.__pigmentoTest!;
    const base = t.layers().tree[0].id;
    t.fillLayer(base, { r: 200, g: 120, b: 40, a: 255 });
    const top = t.addLayer();
    t.fillLayer(top, { r: 60, g: 150, b: 220, a: 190 });
    const out: { mode: string; js: number[]; gpu: number[] }[] = [];
    for (const mode of modes) {
      t.setLayerProps(top, { blend: mode, opacity: 0.8 });
      const gpu = await t.screenPixel(5, 5);
      const js = t.pixel(5, 5);
      out.push({ mode, js: [js.r, js.g, js.b, js.a], gpu: [gpu.r, gpu.g, gpu.b, gpu.a] });
    }
    return out;
  }, MODES);
  for (const r of result) {
    const diff = Math.max(...r.js.map((v, i) => Math.abs(v - r.gpu[i])));
    expect(diff, `${r.mode}: js ${r.js} vs screen ${r.gpu}`).toBeLessThanOrEqual(3);
  }
});
