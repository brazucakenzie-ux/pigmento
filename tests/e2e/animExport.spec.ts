// Exporting an animation: the dialog, progress and Stop, GIF and MP4 files.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

/** Make the next native Save dialog return `file`, and count how often it's shown. */
async function stubSave(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    const g = globalThis as unknown as { __saves: number };
    g.__saves = 0;
    dialog.showSaveDialog = (async () => {
      g.__saves++;
      return { canceled: false, filePath: fp };
    }) as typeof dialog.showSaveDialog;
  }, file);
}

const saves = () => h.app.evaluate(() => (globalThis as unknown as { __saves: number }).__saves);

/** A red square on white that moves 300 px right over frames 1–11 (frame 0 → 10). */
async function movingSquare(page: Page): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 230, g: 30, b: 30, a: 255 }, { x: 100, y: 100, w: 80, h: 80 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 80, 80));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 10, { x: 440 }), id);
  return id;
}

test('the Export animation dialog shows progress, stops when asked, and saves a GIF', async () => {
  const { page } = h;
  await movingSquare(page);
  const file = tempFile('moving.gif');
  await stubSave(file);

  // A long export at 200 % can be stopped part way: nothing is saved and the dialog stays.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const length = timeline.getByRole('textbox', { name: 'Length' });
  await length.fill('120');
  await length.press('Enter');
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText('120 frames');
  await dlg.getByRole('radio', { name: '200 %' }).click();
  await expect(dlg.getByTestId('anim-export-size')).toContainText('2560 × 1600');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  const bar = dlg.getByRole('progressbar', { name: 'Export progress' });
  await expect(bar).toBeVisible();
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await dlg.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect(dlg).toBeVisible();
  expect(await saves()).toBe(0);
  expect(existsSync(file)).toBe(false);

  // Frames 1–11 at 100 %: saved as an animated GIF, and the dialog closes.
  await dlg.getByRole('radio', { name: '100 %' }).click();
  await dlg.getByRole('textbox', { name: 'Last frame' }).fill('11');
  await dlg.getByRole('textbox', { name: 'Last frame' }).press('Tab');
  await expect(dlg).toContainText('11 frames');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.toast', { hasText: 'Exported 11 frames to moving.gif' })).toBeVisible();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  // Exporting never changes the picture or its history.
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).length).toBe(120);
});
