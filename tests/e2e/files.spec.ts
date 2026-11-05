import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { drag, launchApp, pixel, ready, tempFile, type AppHandle } from './harness';

/** Make the next native Save dialog return `file` (dialogs can't be driven by tests). */
async function stubSaveDialog(h: AppHandle, file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
}

async function stubMessageBox(h: AppHandle, response: number): Promise<void> {
  await h.app.evaluate(({ dialog }, r) => {
    (globalThis as unknown as Record<string, unknown>).__pigmentoPrompts = 0;
    dialog.showMessageBox = (async () => {
      (globalThis as unknown as Record<string, number>).__pigmentoPrompts++;
      return { response: r, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

async function drawRedLine(h: AppHandle): Promise<void> {
  await h.page.keyboard.press('p');
  await h.page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await drag(h.page, [
    [10, 10],
    [110, 10],
  ]);
}

test('saves a PNG, reopens it and keeps the pixels', async () => {
  const h = await launchApp();
  try {
    await ready(h.page);
    await drawRedLine(h);
    await expect(h.page.locator('.topbar .dirty')).toBeVisible();
    const file = tempFile('drawing.png');
    await stubSaveDialog(h, file);
    await h.page.keyboard.press('Control+s');
    await expect.poll(() => existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await expect(h.page.locator('.topbar .dirty')).toHaveCount(0);
    await expect(h.page.locator('.topbar .title')).toHaveText('drawing.png');
    // The file is now in the recent list and the Windows jump list.
    await expect.poll(() => h.page.evaluate(() => window.pigmento.recent.list().then((l) => l.map((r) => r.path)))).toEqual([file]);
    await expect
      .poll(() => h.app.evaluate(() => (globalThis as unknown as { __pigmentoJumpList?: unknown }).__pigmentoJumpList))
      .toEqual({ result: 'ok', items: 1 });

    // New blank image, then reopen the saved file.
    await h.page.keyboard.press('Control+n');
    await h.page.getByRole('dialog', { name: 'New image' }).getByRole('button', { name: 'Create' }).click();
    expect(await pixel(h.page, 50, 10)).toEqual({ r: 255, g: 255, b: 255, a: 255 });
    const ok = await h.page.evaluate((p) => window.__pigmentoTest!.openPath(p), file);
    expect(ok).toBe(true);
    const px = await pixel(h.page, 50, 10);
    expect(px).toEqual({ r: 0xd7, g: 0x26, b: 0x3d, a: 255 });
    expect(await h.page.evaluate(() => window.__pigmentoTest!.history())).toEqual({ index: 0, length: 0, dirty: false });
    expect(h.errors).toEqual([]);
  } finally {
    await h.close();
  }
});

for (const format of ['jpg', 'bmp', 'gif', 'webp'] as const) {
  test(`saves and reopens ${format.toUpperCase()}`, async () => {
    const h = await launchApp();
    try {
      await ready(h.page);
      await h.page.keyboard.press('r');
      await h.page.getByRole('radio', { name: 'Fill', exact: true }).click();
      await h.page.getByRole('button', { name: /Colour #1E88E5/ }).click({ button: 'right' });
      await drag(h.page, [
        [0, 0],
        [200, 200],
      ]);
      await h.page.keyboard.press('Enter');
      const file = tempFile(`picture.${format}`);
      await stubSaveDialog(h, file);
      await h.page.keyboard.press('Control+Shift+s');
      if (format === 'jpg' || format === 'webp') {
        const dlg = h.page.getByRole('dialog');
        await expect(dlg).toBeVisible();
        await dlg.getByRole('button', { name: 'Save' }).click();
      }
      await expect.poll(() => existsSync(file) && statSync(file).size > 0).toBe(true);
      const ok = await h.page.evaluate((p) => window.__pigmentoTest!.openPath(p), file);
      expect(ok).toBe(true);
      const p = await pixel(h.page, 100, 100);
      // Lossy formats may shift colours slightly.
      expect(Math.abs(p.r - 0x1e)).toBeLessThan(12);
      expect(Math.abs(p.g - 0x88)).toBeLessThan(12);
      expect(Math.abs(p.b - 0xe5)).toBeLessThan(12);
      expect(h.errors).toEqual([]);
    } finally {
      await h.close();
    }
  });
}

test('opens a file passed on the command line ("Open with")', async () => {
  // Make a file first.
  const first = await launchApp();
  const file = tempFile('launch.png');
  try {
    await ready(first.page);
    await drawRedLine(first);
    await stubSaveDialog(first, file);
    await first.page.keyboard.press('Control+s');
    await expect.poll(() => existsSync(file)).toBe(true);
  } finally {
    await first.close();
  }
  const h = await launchApp([file]);
  try {
    await ready(h.page);
    await expect.poll(() => h.page.evaluate(() => window.__pigmentoTest!.filePath())).toBe(file);
    expect(await pixel(h.page, 50, 10)).toEqual({ r: 0xd7, g: 0x26, b: 0x3d, a: 255 });
    await expect(h.page).toHaveTitle(/launch\.png - Pigmento/);
  } finally {
    await h.close();
  }
});

test('asks to save unsaved changes before closing', async () => {
  const h = await launchApp();
  try {
    await ready(h.page);
    await drawRedLine(h);
    const clickX = () => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    // "Cancel" keeps the window open.
    await stubMessageBox(h, 2);
    await clickX();
    await expect.poll(() => h.app.evaluate(() => (globalThis as unknown as Record<string, number>).__pigmentoPrompts)).toBe(1);
    expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    // A stray window.close() from the page must not discard the work either.
    await h.page.evaluate(() => window.close());
    await h.page.waitForTimeout(300);
    expect(await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    // File > Close window goes through the same check; "Don't save" closes.
    await stubMessageBox(h, 1);
    const closed = h.app.waitForEvent('close');
    await h.page.getByRole('button', { name: 'File' }).click();
    await h.page.getByRole('menuitem', { name: 'Close window' }).click();
    await closed;
    expect(await h.app.evaluate(() => (globalThis as unknown as Record<string, number>).__pigmentoPrompts).catch(() => 1)).toBe(1);
  } finally {
    await h.close();
  }
});
