import { expect, test, type Page } from '@playwright/test';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
});

async function pickTheme(page: Page, family: string, mode: 'Light' | 'Dark' | 'Match Windows'): Promise<void> {
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: family }).click();
  await page.getByRole('button', { name: mode, exact: true }).click();
}

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

/** Computed colour of the primary button's text and background. */
const primaryButton = (page: Page) =>
  page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'btn primary';
    b.textContent = 'x';
    document.body.appendChild(b);
    const s = getComputedStyle(b);
    const out = { color: s.color, background: s.backgroundColor };
    b.remove();
    return out;
  });

test('switches between theme families and light/dark variants', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await pickTheme(page, 'GitHub', 'Dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'github-dark');
  expect(await cssVar(page, '--bg-ribbon')).toBe('#0d1117');
  await pickTheme(page, 'VS Code', 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'vscode-light');
  expect(await cssVar(page, '--accent')).toBe('#005fb8');
  await pickTheme(page, 'Claude', 'Dark');
  expect(await cssVar(page, '--bg-ribbon')).toBe('#262624');
  await pickTheme(page, 'Pierre', 'Light');
  expect(await cssVar(page, '--accent')).toBe('#009fff');
  // Bright brand blue gets dark text on buttons so labels stay readable.
  const btn = await primaryButton(page);
  expect(btn.background).toBe('rgb(0, 159, 255)');
  expect(btn.color).toBe('rgb(20, 20, 20)');
  await pickTheme(page, 'High contrast', 'Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast-light');
  expect(await cssVar(page, '--text')).toBe('#000000');
});

test('remembers the theme and opens new windows in its colours', async () => {
  h = await launchApp();
  await ready(h.page);
  await pickTheme(h.page, 'Pierre', 'Dark');
  await h.page.waitForTimeout(900); // settings are saved with a short debounce
  // The theme's title-bar colours are saved so the next window opens in them (no flash).
  const settings = await h.page.evaluate(() => window.pigmento.settings.get());
  expect(settings.theme).toBe('pierre');
  expect(settings.themeMode).toBe('dark');
  expect(settings.chrome).toEqual({ bg: '#171717', fg: '#fafafa' });

  const userData = h.userData;
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()));
  await h.app.close().catch(() => undefined);
  const { _electron } = await import('@playwright/test');
  const path = await import('node:path');
  const app = await _electron.launch({
    args: ['.'],
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PIGMENTO_USER_DATA: userData, PIGMENTO_E2E: '1' },
  });
  const page = await app.firstWindow();
  h = { ...h, app, page, errors: [] };
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'pierre-dark');
  const winBg = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor());
  expect(winBg.toLowerCase()).toBe('#171717');
});
