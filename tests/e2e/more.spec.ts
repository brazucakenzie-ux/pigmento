import { expect, test } from '@playwright/test';
import { clickDoc, docToScreen, drag, launchApp, pixel, ready, relaunch, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const live = () => h.page.evaluate(() => window.__pigmentoTest!.liveKind());
const hist = () => h.page.evaluate(() => window.__pigmentoTest!.history());

test('text tool types in place and rasterises on commit', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('t');
  await clickDoc(page, 100, 100);
  await page.locator('.text-editor').waitFor();
  await expect(page.locator('.text-editor')).toBeFocused();
  await page.keyboard.type('WWWW');
  expect(await live()).toBe('text');
  await page.keyboard.press('Control+Enter');
  expect(await live()).toBeNull();
  expect((await hist()).length).toBe(1);
  // Some dark text pixels now exist inside the box.
  const dark = await page.evaluate(() => {
    let n = 0;
    for (let y = 100; y < 130; y++) for (let x = 100; x < 200; x++) if (window.__pigmentoTest!.pixel(x, y).r < 100) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(30);
});

test('free-form selection lifts only the outlined pixels', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #000000/ }).click({ button: 'right' });
  await drag(page, [
    [100, 100],
    [300, 300],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('q');
  // Triangle lasso over the top-left half of the square.
  await drag(page, [
    [90, 90],
    [310, 90],
    [90, 310],
    [90, 92],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.selection())).not.toBeNull();
  await drag(page, [
    [130, 130],
    [530, 130],
  ]);
  await page.keyboard.press('Escape');
  // Inside the triangle moved away; the other half stayed.
  expect(await pixel(page, 120, 120)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(await pixel(page, 520, 120)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  expect(await pixel(page, 280, 280)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
});

test('polygon closes on double-click and curve bends twice', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('y');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #2BB24C/ }).click({ button: 'right' });
  await drag(page, [
    [100, 100],
    [300, 100],
  ]);
  await clickDoc(page, 300, 300);
  const last = await docToScreen(page, 100, 300);
  await page.mouse.dblclick(last.x, last.y);
  await page.keyboard.press('Enter');
  expect(await live()).toBeNull();
  const g = await pixel(page, 200, 200);
  expect(g.g).toBeGreaterThan(150);
  expect(g.r).toBeLessThan(100);

  await page.keyboard.press('c');
  await drag(page, [
    [400, 400],
    [700, 400],
  ]);
  await drag(page, [
    [500, 400],
    [500, 250],
  ]);
  await drag(page, [
    [600, 400],
    [600, 250],
  ]);
  expect(await live()).toBe('shape');
  await page.keyboard.press('Enter');
  // The curve bulged upward, so the straight line's midpoint stays white.
  expect(await pixel(page, 550, 400)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect((await hist()).length).toBe(2);
});

test('remembers tool options and view settings across restarts', async () => {
  h = await launchApp();
  await ready(h.page);
  await h.page.keyboard.press('b');
  await h.page.getByRole('group', { name: 'Size' }).getByRole('button', { name: '32' }).click();
  await h.page.getByRole('tab', { name: 'View' }).click();
  await h.page.getByRole('button', { name: 'Rulers' }).click();
  await h.page.waitForTimeout(900); // settings are saved with a short debounce
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()));
  await h.app.waitForEvent('close').catch(() => undefined);

  h = await relaunch(h);
  const { page } = h;
  await ready(page);
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('brush');
  await expect(page.getByRole('group', { name: 'Size' }).getByRole('button', { name: '32' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ruler.top')).toBeVisible();
});

test('prints the flattened image through the print pipeline', async () => {
  h = await launchApp();
  await ready(h.page);
  // Replace the OS print dialog with a probe that records what would be printed.
  await h.app.evaluate(({ app }) => {
    const g = globalThis as unknown as { __printed?: { w: number; h: number } | null };
    g.__printed = null;
    app.on('web-contents-created', (_e, wc) => {
      wc.print = ((_opts: unknown, cb?: (ok: boolean, reason: string) => void) => {
        void wc
          .executeJavaScript('(() => { const i = document.querySelector("img"); return { w: i.naturalWidth, h: i.naturalHeight }; })()')
          .then((size: { w: number; h: number }) => {
            g.__printed = size;
            cb?.(true, '');
          });
      }) as typeof wc.print;
    });
  });
  await h.page.keyboard.press('Control+p');
  await expect
    .poll(() => h.app.evaluate(() => (globalThis as unknown as { __printed?: unknown }).__printed))
    .toEqual({ w: 1280, h: 800 });
});

test('copies to and pastes from the Windows clipboard', async () => {
  // The system clipboard is shared with everything else on the PC, so this test overwrites it
  // and can be disturbed by other apps. Run it deliberately: PIGMENTO_E2E_CLIPBOARD=1.
  test.skip(!process.env.PIGMENTO_E2E_CLIPBOARD, 'Set PIGMENTO_E2E_CLIPBOARD=1 to run the clipboard test');
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await h.app.evaluate(({ clipboard }) => clipboard.clear());
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #D7263D/ }).click({ button: 'right' });
  await drag(page, [
    [0, 0],
    [50, 50],
  ]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await drag(page, [
    [0, 0],
    [50, 50],
  ]);
  await page.keyboard.press('Control+c');
  // The image really is on the system clipboard (as another app would see it).
  await expect
    .poll(() => h.app.evaluate(async ({ clipboard }) => (await clipboard.read()).some((i) => i.types.includes('image/png'))))
    .toBe(true);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+v');
  await expect.poll(live).toBe('float');
  await drag(page, [
    [25, 25],
    [425, 425],
  ]);
  await page.keyboard.press('Escape');
  const p = await pixel(page, 420, 420);
  expect(p.r).toBeGreaterThan(200);
  expect(p.g).toBeLessThan(60);

  // An image put on the clipboard by another program pastes as a new image.
  await h.app.evaluate(async ({ clipboard, nativeImage, ClipboardItem, dialog }) => {
    // Answer "Don't save" to the unsaved-changes prompt.
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    const bgra = Buffer.alloc(2 * 2 * 4, 0xff);
    const png = nativeImage.createFromBitmap(bgra, { width: 2, height: 2 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
  });
  await page.keyboard.press('Control+Alt+v');
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 2, height: 2 });
});

test('draws a long stroke on a 4000×3000 canvas within the frame budget', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('Control+n');
  const dlg = page.getByRole('dialog', { name: 'New image' });
  await dlg.getByRole('textbox', { name: 'Width' }).fill('4000');
  await dlg.getByRole('textbox', { name: 'Height' }).fill('3000');
  await dlg.getByRole('textbox', { name: 'Height' }).press('Tab');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await page.keyboard.press('b');
  await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: '32' }).click();
  // Measure main-thread time spent handling each pointer move plus the next frame.
  const stats = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.pg-overlay-canvas')!;
    const r = canvas.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, pointerId: 7, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true }),
      );
    fire('pointerdown', 40, 40);
    const times: number[] = [];
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now();
      fire('pointermove', 40 + i * 6, 40 + Math.sin(i / 8) * 120 + i * 3);
      await new Promise<void>((res) => requestAnimationFrame(() => res()));
      times.push(performance.now() - t0);
    }
    const t0 = performance.now();
    fire('pointerup', 760, 400);
    const commit = performance.now() - t0;
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(times.length / 2)], p95: times[Math.floor(times.length * 0.95)], commit };
  });
  console.warn('4000×3000 brush stroke timing (ms):', JSON.stringify(stats));
  // One frame at 60 Hz is ~16.7 ms; handling + render must fit comfortably.
  expect(stats.median).toBeLessThan(20);
  expect((await hist()).length).toBe(1);
});
