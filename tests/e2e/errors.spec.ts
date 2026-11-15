import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { drag, launchApp, pixel, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  await h.close();
  h = undefined as unknown as AppHandle;
});

const WHITE = { r: 255, g: 255, b: 255, a: 255 };

test('refuses a picture too big for the free memory, in plain words', async () => {
  process.env.PIGMENTO_E2E_FREE_MB = '100';
  try {
    h = await launchApp();
  } finally {
    delete process.env.PIGMENTO_E2E_FREE_MB;
  }
  const { page } = h;
  await ready(page);
  const newImage = async (w: number, hh: number) => {
    await page.keyboard.press('Control+n');
    const dlg = page.getByRole('dialog', { name: 'New image' });
    await dlg.getByRole('textbox', { name: 'Width' }).fill(String(w));
    await dlg.getByRole('textbox', { name: 'Height' }).fill(String(hh));
    await dlg.getByRole('textbox', { name: 'Height' }).press('Tab');
    await dlg.getByRole('button', { name: 'Create' }).click();
  };
  await newImage(6000, 6000);
  await expect(page.locator('.toast', { hasText: 'A 6000 × 6000 picture needs about 0.4 GB of memory, but only 0.1 GB is free.' })).toBeVisible();
  expect(await page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 1280, height: 800 });
  // Small pictures aren't held back.
  await newImage(1000, 1000);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 1000, height: 1000 });
  expect(h.errors).toEqual([]);
});

test('if the interface breaks, it says so, logs it, and reloads with the work offered back', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  await drag(page, [
    [100, 100],
    [400, 100],
  ]);
  expect(await pixel(page, 250, 100)).not.toEqual(WHITE);

  await page.evaluate(() => window.__pigmentoTest!.breakInterface());
  const crash = page.getByRole('alertdialog', { name: 'Something went wrong' });
  await expect(crash).toBeVisible();
  await expect(crash.getByRole('button', { name: 'Save a copy…' })).toBeVisible();
  await expect.poll(() => {
    try {
      return readFileSync(path.join(h.userData, 'logs', 'pigmento.log'), 'utf8');
    } catch {
      return '';
    }
  }).toContain('window: interface: Error: Interface stopped (test)');

  await crash.getByRole('button', { name: 'Reload the window' }).click();
  await ready(page);
  const recover = page.getByRole('dialog', { name: 'Recover unsaved work' });
  await expect(recover).toBeVisible();
  await recover.getByRole('button', { name: 'Restore' }).first().click();
  await expect.poll(() => pixel(page, 250, 100)).not.toEqual(WHITE);
});

test('if the window’s page crashes, it offers to reload, and the work comes back', async () => {
  h = await launchApp();
  const { page, app } = h;
  await ready(page);
  await page.getByRole('button', { name: /Colour #D7263D/ }).click();
  await page.keyboard.press('b');
  await drag(page, [
    [100, 300],
    [400, 300],
  ]);
  expect(await page.evaluate(() => window.__pigmentoTest!.autosaveNow())).toBe(true);
  // Answer the "stopped working" prompt with Reload.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as unknown as typeof dialog.showMessageBox;
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  // Playwright gives up on a crashed page, so the reloaded one is checked through the main process.
  const run = (js: string) => app.evaluate(({ BrowserWindow }, code) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code), js);
  await expect.poll(() => run('document.querySelector("dialog[open]")?.textContent ?? ""').catch(() => ''), { timeout: 20000 }).toContain('Recover unsaved work');
  await run('[...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.trim() === "Restore").click()');
  await expect.poll(() => run('JSON.stringify(window.__pigmentoTest.pixel(250, 300))')).not.toBe(JSON.stringify(WHITE));
  await expect.poll(() => {
    try {
      return readFileSync(path.join(h.userData, 'logs', 'pigmento.log'), 'utf8');
    } catch {
      return '';
    }
  }).toContain('window: The window\'s page stopped');
});
