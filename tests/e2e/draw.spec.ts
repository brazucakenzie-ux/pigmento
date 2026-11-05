import { expect, test } from '@playwright/test';
import { clickDoc, drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const tool = () => h.page.evaluate(() => window.__pigmentoTest!.tool());
const hist = () => h.page.evaluate(() => window.__pigmentoTest!.history());

test('draws with the pencil, then undoes and redoes', async () => {
  const { page } = h;
  await page.getByRole('button', { name: 'Pencil' }).first().click();
  expect(await tool()).toBe('pencil');
  await drag(page, [
    [100, 100],
    [300, 100],
  ]);
  expect(await pixel(page, 200, 100)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  expect(await pixel(page, 200, 140)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  expect((await hist()).index).toBe(1);
  await expect(page.locator('.history-list button.current')).toHaveText('Pencil');

  await page.keyboard.press('Control+z');
  expect(await pixel(page, 200, 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.keyboard.press('Control+y');
  expect(await pixel(page, 200, 100)).toEqual({ r: 0, g: 0, b: 0, a: 255 });

  // History panel: click the first state to jump back.
  await page.locator('.history-list button').first().click();
  expect((await hist()).index).toBe(0);
  expect(await pixel(page, 200, 100)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test('right-click paints with the secondary colour, X swaps colours', async () => {
  const { page } = h;
  await page.keyboard.press('b');
  expect(await tool()).toBe('brush');
  // Pick red as primary from the palette.
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await drag(page, [
    [100, 200],
    [300, 200],
  ]);
  const red = await pixel(page, 200, 200);
  expect(red.r).toBeGreaterThan(200);
  expect(red.g).toBeLessThan(60);
  await page.keyboard.press('x');
  await drag(page, [
    [100, 300],
    [300, 300],
  ]);
  // Primary is now white: drawing white on white paper.
  expect(await pixel(page, 200, 300)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await drag(page, [[100, 400], [300, 400]], 'right');
  expect((await pixel(page, 200, 400)).r).toBeGreaterThan(200);
});

test('fills a region and erases to the paper', async () => {
  const { page } = h;
  await page.keyboard.press('r');
  expect(await tool()).toBe('rect');
  await drag(page, [
    [50, 50],
    [250, 200],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('shape');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBeNull();
  // Outline (3 px default) is black.
  expect(await pixel(page, 51, 120)).toEqual({ r: 0, g: 0, b: 0, a: 255 });

  await page.keyboard.press('f');
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  await clickDoc(page, 150, 120);
  await expect.poll(async () => (await pixel(page, 150, 120)).b).toBeGreaterThan(200);
  expect(await pixel(page, 400, 400)).toEqual({ r: 255, g: 255, b: 255, a: 255 });

  await page.keyboard.press('e');
  await drag(page, [
    [100, 120],
    [200, 120],
  ]);
  // The eraser reveals the white paper.
  expect(await pixel(page, 150, 120)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
});

test('shape tools stay editable until committed', async () => {
  const { page } = h;
  await page.keyboard.press('o');
  await drag(page, [
    [100, 100],
    [200, 200],
  ]);
  // Drag the body to move the live ellipse, then press Escape to discard it.
  await drag(page, [
    [150, 150],
    [350, 350],
  ]);
  await page.keyboard.press('Escape');
  expect((await hist()).length).toBe(0);
  expect(await pixel(page, 300, 351)).toEqual({ r: 255, g: 255, b: 255, a: 255 });

  await page.keyboard.press('l');
  await drag(page, [
    [10, 500],
    [600, 500],
  ]);
  await page.keyboard.press('p');
  expect((await hist()).length).toBe(1);
  expect((await pixel(page, 300, 500)).a).toBe(255);
  expect((await pixel(page, 300, 500)).r).toBeLessThan(40);
});

test('selects, moves and deletes a region', async () => {
  const { page } = h;
  await page.keyboard.press('r');
  await page.getByRole('combobox').count();
  // Filled black square via the options bar style.
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #000000/ }).click({ button: 'right' });
  await drag(page, [
    [20, 20],
    [60, 60],
  ]);
  await page.keyboard.press('Enter');
  expect(await pixel(page, 40, 40)).toEqual({ r: 0, g: 0, b: 0, a: 255 });

  await page.keyboard.press('s');
  await drag(page, [
    [10, 10],
    [70, 70],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.selection())).toEqual({ x: 10, y: 10, w: 60, h: 60 });
  await drag(page, [
    [40, 40],
    [240, 240],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('float');
  await page.keyboard.press('Escape');
  // The square moved by (200, 200); the original spot shows the paper.
  expect(await pixel(page, 240, 240)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  expect(await pixel(page, 40, 40)).toEqual({ r: 255, g: 255, b: 255, a: 255 });

  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await pixel(page, 240, 240)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 240, 240)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
});

test('image operations resize, rotate and crop', async () => {
  const { page } = h;
  const doc = () => page.evaluate(() => window.__pigmentoTest!.doc());
  expect(await doc()).toEqual({ width: 1280, height: 800 });
  await page.getByRole('tab', { name: 'Image' }).click();
  await page.getByRole('button', { name: 'Rotate right 90°' }).click();
  expect(await doc()).toEqual({ width: 800, height: 1280 });
  await page.keyboard.press('Control+z');
  expect(await doc()).toEqual({ width: 1280, height: 800 });

  await page.keyboard.press('Control+w');
  const dlg = page.getByRole('dialog', { name: 'Resize and skew' });
  await expect(dlg).toBeVisible();
  const width = dlg.getByRole('textbox', { name: 'Width' });
  await width.fill('50');
  await width.press('Tab');
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await doc()).toEqual({ width: 640, height: 400 });

  await page.keyboard.press('s');
  await drag(page, [
    [0, 0],
    [100, 50],
  ]);
  await page.keyboard.press('Control+Shift+x');
  expect(await doc()).toEqual({ width: 100, height: 50 });
  await page.keyboard.press('Control+z');
  expect(await doc()).toEqual({ width: 640, height: 400 });
});

test('dialogs close with Escape and keyboard shortcuts open them', async () => {
  const { page } = h;
  await page.keyboard.press('Control+e');
  await expect(page.getByRole('dialog', { name: 'Image properties' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Control+n');
  const dlg = page.getByRole('dialog', { name: 'New image' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('textbox', { name: 'Width' }).fill('320');
  await dlg.getByRole('textbox', { name: 'Height' }).fill('240');
  await dlg.getByRole('textbox', { name: 'Height' }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 320, height: 240 });
});
