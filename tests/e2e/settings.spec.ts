import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const saved = (): { shortcuts?: Record<string, string[]>; ui?: { scale: number } } => {
  try {
    return JSON.parse(readFileSync(path.join(h.userData, 'settings.json'), 'utf8')) as ReturnType<typeof saved>;
  } catch {
    return {};
  }
};

test('changes the interface size and the keyboard shortcuts, clashes and all', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const tool = () => page.evaluate(() => window.__pigmentoTest!.tool());

  // Ctrl+Alt+S opens Settings; the interface grows at once.
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  await page.keyboard.press('Control+Alt+s');
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  const size = dlg.getByRole('textbox', { name: 'Interface size' });
  await size.fill('120');
  await size.press('Tab');
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(dpr * 1.2, 2);

  // A new key for the Brush.
  await dlg.getByRole('tab', { name: 'Keyboard shortcuts' }).click();
  await dlg.getByRole('searchbox', { name: 'Search commands or keys' }).fill('pen');
  await dlg.getByRole('searchbox', { name: 'Search commands or keys' }).fill('');
  const brush = dlg.getByRole('group', { name: 'Brush', exact: true });
  await brush.getByRole('button', { name: 'Add a shortcut for Brush' }).click();
  await expect(brush).toContainText('Press the keys');
  // Esc stops recording without closing Settings.
  await page.keyboard.press('Escape');
  await expect(dlg).toBeVisible();
  await expect(brush).not.toContainText('Press the keys');
  await brush.getByRole('button', { name: 'Add a shortcut for Brush' }).click();
  await page.keyboard.press('m');
  await expect(brush.locator('kbd')).toHaveText(['B', 'M']);

  // The same key for the Pencil clashes; taking it moves it over.
  const pencil = dlg.getByRole('group', { name: 'Pencil', exact: true });
  await pencil.getByRole('button', { name: 'Add a shortcut for Pencil' }).click();
  await page.keyboard.press('m');
  await expect(dlg.getByRole('alert')).toHaveText(/M is already used by Brush\./);
  await expect(dlg.getByRole('button', { name: 'Share it (switches between them)' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Use it here instead' }).click();
  await expect(pencil.locator('kbd')).toHaveText(['P', 'M']);
  await expect(brush.locator('kbd')).toHaveText(['B']);
  // Keys that keep their meaning can't be taken.
  await pencil.getByRole('button', { name: 'Add a shortcut for Pencil' }).click();
  await page.keyboard.press('Tab');
  await expect(pencil.locator('kbd')).toHaveText(['P', 'M']);
  await page.keyboard.press('Escape');
  await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();

  await page.keyboard.press('b');
  await page.keyboard.press('m');
  expect(await tool()).toBe('pencil');
  await expect.poll(() => saved().shortcuts).toEqual({ 'tool.pencil': ['P', 'M'] });
  // The cheat sheet shows it too.
  await page.keyboard.press('F1');
  const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(sheet.locator('.shortcut-row', { hasText: /^Pencil/ })).toContainText('M');
  await page.keyboard.press('Escape');

  // Remove one, then reset everything.
  await page.keyboard.press('Control+Alt+s');
  await dlg.getByRole('tab', { name: 'Keyboard shortcuts' }).click();
  await pencil.getByRole('button', { name: 'Remove M from Pencil' }).click();
  await expect(pencil.locator('kbd')).toHaveText(['P']);
  await pencil.getByRole('button', { name: 'Remove P from Pencil' }).click();
  await expect(pencil.locator('kbd')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Reset all shortcuts' }).click();
  await expect(pencil.locator('kbd')).toHaveText(['P']);
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  await expect.poll(() => saved().shortcuts).toEqual({});
  await expect.poll(() => saved().ui?.scale).toBe(1.2);
});

test('Simple mode keeps the Paint essentials, and Full brings everything back', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const layersHead = page.locator('.panel-section-head', { hasText: 'Layers' });
  await expect(layersHead).toBeVisible();
  await page.getByRole('tab', { name: 'Effects' }).click();

  await page.getByRole('button', { name: 'Full', exact: true }).click();
  const toggle = page.getByRole('button', { name: 'Simple', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // Only Home, Image and View; the hidden tab falls back to Home.
  await expect(page.getByRole('tab')).toHaveText(['Home', 'Image', 'View']);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');
  await expect(layersHead).toHaveCount(0);
  await expect(page.locator('.ribbon').getByRole('button', { name: 'Retouch' })).toHaveCount(0);
  // Fewer brush options: size stays, the stabiliser and symmetry go.
  await page.keyboard.press('b');
  const bar = page.locator('.optionsbar');
  await expect(bar.getByRole('textbox', { name: 'Size' })).toBeVisible();
  await expect(bar.getByRole('textbox', { name: 'Smoothing' })).toHaveCount(0);
  await expect(bar.locator('.opt-pop-btn', { hasText: 'Symmetry' })).toHaveCount(0);
  await expect.poll(() => saved().ui).toEqual({ scale: 1, mode: 'simple' });

  // Full again, from Settings this time.
  await page.keyboard.press('Control+Alt+s');
  const dlg = page.getByRole('dialog', { name: 'Settings' });
  await dlg.getByRole('radio', { name: 'Full' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab')).toHaveText(['Home', 'Shapes', 'Brushes', 'Effects', 'Image', 'View']);
  await expect(layersHead).toBeVisible();
  await expect(bar.getByRole('textbox', { name: 'Smoothing' })).toBeVisible();
});
