import { expect, test, type Page } from '@playwright/test';
import { docToScreen, drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

/** Dispatch a synthetic pen stroke (Windows Ink delivers pen input as Pointer Events). */
async function penStroke(page: Page, from: [number, number], to: [number, number], pressure: number, eraser = false) {
  const a = await docToScreen(page, from[0], from[1]);
  const b = await docToScreen(page, to[0], to[1]);
  await page.evaluate(
    ({ a, b, pressure, eraser }) => {
      const el = document.querySelector<HTMLCanvasElement>('.pg-overlay-canvas')!;
      const buttons = eraser ? 32 : 1;
      const fire = (type: string, x: number, y: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            clientX: x,
            clientY: y,
            pointerId: 42,
            pointerType: 'pen',
            pressure: type === 'pointerup' ? 0 : pressure,
            button: type === 'pointermove' ? -1 : eraser ? 5 : 0,
            buttons: type === 'pointerup' ? 0 : buttons,
            bubbles: true,
          }),
        );
      fire('pointerdown', a.x, a.y);
      for (let i = 1; i <= 20; i++) fire('pointermove', a.x + ((b.x - a.x) * i) / 20, a.y + ((b.y - a.y) * i) / 20);
      fire('pointerup', b.x, b.y);
    },
    { a, b, pressure, eraser },
  );
}

/** Height of the dark band crossing column x between y0 and y1 (stroke thickness). */
async function thickness(page: Page, x: number, y0: number, y1: number): Promise<number> {
  return page.evaluate(
    ({ x, y0, y1 }) => {
      let n = 0;
      for (let y = y0; y <= y1; y++) if (window.__pigmentoTest!.pixel(x, y).r < 128) n++;
      return n;
    },
    { x, y0, y1 },
  );
}

test('pen pressure changes brush size and the eraser end erases', async () => {
  const { page } = h;
  await page.keyboard.press('b');
  await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: '32' }).click();
  await penStroke(page, [100, 100], [400, 100], 0.15);
  await penStroke(page, [100, 300], [400, 300], 1);
  const light = await thickness(page, 250, 60, 140);
  const firm = await thickness(page, 250, 260, 340);
  expect(light).toBeGreaterThan(0);
  expect(firm).toBeGreaterThan(light * 2);
  // Flip the pen: the eraser end erases even though the brush is selected, then the brush returns.
  await penStroke(page, [200, 300], [300, 300], 1, true);
  expect(await pixel(page, 250, 300)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('brush');
});

test('the canvas resize handle changes the canvas size', async () => {
  const { page } = h;
  const doc = () => page.evaluate(() => window.__pigmentoTest!.doc());
  const corner = await docToScreen(page, 1280, 800);
  await page.mouse.move(corner.x + 6.5, corner.y + 6.5);
  await page.mouse.down();
  const target = await docToScreen(page, 1000, 600);
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
  expect(await doc()).toEqual({ width: 1000, height: 600 });
  await page.keyboard.press('Control+z');
  expect(await doc()).toEqual({ width: 1280, height: 800 });
});

test('selections scale with handles and honour transparent selection', async () => {
  const { page } = h;
  // Black 20×20 square on white.
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #000000/ }).click({ button: 'right' });
  await drag(page, [
    [100, 100],
    [120, 120],
  ]);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Colour #FFFFFF/ }).click({ button: 'right' });

  // Blue bar the selection will be dropped onto.
  await page.keyboard.press('p');
  await page.getByRole('group', { name: 'Size' }).getByRole('button', { name: '4' }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  await drag(page, [
    [380, 330],
    [520, 330],
  ]);

  // Select 100..140 (square + white margin), drag the SE handle to double the size.
  await page.keyboard.press('s');
  await drag(page, [
    [100, 100],
    [140, 140],
  ]);
  const se = await docToScreen(page, 140, 140);
  await page.mouse.move(se.x, se.y);
  await page.mouse.down();
  const far = await docToScreen(page, 180, 180);
  await page.mouse.move(far.x, far.y, { steps: 6 });
  await page.mouse.up();
  const sel = (await page.evaluate(() => window.__pigmentoTest!.selection()))!;
  // The anchor corner stays put; the size lands within a pixel of the pointer (zoom < 100%).
  expect([sel.x, sel.y]).toEqual([100, 100]);
  expect(Math.abs(sel.w - 80)).toBeLessThanOrEqual(1);
  expect(Math.abs(sel.h - 80)).toBeLessThanOrEqual(1);

  // Transparent selection: the white margin no longer covers the blue bar.
  await page.getByRole('checkbox', { name: 'Transparent selection' }).check();
  await drag(page, [
    [150, 150],
    [440, 300],
  ]);
  await page.keyboard.press('Escape');
  expect((await pixel(page, 470, 330)).b).toBeGreaterThan(200); // under the white margin
  expect(await pixel(page, 400, 260)).toEqual({ r: 0, g: 0, b: 0, a: 255 }); // the scaled square
});

test('the text tool lists installed Windows fonts', async () => {
  const { page } = h;
  await page.keyboard.press('t');
  const font = page.getByRole('combobox', { name: 'Font' });
  await expect(font).toBeVisible();
  await expect.poll(() => font.locator('option').count()).toBeGreaterThan(20);
  await expect(font.locator('option', { hasText: 'Segoe UI' }).first()).toBeAttached();
});
