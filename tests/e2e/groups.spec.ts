import { expect, test } from '@playwright/test';
import { drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const rows = () => h.page.locator('.layer-row');
const panel = () => h.page.getByRole('region', { name: 'Layers' });

test('groups layers, collapses them and applies the group visibility and opacity', async () => {
  const { page } = h;
  // Layer 2 with a red square, grouped.
  await panel().getByRole('button', { name: 'New layer' }).click();
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #D7263D/ }).click({ button: 'right' });
  await drag(page, [
    [0, 0],
    [200, 200],
  ]);
  await page.keyboard.press('Enter');
  await panel().getByRole('button', { name: 'Group layer' }).click();
  await expect(rows()).toHaveCount(3);
  await expect(rows().first()).toContainText('Group 1');
  await expect(rows().nth(1)).toContainText('Layer 2');

  // Collapsing hides the children from the list, not from the image.
  await page.getByRole('button', { name: 'Collapse Group 1' }).click();
  await expect(rows()).toHaveCount(2);
  expect((await pixel(page, 100, 100)).g).toBeLessThan(60);
  await page.getByRole('button', { name: 'Expand Group 1' }).click();

  // Hiding the group hides everything in it.
  await page.getByRole('button', { name: 'Hide Group 1' }).click();
  expect(await pixel(page, 100, 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.getByRole('button', { name: 'Show Group 1' }).click();

  // Group opacity fades its whole content.
  const opacity = panel().getByRole('textbox', { name: 'Layer opacity' });
  await opacity.fill('50');
  await opacity.press('Enter');
  const half = await pixel(page, 100, 100);
  expect(half.g).toBeGreaterThan(100);
  expect(half.g).toBeLessThan(160);

  // A group holds no pixels: painting asks for a pixel layer.
  await page.keyboard.press('p');
  await drag(page, [
    [400, 400],
    [500, 400],
  ]);
  await expect(page.locator('.toast')).toContainText('Select a pixel layer to paint on.');

  // Ungroup puts the layers back; undo restores the group.
  await page.getByRole('tab', { name: 'Image' }).click();
  await page.getByRole('button', { name: 'Ungroup' }).click();
  await expect(rows()).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(rows()).toHaveCount(3);
  // The shortcut does the same.
  await page.keyboard.press('Control+Alt+Shift+g');
  await expect(rows()).toHaveCount(2);
});

test('blend modes inside groups look the same on screen and when saved', async () => {
  const result = await h.page.evaluate(async () => {
    const t = window.__pigmentoTest!;
    const base = t.layers().tree[0].id;
    t.fillLayer(base, { r: 30, g: 90, b: 200, a: 255 });
    const a = t.addLayer();
    t.fillLayer(a, { r: 230, g: 180, b: 40, a: 255 });
    t.setLayerProps(a, { blend: 'multiply' });
    const b = t.addLayer();
    t.fillLayer(b, { r: 250, g: 250, b: 250, a: 160 });
    t.setLayerProps(b, { blend: 'overlay' });
    // Children blend inside the isolated group, then the group blends with the base.
    const group = t.groupLayers([a, b])!;
    const out: { mode: string; js: number[]; gpu: number[] }[] = [];
    for (const mode of ['normal', 'screen', 'difference', 'luminosity']) {
      t.setLayerProps(group, { blend: mode, opacity: 0.75 });
      const js = t.pixel(4, 4);
      const gpu = await t.screenPixel(4, 4);
      out.push({ mode, js: [js.r, js.g, js.b], gpu: [gpu.r, gpu.g, gpu.b] });
    }
    return out;
  });
  for (const r of result) {
    const diff = Math.max(...r.js.map((v, i) => Math.abs(v - r.gpu[i])));
    expect(diff, `group ${r.mode}: js ${r.js} vs screen ${r.gpu}`).toBeLessThanOrEqual(3);
  }
});
