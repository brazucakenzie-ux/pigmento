import { expect, test, type Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { clickDoc, drag, launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };
type Px = { r: number; g: number; b: number; a: number };
const near = (a: Px, b: Px, tol = 24) => Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol && Math.abs(a.a - b.a) <= tol;
const objects = async (page: Page) => (await page.evaluate(() => window.__pigmentoTest!.vectorObjects())) ?? [];

/** Primary red, secondary blue, snapping off. */
async function setup(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.getByRole('tab', { name: 'Home' }).click();
}

/** Open the Fill or Outline popover, run `fn` in it, then close it. */
async function inPopover(page: Page, name: 'Fill' | 'Outline', fn: (pop: ReturnType<Page['getByRole']>) => Promise<void>): Promise<void> {
  await page.locator('.opt-pop-btn', { hasText: name }).click();
  const pop = page.getByRole('dialog', { name });
  await expect(pop).toBeVisible();
  await fn(pop);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
}

/** A solid-colour PNG (w×h), for picking as a picture fill. */
function solidPng(w: number, h: number, c: Px): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let v = n;
    for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (b: Buffer) => {
    let v = 0xffffffff;
    for (const x of b) v = crcTable[(v ^ x) & 0xff] ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rows.set([c.r, c.g, c.b, c.a], y * (w * 4 + 1) + 1 + x * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('fills shapes with gradients, patterns and pictures', async () => {
  h = await launchApp();
  const { page, app } = h;
  await ready(page);
  await setup(page);

  // Gradient (outline colour → fill colour, left to right).
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await inPopover(page, 'Fill', async (pop) => {
    await pop.getByRole('radio', { name: 'Gradient' }).click();
  });
  await expect(page.locator('.opt-pop-btn', { hasText: 'Fill' })).toContainText('Gradient');
  await drag(page, [
    [100, 100],
    [300, 200],
  ]);
  await page.keyboard.press('Enter');
  expect(near(await pixel(page, 102, 150), RED)).toBe(true);
  expect(near(await pixel(page, 298, 150), BLUE)).toBe(true);
  const mid = await pixel(page, 200, 150);
  expect(near(mid, RED) || near(mid, BLUE)).toBe(false);

  // Pattern: checks in the outline colour on the fill colour, lined up with the image.
  await inPopover(page, 'Fill', async (pop) => {
    await pop.getByRole('radio', { name: 'Pattern' }).click();
  });
  await drag(page, [
    [400, 100],
    [600, 200],
  ]);
  await page.keyboard.press('Enter');
  expect(await pixel(page, 404, 104)).toEqual(RED);
  expect(await pixel(page, 412, 104)).toEqual(BLUE);

  // Picture: chosen from a file, covering the shape.
  const png = tempFile('fill.png');
  writeFileSync(png, solidPng(4, 3, { r: 20, g: 200, b: 90, a: 255 }));
  await app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, png);
  await inPopover(page, 'Fill', async (pop) => {
    await pop.getByRole('radio', { name: 'Picture' }).click();
    await pop.getByRole('button', { name: 'Choose a picture…' }).click();
    await expect(pop.getByRole('button', { name: 'Change picture…' })).toBeVisible();
  });
  await drag(page, [
    [100, 300],
    [300, 400],
  ]);
  await page.keyboard.press('Enter');
  expect(await pixel(page, 200, 350)).toEqual({ r: 20, g: 200, b: 90, a: 255 });
  expect(await pixel(page, 310, 350)).toEqual(WHITE);
});

test('draws dashed outlines and arrowheads', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await setup(page);

  await page.keyboard.press('r');
  await page.getByRole('textbox', { name: 'Line width' }).fill('4');
  await page.getByRole('textbox', { name: 'Line width' }).press('Enter');
  await inPopover(page, 'Outline', async (pop) => {
    await pop.getByRole('radio', { name: 'Dashes' }).click();
  });
  await drag(page, [
    [100, 100],
    [400, 200],
  ]);
  await page.keyboard.press('Enter');
  // 12 px dashes and 8 px gaps along the top edge (which starts at the corner, inside the box).
  expect(await pixel(page, 108, 102)).toEqual(RED);
  expect(await pixel(page, 118, 102)).toEqual(WHITE);
  expect(await pixel(page, 128, 102)).toEqual(RED);

  await page.keyboard.press('l');
  await page.getByRole('button', { name: '8', exact: true }).click();
  await inPopover(page, 'Outline', async (pop) => {
    await pop.getByRole('radiogroup', { name: 'End' }).getByRole('radio', { name: 'Arrow' }).click();
  });
  await drag(page, [
    [100, 300],
    [500, 300],
  ]);
  await page.keyboard.press('Enter');
  // The head is wider than the 8 px line; the far end of the line has none.
  expect(await pixel(page, 480, 306)).toEqual(RED);
  expect(await pixel(page, 300, 306)).toEqual(WHITE);
  expect(await pixel(page, 110, 306)).toEqual(WHITE);
});

test('restyles shapes with the Move tool and keeps styles in projects', async () => {
  h = await launchApp();
  const { page, app } = h;
  await ready(page);
  await setup(page);

  await page.keyboard.press('o');
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await page.getByRole('radio', { name: 'Outline and fill' }).click();
  await inPopover(page, 'Fill', async (pop) => {
    await pop.getByRole('radio', { name: 'Gradient' }).click();
  });
  await drag(page, [
    [100, 100],
    [300, 260],
  ]);
  await page.keyboard.press('Enter');
  let objs = await objects(page);
  expect(objs[0]).toMatchObject({ style: { fillKind: 'gradient', fillGradient: { type: 'linear', stops: null } } });

  // Selecting shows its style; a change applies to it as one step and undoes.
  await page.keyboard.press('v');
  await clickDoc(page, 200, 180);
  await expect(page.locator('.opt-pop-btn', { hasText: 'Fill' })).toContainText('Gradient');
  await inPopover(page, 'Fill', async (pop) => {
    await pop.getByRole('radio', { name: 'Radial' }).click();
  });
  await inPopover(page, 'Outline', async (pop) => {
    await pop.getByRole('radio', { name: 'Dots' }).click();
  });
  objs = await objects(page);
  expect(objs[0]).toMatchObject({ style: { fillKind: 'gradient', fillGradient: { type: 'radial' }, dash: 'dot' } });
  await page.keyboard.press('Control+z');
  objs = await objects(page);
  expect(objs[0]).toMatchObject({ style: { fillGradient: { type: 'radial' } } });
  expect(objs[0].style?.dash).toBeUndefined();
  // Selecting again changes nothing.
  await clickDoc(page, 600, 600);
  await clickDoc(page, 200, 180);
  expect(await objects(page)).toEqual(objs);

  // Saved and reopened, the shape keeps its style.
  const file = tempFile('styled.pigm');
  await app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
  await page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  await expect(page.locator('.topbar .dirty')).toHaveCount(0);
  const before = await pixel(page, 200, 180);
  await page.keyboard.press('Control+n');
  await page.getByRole('dialog', { name: 'New image' }).getByRole('button', { name: 'Create' }).click();
  expect(await page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  expect(await objects(page)).toEqual(objs);
  expect(await pixel(page, 200, 180)).toEqual(before);
});
