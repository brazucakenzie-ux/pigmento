import { expect, test, type Page } from '@playwright/test';
import { drag, launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

async function bigImage(page: Page): Promise<void> {
  await page.keyboard.press('Control+n');
  const dlg = page.getByRole('dialog', { name: 'New image' });
  await dlg.getByRole('textbox', { name: 'Width' }).fill('4000');
  await dlg.getByRole('textbox', { name: 'Height' }).fill('3000');
  await dlg.getByRole('textbox', { name: 'Height' }).press('Tab');
  await dlg.getByRole('button', { name: 'Create' }).click();
}

test('starts in under 3 seconds', async () => {
  const t0 = Date.now();
  h = await launchApp();
  await ready(h.page);
  const ms = Date.now() - t0;
  console.warn('app load (ms):', ms);
  expect(ms).toBeLessThan(3000);
});

test('flood-fills a 4000×3000 image in under 300 ms', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await bigImage(page);
  await page.keyboard.press('f');
  // From the click until the fill is in the history (the whole white canvas is one region).
  const ms = await page.evaluate(async () => {
    const t = window.__pigmentoTest!;
    const before = t.history().length;
    const canvas = document.querySelector<HTMLCanvasElement>('.pg-overlay-canvas')!;
    const r = canvas.getBoundingClientRect();
    const fire = (type: string) =>
      canvas.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 3, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }));
    const t0 = performance.now();
    fire('pointerdown');
    fire('pointerup');
    while (t.history().length === before) await new Promise((res) => setTimeout(res, 2));
    return performance.now() - t0;
  });
  console.warn('4000×3000 flood fill (ms):', Math.round(ms));
  expect(ms).toBeLessThan(300);
});

test('shows frame time, latency and memory on a hidden shortcut, and 500 undo/redo cycles don’t leak', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.keyboard.press('Control+Alt+Shift+P');
  const overlay = page.getByRole('status', { name: 'Performance' });
  await expect(overlay).toBeVisible();
  await page.keyboard.press('b');
  for (let i = 0; i < 10; i++) {
    await drag(page, [
      [100 + i * 40, 100],
      [200 + i * 40, 400],
      [300 + i * 40, 200],
    ]);
  }
  await expect(overlay).toContainText(/Pointer → pixels\s*\d+\.\d ms/);
  await expect(overlay).toContainText('Image (1 layers)');
  // Not in the shortcuts list.
  await page.keyboard.press('F1');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).not.toContainText('Performance overlay');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Alt+Shift+P');
  await expect(overlay).toBeHidden();

  const cycles = (n: number) =>
    page.evaluate(async (count) => {
      const key = (k: string, shift = false) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true }));
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 10; k++) key('z');
        for (let k = 0; k < 10; k++) key('y');
        if (i % 25 === 0) await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
      return window.__pigmentoTest!.history();
    }, n);
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  // Warm up (lazy caches fill once), then measure across 500 cycles of undo all / redo all.
  await cycles(50);
  const before = await heap();
  const hist = await cycles(500);
  const after = await heap();
  console.warn('heap before/after 500 undo/redo cycles (MB):', (before / 1048576).toFixed(1), (after / 1048576).toFixed(1));
  expect(hist).toMatchObject({ index: 10, length: 10 });
  expect(after - before).toBeLessThan(5 * 1024 * 1024);
});
