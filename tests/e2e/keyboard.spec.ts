import { expect, test, type Page } from '@playwright/test';
import { launchApp, ready, type AppHandle, settle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

/** Which region of the window has the focus (and the focused element's name). */
const focus = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    const region = ['.ribbon', '.optionsbar', '.canvas-host', '.sidepanel', '.statusbar'].find((r) => a?.closest(r));
    return { region: region ?? null, name: a?.getAttribute('aria-label') ?? a?.textContent?.trim().slice(0, 30) ?? '', visible: a?.matches(':focus-visible') ?? false };
  });

test('F6 moves between the regions, and the window works from the keyboard alone', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);

  // F6 forwards through every region and round again; Shift+F6 goes back.
  const order: (string | null)[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('F6');
    const f = await focus(page);
    order.push(f.region);
    expect(f.visible, `focus ring in ${f.region}`).toBe(true);
  }
  expect(order).toEqual(['.ribbon', '.optionsbar', '.canvas-host', '.sidepanel', '.statusbar', '.ribbon']);
  await page.keyboard.press('Shift+F6');
  expect((await focus(page)).region).toBe('.statusbar');

  // In the ribbon, the arrows change tabs.
  await page.keyboard.press('F6');
  expect((await focus(page)).name).toBe('Home');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Shapes' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Shapes' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true');

  // With the canvas focused (and nothing selected), the arrows move around a zoomed picture.
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+=');
  for (let i = 0; i < 2; i++) await page.keyboard.press('F6');
  expect((await focus(page)).region).toBe('.canvas-host');
  await settle(page);
  const before = await page.evaluate(() => window.__pigmentoTest!.docToScreen(0, 0));
  await page.keyboard.press('ArrowRight');
  await settle(page);
  const after = await page.evaluate(() => window.__pigmentoTest!.docToScreen(0, 0));
  expect(before.x - after.x).toBeCloseTo(40, 0);

  // Menus open and run from the keyboard.
  await page.getByRole('button', { name: 'File', exact: true }).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'File' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[role^="menuitem"]:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+Alt+d');
  await expect(page.getByRole('dialog', { name: 'Feather selection' })).toBeVisible();
  await page.keyboard.press('Escape');
});
