import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { clickDoc, drag, launchApp, pixel, ready, relaunch, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const RED = { r: 215, g: 38, b: 61, a: 255 };
const WHITE = { r: 255, g: 255, b: 255, a: 255 };

interface BrushFile {
  id: string;
  name: string;
  category: string;
  settings: { tip: { kind: string; id?: string }; size: number; texture: { id: string } | null; dynamics: Record<string, { source: string; min: number }> };
  tip: { w: number; h: number } | null;
  texture: { w: number; h: number } | null;
}

/** The personal brushes on disk, oldest first. */
function brushFiles(): BrushFile[] {
  let names: string[];
  try {
    names = readdirSync(path.join(h.userData, 'brushes'));
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(path.join(h.userData, 'brushes', n), 'utf8')) as BrushFile & { createdAt: number })
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function stubOpen(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
}

/** Type into a dialog's number box and leave it (Enter would submit the dialog). */
async function setNumber(page: Page, scope: ReturnType<Page['getByRole']>, name: string, v: number): Promise<void> {
  const box = scope.getByRole('textbox', { name, exact: true });
  await box.fill(String(v));
  await box.press('Tab');
}

test('makes a brush from the selection, paints with its tip, and keeps it after a restart', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  // A solid square to make the tip from.
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    t.fillLayer(t.layers().activeId, { r: 0, g: 0, b: 0, a: 255 }, { x: 100, y: 100, w: 40, h: 40 });
    t.selectRect(90, 90, 60, 60);
  });

  await page.getByRole('tab', { name: 'Brushes' }).click();
  // Built-in brushes can't be edited, only used as a starting point.
  await expect(page.locator('.ribbon').getByRole('button', { name: 'Edit brush…' })).toBeDisabled();
  await page.locator('.ribbon').getByRole('button', { name: 'New brush…' }).click();
  const dlg = page.getByRole('dialog', { name: 'New brush' });
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Block');
  await dlg.getByRole('button', { name: 'From selection' }).click();
  await expect(dlg.getByRole('radio', { name: 'This brush’s own tip' })).toHaveAttribute('aria-checked', 'true');
  await setNumber(page, dlg, 'Size', 20);
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast', { hasText: 'Saved “Block” to My brushes.' })).toBeVisible();
  // It's picked for the Brush, size and all.
  expect(await page.evaluate(() => window.__pigmentoTest!.tool())).toBe('brush');
  await expect(page.locator('.brush-pick')).toContainText('Block');
  await expect(page.locator('.optionsbar').getByRole('textbox', { name: 'Size' })).toHaveValue('20');

  const [file] = brushFiles();
  expect(file.name).toBe('Block');
  expect(file.category).toBe('custom');
  expect(file.settings.tip).toEqual({ kind: 'image', id: 'own' });
  expect(file.tip).toMatchObject({ w: 40, h: 40 });

  // One dab: a square, so its corner paints where a round tip wouldn't.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await clickDoc(page, 600, 600);
  expect(await pixel(page, 600, 600)).toEqual(RED);
  expect(await pixel(page, 608, 608)).toEqual(RED);
  expect(await pixel(page, 614, 600)).toEqual(WHITE);

  // Still there after a restart, tip and all (once the Brush's choice is saved).
  const savedBrush = () => {
    try {
      const s = JSON.parse(readFileSync(path.join(h.userData, 'settings.json'), 'utf8')) as { tools?: Record<string, { brushId?: string }> };
      return s.tools?.brush?.brushId;
    } catch {
      return undefined;
    }
  };
  await expect.poll(savedBrush, { timeout: 10000 }).toBe(file.id);
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  h = await relaunch(h);
  await ready(h.page);
  await h.page.keyboard.press('b');
  await expect(h.page.locator('.brush-pick')).toContainText('Block');
  await h.page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await clickDoc(h.page, 300, 300);
  expect(await pixel(h.page, 308, 308)).toEqual(RED);
});

