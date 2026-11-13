import { expect, test, type Page } from '@playwright/test';
import { docToScreen, drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

/** Brush tool, red, 10 px, hard. */
async function brush(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  const size = page.getByRole('textbox', { name: 'Size' });
  await size.fill('10');
  await size.press('Enter');
  const hard = page.getByRole('textbox', { name: 'Hardness' });
  await hard.fill('100');
  await hard.press('Enter');
}

async function symmetry(page: Page, mode: string, segments?: number): Promise<void> {
  await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
  const pop = page.getByRole('dialog', { name: 'Symmetry' });
  await pop.getByRole('radio', { name: mode }).click();
  if (segments !== undefined) {
    const box = pop.getByRole('textbox', { name: 'Segments' });
    await box.fill(String(segments));
    await box.press('Enter');
  }
  await page.keyboard.press('Escape');
}

test('mirrors strokes left–right, four ways and radially, around a movable centre', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await brush(page);
  await symmetry(page, 'Left–right');
  await expect(page.locator('.opt-pop-btn', { hasText: 'Symmetry' })).toContainText('Left–right');
  await drag(page, [
    [100, 100],
    [200, 100],
  ]);
  // The canvas is 1280 wide: the copy runs from 1180 to 1080.
  expect(await pixel(page, 150, 100)).toEqual(RED);
  expect(await pixel(page, 1130, 100)).toEqual(RED);
  expect(await pixel(page, 640, 100)).toEqual(WHITE);
  // One stroke, one undo step for both copies.
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 1130, 100)).toEqual(WHITE);

  // Drag the centre to x = 400; a stroke at 100 now mirrors to 700.
  await drag(page, [
    [640, 400],
    [400, 400],
  ]);
  await drag(page, [
    [100, 200],
    [120, 200],
  ]);
  expect(await pixel(page, 110, 200)).toEqual(RED);
  expect(await pixel(page, 690, 200)).toEqual(RED);
  expect(await pixel(page, 400, 400)).toEqual(WHITE);

  // Back to the middle, four ways: one dab gives four.
  await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
  await page.getByRole('dialog', { name: 'Symmetry' }).getByRole('button', { name: 'Centre on the canvas' }).click();
  await page.keyboard.press('Escape');
  await symmetry(page, 'Four ways');
  const s = await docToScreen(page, 300, 300);
  await page.mouse.click(s.x, s.y);
  for (const [x, y] of [
    [300, 300],
    [980, 300],
    [300, 500],
    [980, 500],
  ]) expect(await pixel(page, x, y)).toEqual(RED);

  // Radial with 3 segments: copies a third of a turn apart around (640, 400).
  await symmetry(page, 'Radial', 3);
  const r = await docToScreen(page, 640, 300);
  await page.mouse.click(r.x, r.y);
  expect(await pixel(page, 640, 300)).toEqual(RED);
  // 100 px above the centre, turned 120°: (640 + 86.6, 400 + 50).
  expect(await pixel(page, 727, 450)).toEqual(RED);
  expect(await pixel(page, 553, 450)).toEqual(RED);
  // Remembered for next time.
  await page.waitForTimeout(900);
  expect((await page.evaluate(() => window.pigmento.settings.get())).drawing).toEqual({ symmetry: 'radial', segments: 3 });
});

test('stabilises strokes and still ends where the pointer is released', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await brush(page);
  const smooth = page.getByRole('textbox', { name: 'Smoothing' });
  await smooth.fill('100');
  await smooth.press('Enter');
  // A short move stays inside the stabiliser's string: nothing is drawn there yet…
  const a = await docToScreen(page, 100, 300);
  const b = await docToScreen(page, 130, 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  const live = await page.evaluate(([x, y]) => window.__pigmentoTest!.screenPixel(x, y), [b.x, b.y] as const);
  expect(live.r).toBeGreaterThan(200);
  expect(live.g).toBeGreaterThan(200);
  // …until the pointer is let go: the stroke catches up to it.
  await page.mouse.up();
  expect(await pixel(page, 130, 300)).toEqual(RED);
  expect(await pixel(page, 115, 300)).toEqual(RED);

  // Shift draws a straight line from where the stroke started, ignoring the wobble.
  await smooth.fill('0');
  await smooth.press('Enter');
  const p0 = await docToScreen(page, 100, 500);
  const p1 = await docToScreen(page, 300, 560);
  const p2 = await docToScreen(page, 500, 500);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(p1.x, p1.y, { steps: 4 });
  await page.mouse.move(p2.x, p2.y, { steps: 4 });
  await page.keyboard.up('Shift');
  await page.mouse.up();
  expect(await pixel(page, 300, 500)).toEqual(RED);
  expect(await pixel(page, 300, 560)).toEqual(WHITE);
});

