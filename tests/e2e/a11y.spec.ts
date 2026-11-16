import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const axeSource = readFileSync(createRequire(__filename).resolve('axe-core/axe.min.js'), 'utf8');

interface Finding {
  where: string;
  rule: string;
  impact: string;
  help: string;
  targets: string[];
}

/** Run axe (WCAG 2.1 A and AA) over the page or one part of it. */
async function audit(page: Page, where: string, include?: string): Promise<Finding[]> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.evaluate(axeSource);
  const found = await page.evaluate(async (sel) => {
    const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const res = await axe.run(sel ? { include: [[sel]] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return res.violations.map((v) => ({ rule: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
  }, include ?? null);
  return found.map((f) => ({ where, ...f }));
}

/** Open a dialog, audit just it, and close it. */
async function auditDialog(page: Page, where: string, open: () => Promise<void>): Promise<Finding[]> {
  await open();
  const dialog = page.locator('dialog[open]').last();
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(150);
  const found = await audit(page, where, 'dialog[open]');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  return found;
}

async function theme(page: Page, family: string | null, mode: 'Light' | 'Dark'): Promise<void> {
  await page.getByRole('tab', { name: 'View' }).click();
  if (family) {
    await page.locator('.ribbon').getByRole('button', { name: /^Theme/ }).click();
    await page.getByRole('menuitemradio', { name: family }).click();
  }
  await page.locator('.ribbon').getByRole('button', { name: mode, exact: true }).click();
  await page.waitForTimeout(150);
}

test('meets WCAG 2.1 AA in every tab and the main dialogs, in light, dark and high-contrast themes', async () => {
  test.setTimeout(240_000);
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const findings: Finding[] = [];
  const ribbon = page.locator('.ribbon');
  for (const [family, mode] of [
    [null, 'Light'],
    [null, 'Dark'],
    ['High contrast', 'Dark'],
  ] as const) {
    await theme(page, family, mode);
    const label = `${family ?? 'Pigmento'} ${mode}`;
    for (const tab of ['Home', 'Shapes', 'Brushes', 'Effects', 'Animate', 'Image', 'View']) {
      await page.getByRole('tab', { name: tab }).click();
      findings.push(...(await audit(page, `${label} · ${tab} tab`)));
    }
    await page.getByRole('tab', { name: 'Home' }).click();
    findings.push(
      ...(await auditDialog(page, `${label} · Settings`, () => page.keyboard.press('Control+Alt+s'))),
      ...(await auditDialog(page, `${label} · Shortcuts settings`, async () => {
        await page.keyboard.press('Control+Alt+s');
        await page.getByRole('tab', { name: 'Keyboard shortcuts' }).click();
      })),
      ...(await auditDialog(page, `${label} · New image`, () => page.keyboard.press('Control+n'))),
      ...(await auditDialog(page, `${label} · Resize`, () => page.keyboard.press('Control+w'))),
      ...(await auditDialog(page, `${label} · Edit colours`, () => ribbon.getByRole('button', { name: 'Edit colours' }).click())),
      ...(await auditDialog(page, `${label} · Keyboard shortcuts`, () => page.keyboard.press('F1'))),
      ...(await auditDialog(page, `${label} · User guide`, async () => {
        await page.getByRole('button', { name: 'Help' }).click();
        await page.getByRole('menuitem', { name: /User guide/ }).click();
      })),
      ...(await auditDialog(page, `${label} · About`, async () => {
        await page.getByRole('button', { name: 'Help' }).click();
        await page.getByRole('menuitem', { name: /About/ }).click();
      })),
      ...(await auditDialog(page, `${label} · Brush Designer`, async () => {
        await page.getByRole('tab', { name: 'Brushes' }).click();
        await ribbon.getByRole('button', { name: 'New brush…' }).click();
      })),
      ...(await auditDialog(page, `${label} · Gaussian blur`, async () => {
        await page.getByRole('tab', { name: 'Effects' }).click();
        await ribbon.getByRole('button', { name: 'Gaussian blur…' }).click();
      })),
    );
    await page.getByRole('tab', { name: 'Home' }).click();
  }
  if (findings.length) {
    // One line per rule and place, for reading in the test output.
    for (const f of findings) console.warn(`[a11y] ${f.where} — ${f.rule} (${f.impact}): ${f.help} :: ${f.targets.join(' | ')}`);
  }
  expect(findings.map((f) => `${f.where}: ${f.rule}`)).toEqual([]);
});
