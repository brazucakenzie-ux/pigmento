import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { drag, launchApp, pixel, ready, relaunch, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
});

async function stubSaveDialog(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: fp })) as typeof dialog.showSaveDialog;
  }, file);
}

/** Two layers in a group (one multiply, one hidden) plus paint on the base layer. */
async function buildLayeredImage(): Promise<void> {
  const { page } = h;
  await page.keyboard.press('r');
  await page.getByRole('radio', { name: 'Fill', exact: true }).click();
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  await page.keyboard.press('x');
  await drag(page, [
    [0, 0],
    [400, 300],
  ]);
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    const a = t.addLayer();
    t.fillLayer(a, { r: 255, g: 200, b: 0, a: 255 });
    t.setLayerProps(a, { blend: 'multiply', opacity: 0.5, name: 'Sun' });
    const b = t.addLayer();
    t.fillLayer(b, { r: 255, g: 0, b: 0, a: 255 });
    t.setLayerProps(b, { visible: false, name: 'Hidden' });
    t.groupLayers([a, b]);
  });
}

const summary = () =>
  h.page.evaluate(() => {
    const walk = (n: { name: string; kind: string; blend: string; opacity: number; visible: boolean; children: unknown[] }[]): string[] =>
      n.flatMap((l) => [`${l.kind}:${l.name}:${l.blend}:${l.opacity}:${l.visible}`, ...walk(l.children as never)]);
    return walk(window.__pigmentoTest!.layers().tree as never);
  });

test('saves a layered project and reopens it intact', async () => {
  h = await launchApp();
  await ready(h.page);
  await buildLayeredImage();
  const before = await summary();
  const px = await pixel(h.page, 100, 100);
  const file = tempFile('artwork.pigm');
  await stubSaveDialog(file);
  // Ctrl+S on a layered, never-saved image defaults to the project format (no prompt).
  await h.page.keyboard.press('Control+s');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect([...readFileSync(file).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  await expect(h.page.locator('.topbar .dirty')).toHaveCount(0);

  await h.page.keyboard.press('Control+n');
  await h.page.getByRole('dialog', { name: 'New image' }).getByRole('button', { name: 'Create' }).click();
  expect(await h.page.evaluate((p) => window.__pigmentoTest!.openPath(p), file)).toBe(true);
  expect(await summary()).toEqual(before);
  expect(await pixel(h.page, 100, 100)).toEqual(px);
  await expect(h.page.locator('.layer-row', { hasText: 'Sun' })).toBeVisible();
});

test('warns that PNG merges layers and keeps the document unsaved', async () => {
  h = await launchApp();
  await ready(h.page);
  await buildLayeredImage();
  const file = tempFile('flat.png');
  await stubSaveDialog(file);
  await h.page.getByRole('button', { name: 'File' }).click();
  await h.page.getByRole('menuitem', { name: 'Save as…' }).hover();
  await h.page.getByRole('menuitem', { name: 'Save as PNG…' }).click();
  const dlg = h.page.getByRole('dialog');
  await expect(dlg).toContainText('layers will be merged');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => existsSync(file)).toBe(true);
  // The PNG can't hold the layers, so closing would still ask to save.
  await expect(h.page.locator('.topbar .dirty')).toBeVisible();
});

test('recovers unsaved work after a crash', async () => {
  h = await launchApp();
  await ready(h.page);
  await buildLayeredImage();
  const before = await summary();
  expect(await h.page.evaluate(() => window.__pigmentoTest!.autosaveNow())).toBe(true);
  // Simulate a crash of the whole app (main process and its Chromium helpers).
  const pid = h.app.process().pid;
  if (pid) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
  await h.app.waitForEvent('close').catch(() => undefined);
  h = await relaunch(h, 10);
  const { page } = h;
  await ready(page);
  const dlg = page.getByRole('dialog', { name: 'Recover unsaved work' });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('Untitled');
  await dlg.getByRole('button', { name: 'Restore' }).click();
  await expect(dlg).toBeHidden();
  expect(await summary()).toEqual(before);
  // Restored work is unsaved until the user saves it.
  await expect(page.locator('.topbar .dirty')).toBeVisible();
});