test('retouches with blur, smudge, dodge/burn and the clone stamp, one undo step a stroke', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  // Left half red, right half white.
  await page.evaluate((c) => {
    const t = window.__pigmentoTest!;
    t.fillLayer(t.layers().activeId, c, { x: 0, y: 0, w: 640, h: 800 });
  }, RED);
  const step = () => page.evaluate(() => window.__pigmentoTest!.history().index);
  const size = page.locator('.optionsbar').getByRole('textbox', { name: 'Size' });
  const setSize = async (n: number) => {
    await size.fill(String(n));
    await size.press('Enter');
  };

  // Picked from the Retouch menu among the tools; the button then shows the tool in use.
  await page.locator('.ribbon').getByRole('button', { name: 'Retouch' }).click();
  await page.getByRole('menu', { name: 'Retouch' }).locator('[role^="menuitem"]', { hasText: 'Blur' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('blur');
  await expect(page.locator('.ribbon').getByRole('button', { name: 'Blur' })).toHaveAttribute('aria-pressed', 'true');

  // Blur softens the edge down the middle.
  await setSize(40);
  const before = await step();
  await drag(page, [
    [640, 100],
    [640, 300],
  ]);
  expect(await step()).toBe(before + 1);
  const left = await pixel(page, 638, 200);
  const right = await pixel(page, 641, 200);
  expect(left.g).toBeGreaterThan(RED.g);
  expect(right.g).toBeLessThan(255);
  // Away from the brush the edge stays sharp.
  expect(await pixel(page, 638, 500)).toEqual(RED);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 641, 200)).toEqual(WHITE);

  // Smudge drags red into the white. K moves through Smudge, Blur and Sharpen.
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('k');
    seen.add(await page.evaluate(() => window.__pigmentoTest!.tool()));
    if (seen.size === 3) break;
  }
  expect([...seen].sort()).toEqual(['blur', 'sharpen', 'smudge']);
  while ((await page.evaluate(() => window.__pigmentoTest!.tool())) !== 'smudge') await page.keyboard.press('k');
  await setSize(30);
  await drag(page, [
    [600, 500],
    [660, 500],
    [720, 500],
  ]);
  expect((await pixel(page, 690, 500)).g).toBeLessThan(230);
  expect(await pixel(page, 690, 700)).toEqual(WHITE);

  // Dodge lightens the red, burn darkens it.
  await page.keyboard.press('h');
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('dodgeBurn');
  await drag(page, [
    [200, 600],
    [300, 600],
  ]);
  const dodged = await pixel(page, 250, 600);
  expect(dodged.r).toBeGreaterThan(RED.r);
  expect(dodged.g).toBeGreaterThan(RED.g);
  await page.getByRole('radio', { name: 'Burn (darken)' }).click();
  await drag(page, [
    [200, 700],
    [300, 700],
  ]);
  const burnt = await pixel(page, 250, 700);
  expect(burnt.r).toBeLessThan(RED.r);
  expect(burnt.a).toBe(255);

  // The clone stamp needs a source first…
  await page.keyboard.press('j');
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('clone');
  const n = await step();
  await drag(page, [
    [900, 100],
    [920, 100],
  ]);
  await expect(page.locator('.toast')).toContainText('Alt+click first to choose where to copy from.');
  expect(await step()).toBe(n);
  expect(await pixel(page, 910, 100)).toEqual(WHITE);
  // …then copies red from 600 px to the left onto the white.
  const src = await docToScreen(page, 300, 100);
  await page.keyboard.down('Alt');
  await page.mouse.click(src.x, src.y);
  await page.keyboard.up('Alt');
  await drag(page, [
    [900, 100],
    [920, 100],
  ]);
  expect(await step()).toBe(n + 1);
  const copied = await pixel(page, 910, 100);
  expect(copied.r).toBeGreaterThan(200);
  expect(copied.g).toBeLessThan(80);
  expect(await pixel(page, 910, 200)).toEqual(WHITE);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 910, 100)).toEqual(WHITE);
});

