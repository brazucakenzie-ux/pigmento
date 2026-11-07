import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { drag, launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

async function stubOpen(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
  }, file);
}

async function stubSave(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
}

test('imports, exports and resets palettes', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  // A GIMP palette with 30 colours: the ribbon shows 24, the rest are one click away.
  const rows = Array.from({ length: 30 }, (_, i) => `${i * 8} ${51} ${102}\tC${i}`).join('\n');
  const gpl = tempFile('sea.gpl');
  writeFileSync(gpl, `GIMP Palette\nName: Sea\nColumns: 6\n${rows}\n`);
  await stubOpen(gpl);
  await page.getByRole('button', { name: 'Edit colours' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit colours' });
  await dlg.getByRole('button', { name: 'Import palette…' }).click();
  await expect(page.locator('.toast', { hasText: 'colours from sea.gpl (30)' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  const palette = page.getByRole('group', { name: 'Palette', exact: true });
  await expect(palette.getByRole('button', { name: 'Colour #003366' })).toBeVisible();
  await expect(palette.getByRole('button', { name: /Colour #D7263D/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'All 30 palette colours' }).click();
  // The 30th colour (29 × 8 = 232 = e8) is in the popover.
  await page.getByRole('dialog', { name: 'Palette' }).getByRole('button', { name: 'Colour #E83366' }).click();
  await expect(page.locator('.color-chip.primary')).toHaveAttribute('aria-label', /e83366/i);

  // Exported as a Pigmento palette…
  const out = tempFile('mine.json');
  await stubSave(out);
  await page.getByRole('button', { name: 'Edit colours' }).click();
  await dlg.getByRole('button', { name: 'Export palette…' }).click();
  await expect.poll(() => existsSync(out)).toBe(true);
  const json = JSON.parse(readFileSync(out, 'utf8')) as { format: string; colors: string[] };
  expect(json.format).toBe('pigmento-palette');
  expect(json.colors).toHaveLength(30);
  expect(json.colors[1]).toBe('#083366');

  // …and back to Pigmento's colours.
  await dlg.getByRole('button', { name: 'Use Pigmento’s palette' }).click();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await expect(palette.getByRole('button', { name: /Colour #D7263D/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /palette colours$/ })).toHaveCount(0);

  // A file that isn't a palette is refused.
  const bad = tempFile('bad.ase');
  writeFileSync(bad, 'nope');
  await stubOpen(bad);
  await page.getByRole('button', { name: 'Edit colours' }).click();
  await dlg.getByRole('button', { name: 'Import palette…' }).click();
  await expect(page.locator('.toast', { hasText: 'couldn’t read bad.ase as a palette' })).toBeVisible();
});

test('exports the image as SVG with shapes as paths and pixels as PNG', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.keyboard.press('p');
  await drag(page, [
    [50, 50],
    [150, 80],
  ]);
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await drag(page, [
    [200, 100],
    [400, 300],
  ]);
  await page.keyboard.press('Enter');
  const file = tempFile('drawing.svg');
  await stubSave(file);
  await page.locator('.file-tab').click();
  await page.getByRole('menuitem', { name: 'Export as SVG…' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);
  const svg = readFileSync(file, 'utf8');
  expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"');
  expect(svg).toMatch(/<image data-name="Layer 1" x="\d+" y="\d+" width="\d+" height="\d+" href="data:image\/png;base64,iVBOR/);
  expect(svg).toMatch(/<g data-name="Shapes 1"><path d="M[^"]+" fill="none" stroke="#000000" stroke-width="3"/);
  await expect(page.locator('.toast', { hasText: 'Saved drawing.svg.' })).toBeVisible();
});
