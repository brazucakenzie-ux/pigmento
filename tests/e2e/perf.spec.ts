import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { drag, launchApp, ready, tempFile, type AppHandle } from './harness';

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
  await expect(overlay).toContainText('1280 × 800 (1.0 MP)');
  await expect(overlay.getByRole('img', { name: /Recent frame times/ })).toBeVisible();
  // Copying would overwrite the real clipboard, so it's tried only when tests may.
  await expect(overlay.getByRole('button', { name: 'Copy readings' })).toBeVisible();
  if (process.env.PIGMENTO_E2E_CLIPBOARD) {
    await overlay.getByRole('button', { name: 'Copy readings' }).click();
    await expect(page.locator('.toast', { hasText: 'Readings copied.' })).toBeVisible();
  }
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

test('opens a 100-megapixel image within its time and memory budget', async () => {
  test.setTimeout(180_000);
  h = await launchApp();
  const { page, app } = h;
  await ready(page);
  // A 10000 × 10000 gradient, so every tile holds real pixels.
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(10000, 10000);
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 10000, 10000);
    grad.addColorStop(0, '#4b4be0');
    grad.addColorStop(1, '#ff8a3d');
    g.fillStyle = grad;
    g.fillRect(0, 0, 10000, 10000);
    // As base64 text (a list of numbers this size would swamp the test runner).
    const blob = await c.convertToBlob({ type: 'image/png' });
    return await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(blob);
    });
  });
  const file = tempFile('big.png');
  writeFileSync(file, Buffer.from(png, 'base64'));
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
  await page.waitForLoadState('domcontentloaded');
  await ready(page);
  await app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
  // File → Open (a shortcut pressed straight after the reload can arrive before the window
  // listens for keys, which made this test flaky; the menu is ready as soon as it shows).
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const t0 = Date.now();
  await page.getByRole('menuitem', { name: /^Open/ }).first().click();
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 10000, height: 10000 });
  // Shown on screen, not just loaded.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const ms = Date.now() - t0;
  const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, mb: Math.round(m.memory.workingSetSize / 1024) })));
  const renderer = Math.max(...metrics.filter((m) => m.type === 'Tab').map((m) => m.mb));
  console.warn('100 MP open (ms):', ms, 'renderer working set (MB):', renderer, JSON.stringify(metrics));
  // Measured on this PC: about 2 s and 1.4 GB (the GPU process holds the screen copies besides).
  expect(ms).toBeLessThan(8000);
  expect(renderer).toBeLessThan(2500);
  // Still responsive: a stroke on it lands.
  await page.keyboard.press('b');
  await drag(page, [
    [100, 100],
    [300, 100],
  ]);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(1);
});
