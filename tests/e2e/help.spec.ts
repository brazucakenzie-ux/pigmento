import { expect, test } from '@playwright/test';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

test('Help has the user guide, shortcuts, the tour and About with every licence', async () => {
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const help = page.getByRole('button', { name: 'Help' });
  await help.click();
  const menu = page.getByRole('menu', { name: 'Help' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    /User guide/,
    /Keyboard shortcuts/,
    /Welcome tour/,
    /About Pigmento/,
  ]);

  // The guide, with its contents beside it.
  await menu.getByRole('menuitem', { name: /User guide/ }).click();
  const guide = page.getByRole('dialog', { name: 'User guide' });
  const contents = guide.getByRole('navigation', { name: 'Contents' });
  await expect(contents.getByRole('button', { name: 'Installing' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await contents.getByRole('button', { name: 'Brushes' }).click();
  await expect(contents.getByRole('button', { name: 'Brushes' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(guide.getByRole('heading', { name: 'Making your own brushes' })).toBeInViewport();
  await expect(guide.getByRole('table').first()).toContainText('Pencil');
  await page.keyboard.press('Escape');

  // About lists the third-party licences.
  await help.click();
  await page.getByRole('menuitem', { name: /About Pigmento/ }).click();
  const about = page.getByRole('dialog', { name: 'About Pigmento' });
  const licences = about.getByRole('region', { name: 'Third-party licences' });
  await expect(about).toContainText('Free and open-source software under the MIT licence.');
  await expect(licences.getByRole('heading', { name: 'Pigmento licence' })).toBeVisible();
  await expect(licences).toContainText('Copyright (c) 2026 brazucakenzie');
  await expect(licences.getByRole('row', { name: /Electron/ })).toContainText('MIT');
  await expect(licences.getByRole('row', { name: /^Inter/ })).toContainText(
    'SIL Open Font License 1.1',
  );
  await expect(about).toContainText(/Version \d+\.\d+\.\d+/);
});