test('designs a brush with a drawn tip, grain and pen dynamics, then edits, duplicates and deletes it', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.keyboard.press('b');

  // From the options bar's brush library.
  await page.locator('.brush-pick').click();
  await page.getByRole('dialog', { name: 'Brushes' }).getByRole('button', { name: 'New brush…' }).click();
  const dlg = page.getByRole('dialog', { name: 'New brush' });
  await dlg.getByRole('textbox', { name: 'Name' }).fill('Scribble');

  // A drawn tip: an empty grid can't be saved.
  await dlg.getByRole('button', { name: 'Draw a tip' }).click();
  await dlg.getByRole('button', { name: 'Clear' }).click();
  await expect(dlg.getByText('Draw something on the grid for the tip.')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Save' })).toBeDisabled();
  const grid = dlg.getByRole('img', { name: 'Tip drawing grid' });
  const b = (await grid.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(dlg.getByRole('button', { name: 'Save' })).toBeEnabled();

  // Paper grain, and opacity following pen pressure.
  await dlg.getByRole('tab', { name: 'Grain' }).click();
  await dlg.getByRole('radio', { name: 'Paper' }).click();
  await dlg.getByRole('tab', { name: 'Dynamics' }).click();
  await dlg.getByRole('button', { name: /^Opacity/ }).click();
  await dlg.getByRole('combobox', { name: 'Controlled by' }).selectOption('pressure');
  await setNumber(page, dlg, 'Lowest', 20);
  await dlg.getByRole('button', { name: 'Firm' }).click();
  await expect(dlg.getByRole('button', { name: /^Opacity/ })).toContainText('Pen pressure');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.brush-pick')).toContainText('Scribble');

  let files = brushFiles();
  expect(files).toHaveLength(1);
  const id = files[0].id;
  expect(files[0].tip).toMatchObject({ w: 48, h: 48 });
  expect(files[0].settings.texture?.id).toBe('paper');
  expect(files[0].settings.dynamics.opacity).toMatchObject({ source: 'pressure', min: 0.2 });

  // It paints.
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await drag(page, [
    [200, 300],
    [500, 300],
  ]);
  expect((await pixel(page, 350, 300)).g).toBeLessThan(200);

  // Edit: renamed in place (same brush, same file).
  await page.getByRole('tab', { name: 'Brushes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Edit brush…' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit brush' });
  await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Scribble');
  await expect(edit.getByRole('radio', { name: 'This brush’s own tip' })).toHaveAttribute('aria-checked', 'true');
  await edit.getByRole('textbox', { name: 'Name' }).fill('Scribble 2');
  await edit.getByRole('textbox', { name: 'Name' }).press('Enter');
  await expect(page.locator('.toast', { hasText: 'Updated “Scribble 2”.' })).toBeVisible();
  files = brushFiles();
  expect(files.map((f) => [f.id, f.name])).toEqual([[id, 'Scribble 2']]);

  // Duplicate, then delete the copy: the Brush goes back to its usual brush.
  await page.locator('.ribbon').getByRole('button', { name: 'Duplicate brush' }).click();
  await expect(page.locator('.brush-pick')).toContainText('Scribble 2 copy');
  await expect.poll(() => brushFiles().length).toBe(2);
  await page.locator('.ribbon').getByRole('button', { name: 'Delete brush…' }).click();
  const del = page.getByRole('dialog', { name: 'Delete brush' });
  await expect(del).toContainText('“Scribble 2 copy” will be removed from My brushes.');
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => brushFiles().map((f) => f.name)).toEqual(['Scribble 2']);
  await expect(page.locator('.brush-pick')).toContainText('Round');

  // My brushes lists what's left.
  await page.locator('.brush-pick').click();
  const lib = page.getByRole('dialog', { name: 'Brushes' });
  await lib.getByRole('combobox', { name: 'Category' }).selectOption('custom');
  await expect(lib.getByRole('listbox', { name: 'Brushes' }).getByRole('option')).toHaveCount(1);
  await expect(lib.getByRole('option', { name: 'Scribble 2' })).toBeVisible();
});

test('imports a PNG as a tip (its alpha) and as a grain texture', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  // A soft dot on transparency, and stripes, made as PNGs by the browser.
  const pngs = await page.evaluate(async () => {
    const png = async (w: number, hh: number, draw: (c: OffscreenCanvasRenderingContext2D) => void) => {
      const c = new OffscreenCanvas(w, hh);
      draw(c.getContext('2d')!);
      return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
    };
    return {
      dot: await png(64, 64, (c) => {
        c.fillStyle = '#ffffff';
        c.beginPath();
        c.arc(32, 32, 20, 0, Math.PI * 2);
        c.fill();
      }),
      stripes: await png(16, 16, (c) => {
        c.fillStyle = '#000000';
        c.fillRect(0, 0, 16, 16);
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, 8, 16);
      }),
    };
  });
  const dot = tempFile('dot.png');
  writeFileSync(dot, Buffer.from(pngs.dot));
  const stripes = tempFile('stripes.png');
  writeFileSync(stripes, Buffer.from(pngs.stripes));
  const bad = tempFile('bad.png');
  writeFileSync(bad, 'not a png');

  await page.getByRole('tab', { name: 'Brushes' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'New brush…' }).click();
  const dlg = page.getByRole('dialog', { name: 'New brush' });
  await stubOpen(bad);
  await dlg.getByRole('button', { name: 'Import PNG…' }).click();
  await expect(dlg.getByRole('status')).toHaveText('Pigmento couldn’t read bad.png as a PNG.');
  // A white dot on transparency still makes a tip: its alpha is what counts.
  await stubOpen(dot);
  await dlg.getByRole('button', { name: 'Import PNG…' }).click();
  await expect(dlg.getByRole('radio', { name: 'This brush’s own tip' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByRole('status')).toHaveCount(0);
  await dlg.getByRole('tab', { name: 'Grain' }).click();
  await stubOpen(stripes);
  await dlg.getByRole('button', { name: 'Import PNG…' }).click();
  await expect(dlg.getByRole('radio', { name: 'This brush’s own grain' })).toHaveAttribute('aria-checked', 'true');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast', { hasText: 'to My brushes.' })).toBeVisible();

  const [file] = brushFiles();
  // Cropped to the dot (about 40 px across) and kept square.
  expect(file.tip!.w).toBe(file.tip!.h);
  expect(file.tip!.w).toBeGreaterThanOrEqual(38);
  expect(file.tip!.w).toBeLessThanOrEqual(44);
  expect(file.settings.texture?.id).toBe('own');
  expect(file.texture).toMatchObject({ w: 16, h: 16 });
});

test('exports My brushes as a pack and imports it into another profile', async () => {
  h = await launchApp();
  let page = h.page;
  await ready(page);
  await page.getByRole('tab', { name: 'Brushes' }).click();
  const files = page.locator('.ribbon').getByRole('button', { name: 'Brush packs' });
  // Nothing to export yet.
  await files.click();
  await expect(page.getByRole('menuitem', { name: 'Export my brushes…' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // One brush with a drawn tip, one with a built-in tip.
  const make = async (name: string, tip: 'draw' | string) => {
    await page.locator('.ribbon').getByRole('button', { name: 'New brush…' }).click();
    const dlg = page.getByRole('dialog', { name: 'New brush' });
    await dlg.getByRole('textbox', { name: 'Name' }).fill(name);
    if (tip === 'draw') await dlg.getByRole('button', { name: 'Draw a tip' }).click();
    else await dlg.getByRole('radio', { name: tip }).click();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.toast', { hasText: `Saved “${name}” to My brushes.` })).toBeVisible();
  };
  await make('Disc', 'draw');
  await make('Chalky', 'Chalk');

  const out = tempFile('mine.pigmbrush');
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, out);
  await files.click();
  await page.getByRole('menuitem', { name: 'Export my brushes…' }).click();
  await expect(page.locator('.toast', { hasText: 'Saved My brushes to mine.pigmbrush (brushes: 2).' })).toBeVisible();
  const zip = readFileSync(out);
  expect([zip[0], zip[1]]).toEqual([0x50, 0x4b]);

  // Another PC (a fresh profile): a broken file is refused, the pack is added.
  await h.close();
  h = await launchApp();
  page = h.page;
  await ready(page);
  await page.getByRole('tab', { name: 'Brushes' }).click();
  const bad = tempFile('bad.pigmbrush');
  writeFileSync(bad, 'nope');
  await stubOpen(bad);
  await page.locator('.ribbon').getByRole('button', { name: 'Brush packs' }).click();
  await page.getByRole('menuitem', { name: 'Import brush pack…' }).click();
  await expect(page.locator('.toast', { hasText: 'bad.pigmbrush isn’t a Pigmento brush pack.' })).toBeVisible();
  await stubOpen(out);
  await page.locator('.ribbon').getByRole('button', { name: 'Brush packs' }).click();
  await page.getByRole('menuitem', { name: 'Import brush pack…' }).click();
  await expect(page.locator('.toast', { hasText: 'Brushes added to My brushes: 2.' })).toBeVisible();
  await expect.poll(() => brushFiles().map((f) => f.name)).toEqual(['Disc', 'Chalky']);
  const [disc, chalky] = brushFiles();
  expect(disc.tip).toMatchObject({ w: 48, h: 48 });
  expect(chalky.settings.tip).toEqual({ kind: 'image', id: 'chalk' });
  expect(chalky.tip).toBeNull();

  // The first one is ready to paint with.
  await expect(page.locator('.brush-pick')).toContainText('Disc');
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await drag(page, [
    [200, 300],
    [500, 300],
  ]);
  expect(await pixel(page, 350, 300)).toEqual(RED);
});