test('picks brushes from the library, with favourites, for the Brush and the Eraser', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  await expect(page.locator('.brush-pick')).toContainText('Round');

  // From the options bar: a brush brings its own size and opacity.
  await page.locator('.brush-pick').click();
  const lib = page.getByRole('dialog', { name: 'Brushes' });
  // The brush tiles (the category list's entries are options too).
  const tiles = lib.getByRole('listbox', { name: 'Brushes' });
  await lib.getByRole('searchbox', { name: 'Search brushes' }).fill('high');
  await expect(tiles.getByRole('option')).toHaveCount(1);
  await tiles.getByRole('option', { name: 'Highlighter' }).click();
  await expect(page.locator('.brush-pick')).toContainText('Highlighter');
  await expect(page.locator('.optionsbar').getByRole('textbox', { name: 'Size' })).toHaveValue('22');
  await expect(page.locator('.optionsbar').getByRole('textbox', { name: 'Opacity' })).toHaveValue('45');
  await drag(page, [
    [100, 100],
    [300, 100],
  ]);
  // A see-through red over white.
  const hl = await pixel(page, 200, 100);
  expect(hl.r).toBeGreaterThan(230);
  expect(hl.g).toBeGreaterThan(120);
  expect(hl.g).toBeLessThan(200);

  // Starred, it shows under Favourites.
  await page.locator('.brush-pick').click();
  await lib.getByRole('searchbox', { name: 'Search brushes' }).fill('');
  await lib.getByRole('button', { name: 'Add to favourites' }).click();
  await lib.getByRole('combobox', { name: 'Category' }).selectOption('favorites');
  await expect(tiles.getByRole('option')).toHaveCount(1);
  await expect(tiles.getByRole('option', { name: 'Highlighter' })).toBeVisible();
  await lib.getByRole('combobox', { name: 'Category' }).selectOption('all');
  await page.keyboard.press('Escape');

  // From the Home tab's Brush menu.
  await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Brush', exact: true }) }).locator('[aria-haspopup="menu"]').click();
  const menu = page.getByRole('menu', { name: 'Brushes' });
  await menu.getByRole('menuitemradio', { name: 'Watercolour' }).click();
  await expect(page.locator('.brush-pick')).toContainText('Watercolour');
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('brush');

  // An eraser brush switches to the Eraser; the Eraser can use any brush.
  await page.locator('.brush-pick').click();
  await lib.getByRole('combobox', { name: 'Category' }).selectOption('eraser');
  await tiles.getByRole('option', { name: 'Soft eraser' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('eraser');
  await expect(page.locator('.brush-pick')).toContainText('Soft eraser');
  await page.locator('.brush-pick').click();
  await lib.getByRole('combobox', { name: 'Category' }).selectOption('all');
  await tiles.getByRole('option', { name: 'Round hard' }).click();
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('eraser');
  await drag(page, [
    [150, 100],
    [250, 100],
  ]);
  expect(await pixel(page, 200, 100)).toEqual(WHITE);
});

test('strokes the selection outline and a shape’s outline with the brush, one undo step each', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await brush(page);
  const hist = () => page.evaluate(() => window.__pigmentoTest!.history().index);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 200, 100));
  const before = await hist();
  await page.getByRole('tab', { name: 'Brushes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Stroke selection outline…' }).click();
  const dlg = page.getByRole('dialog', { name: 'Stroke selection outline' });
  await expect(dlg).toContainText('Paints with the Brush’s brush: Round, 10 px.');
  await dlg.getByRole('checkbox', { name: 'Taper the ends (simulate pen pressure)' }).uncheck();
  await dlg.getByRole('button', { name: 'Stroke' }).click();
  // Along the edge (both sides of it), not inside.
  expect(await pixel(page, 200, 100)).toEqual(RED);
  expect(await pixel(page, 200, 97)).toEqual(RED);
  expect(await pixel(page, 300, 150)).toEqual(RED);
  expect(await pixel(page, 200, 150)).toEqual(WHITE);
  expect(await hist()).toBe(before + 1);
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 200, 100)).toEqual(WHITE);

  // A shape on a shape layer: the stroke goes on a new pixel layer above it.
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  // Filled with the secondary colour (white), so only the brush stroke shows.
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await drag(page, [
    [500, 300],
    [700, 500],
  ]);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    const shape = t.vectorObjects()![0];
    t.setVectorSelection([shape.id]);
  });
  const layersBefore = (await page.evaluate(() => window.__pigmentoTest!.layers())).count;
  await page.getByRole('tab', { name: 'Brushes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Stroke path with brush…' }).click();
  const pathDlg = page.getByRole('dialog', { name: 'Stroke path' });
  await expect(pathDlg).toContainText('new pixel layer');
  await pathDlg.getByRole('button', { name: 'Stroke' }).click();
  const layers = await page.evaluate(() => window.__pigmentoTest!.layers());
  expect(layers.count).toBe(layersBefore + 1);
  expect(await page.evaluate(() => window.__pigmentoTest!.activeLayerKind())).toBe('raster');
  // The left of the ellipse (a little inside its box, past the outline's inset).
  const left = await pixel(page, 501, 400);
  expect(left.r).toBeGreaterThan(150);
  expect(left.g).toBeLessThan(150);
  await page.keyboard.press('Control+z');
  expect((await page.evaluate(() => window.__pigmentoTest!.layers())).count).toBe(layersBefore);
});
