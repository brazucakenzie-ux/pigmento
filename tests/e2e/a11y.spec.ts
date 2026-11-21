import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { clickDoc, drag, launchApp, ready, type AppHandle } from './harness';

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
  test.setTimeout(300_000);
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const findings: Finding[] = [];
  const ribbon = page.locator('.ribbon');
  // An animation to look at: a piece with keyframes (selected, with the Animate tool) and a
  // layer drawn frame by frame, so the timeline shows every kind of row.
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 30, g: 30, b: 30, a: 255 }, { x: 100, y: 100, w: 60, h: 60 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 60, 60));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await ribbon.getByRole('button', { name: 'Animate selection' }).click();
  const pieceId = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 8, { x: 400 }), pieceId);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(4));
  await ribbon.getByRole('button', { name: 'New drawing' }).click();
  await page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'Onion skin' }).click();
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
    findings.push(...(await audit(page, `${label} · Timeline`, '.timeline')), ...(await audit(page, `${label} · Animate tool options`, '.optionsbar')));
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
      ...(await auditDialog(page, `${label} · Export animation (GIF)`, async () => {
        await page.getByRole('tab', { name: 'Animate' }).click();
        await ribbon.getByRole('button', { name: 'Export', exact: true }).click();
        await page.getByRole('dialog', { name: 'Export animation' }).getByRole('radio', { name: 'Animated GIF' }).click();
      })),
      ...(await auditDialog(page, `${label} · Export animation (MP4)`, async () => {
        await page.getByRole('tab', { name: 'Animate' }).click();
        await ribbon.getByRole('button', { name: 'Export', exact: true }).click();
        await page.getByRole('dialog', { name: 'Export animation' }).getByRole('radio', { name: 'MP4 video' }).click();
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

test('the 3D, hinge, box and camera controls meet WCAG 2.1 AA in light, dark and high-contrast themes', async () => {
  test.setTimeout(300_000);
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const findings: Finding[] = [];
  const ribbon = page.locator('.ribbon');
  // A box (its group, a face following the group, hinged faces) and a camera move on the timeline.
  await page.getByRole('tab', { name: 'Animate' }).click();
  await ribbon.getByRole('button', { name: 'Box…' }).click();
  await page.getByRole('dialog', { name: 'Make a box' }).getByRole('button', { name: 'Make' }).click();
  const ids = Object.fromEntries((await page.evaluate(() => window.__pigmentoTest!.anim().pieces)).map((p) => [p.name, p.id]));
  await page.evaluate(() => window.__pigmentoTest!.selectCamera());
  await page.evaluate(() => window.__pigmentoTest!.setFrame(6));
  const pan = page.locator('.optionsbar').getByRole('textbox', { name: 'Pan X', exact: true });
  await pan.fill('40');
  await pan.press('Enter');
  // Each selection shows its own controls, which are what's audited.
  const options = async (label: string, select: () => Promise<void>, shows: { role: 'textbox' | 'combobox' | 'button'; name: string }) => {
    await select();
    await expect(page.locator('.optionsbar').getByRole(shows.role, { name: shows.name, exact: true })).toBeVisible();
    findings.push(...(await audit(page, label, '.optionsbar')));
  };
  for (const [family, mode] of [
    [null, 'Light'],
    [null, 'Dark'],
    ['High contrast', 'Dark'],
  ] as const) {
    await theme(page, family, mode);
    const label = `${family ?? 'Pigmento'} ${mode}`;
    await page.getByRole('tab', { name: 'Animate' }).click();
    findings.push(...(await audit(page, `${label} · Animate tab`, '.ribbon')), ...(await audit(page, `${label} · Timeline (groups, camera)`, '.timeline')));
    findings.push(...(await auditDialog(page, `${label} · Make a box`, () => ribbon.getByRole('button', { name: 'Box…' }).click())));
    for (const tool of ['m', 'a'] as const) {
      await page.locator('.canvas-host').focus();
      await page.keyboard.press(tool);
      const name = tool === 'm' ? 'Perspective plane' : 'Animate';
      await options(`${label} · ${name} options (group)`, () => page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), ids['Group 1']), { role: 'button', name: 'Centre pivot' });
      await options(`${label} · ${name} options (a face that follows)`, () => page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), ids.Front), { role: 'combobox', name: 'Follows' });
      await options(`${label} · ${name} options (a hinged face)`, () => page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), ids.Right), { role: 'textbox', name: 'Fold' });
      await options(`${label} · ${name} options (camera)`, () => page.evaluate(() => window.__pigmentoTest!.selectCamera()), { role: 'textbox', name: 'Pan X' });
    }
    await page.getByRole('tab', { name: 'Home' }).click();
  }
  for (const f of findings) console.warn(`[a11y] ${f.where} — ${f.rule} (${f.impact}): ${f.help} :: ${f.targets.join(' | ')}`);
  expect(findings.map((f) => `${f.where}: ${f.rule}`)).toEqual([]);
});

test('the path, trim, trail, loop and spin controls meet WCAG 2.1 AA in light, dark and high-contrast themes, and work by keyboard', async () => {
  test.setTimeout(300_000);
  h = await launchApp();
  const { page } = h;
  await ready(page);
  const findings: Finding[] = [];
  const ribbon = page.locator('.ribbon');
  const bar = page.locator('.optionsbar');
  // A piece, keyed, following a path on a shape layer whose outline draws on; a trail, a loop and a spin on the piece.
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 200, g: 40, b: 40, a: 255 }, { x: 100, y: 60, w: 80, h: 40 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 60, 80, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  const pieceId = await page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
  await page.evaluate((id) => window.__pigmentoTest!.setPieceKey(id, 10, { x: 500 }), pieceId);
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await clickDoc(page, 200, 600);
  await drag(page, [
    [600, 400],
    [700, 400],
    [800, 400],
  ]);
  await clickDoc(page, 1000, 600);
  await page.keyboard.press('Enter');
  await page.keyboard.press('a');
  await bar.getByRole('combobox', { name: 'Path' }).selectOption({ index: 1 });
  await bar.getByRole('checkbox', { name: 'Face its way' }).check();
  await bar.getByRole('combobox', { name: 'Loop', exact: true }).selectOption({ label: 'Back and forth' });
  await bar.locator('.opt-pop-btn', { hasText: 'Trail' }).click();
  await page.getByRole('dialog', { name: 'Trail' }).getByRole('button', { name: 'Add a trail' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Trail' })).toBeHidden();
  await bar.locator('.opt-pop-btn', { hasText: 'Spin' }).click();
  const speed = page.getByRole('dialog', { name: 'Spin' }).getByRole('textbox', { name: 'Spin', exact: true });
  await speed.fill('0.5');
  await speed.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Spin' })).toBeHidden();
  // The path's outline drawn on (its trim keyed, so it gets a timeline row).
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('v');
  await page.evaluate(() => {
    const t = window.__pigmentoTest!;
    const shapes = t.layers().tree.find((l) => l.kind === 'vector')!.id;
    t.setActiveLayer(shapes);
    t.setVectorSelection([(t.vectorObjects(shapes) as { id: string }[])[0].id]);
  });
  await bar.getByRole('button', { name: 'Draw on…' }).click();
  await page.getByRole('dialog', { name: 'Draw on' }).getByRole('button', { name: 'Key it' }).click();
  // A layer drawn twice, looping Cycle.
  await page.evaluate(() => window.__pigmentoTest!.addLayer());
  const cloth = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  if (!(await page.locator('.tl-names').isVisible())) await ribbon.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 30, g: 150, b: 60, a: 255 }, { x: 600, y: 100, w: 60, h: 60 }), cloth);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  await ribbon.getByRole('button', { name: 'New drawing' }).click();
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 30, g: 150, b: 60, a: 255 }, { x: 700, y: 100, w: 60, h: 60 }), cloth);
  await ribbon.getByRole('combobox', { name: 'Loop drawings' }).selectOption({ label: 'Cycle' });
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline.locator('.tl-spin-row')).toHaveCount(1);
  await expect(timeline.locator('.tl-shape-row')).toHaveCount(1);
  await expect(timeline.locator('.tl-cel.repeat').first()).toBeVisible();

  // By keyboard: the cycle's end, the emitter point and the spin speed.
  const loopEnd = timeline.locator('.tl-loop-end');
  await loopEnd.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await page.evaluate(() => window.__pigmentoTest!.anim().celLoops))[cloth].end).toBe(5);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await page.evaluate(() => window.__pigmentoTest!.anim().celLoops))[cloth].end).toBe(4);
  await expect(loopEnd).toHaveAttribute('aria-label', /after frame 4/);
  await page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), pieceId);
  await page.locator('.canvas-host').focus();
  await page.keyboard.press('a');
  await bar.locator('.opt-pop-btn', { hasText: 'Trail' }).click();
  const emitterX = page.getByRole('dialog', { name: 'Trail' }).getByRole('textbox', { name: 'Emitter X', exact: true });
  const x0 = (await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].emitter.x;
  await emitterX.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].emitter.x).toBe(x0 + 11);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Trail' })).toBeHidden();
  await bar.locator('.opt-pop-btn', { hasText: 'Spin' }).click();
  await speed.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await page.evaluate(() => window.__pigmentoTest!.anim().current!.spin))!.spin).toBeCloseTo(0.55, 9);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Spin' })).toBeHidden();
  // The loop settings are plain selects, in the tab order.
  await bar.getByRole('combobox', { name: 'Loop', exact: true }).focus();
  await expect(bar.getByRole('combobox', { name: 'Loop', exact: true })).toBeFocused();

  const popover = async (where: string, button: 'Trail' | 'Spin') => {
    await bar.locator('.opt-pop-btn', { hasText: button }).click();
    await expect(page.getByRole('dialog', { name: button })).toBeVisible();
    await page.waitForTimeout(100);
    findings.push(...(await audit(page, where, `.${button.toLowerCase()}-popover`)));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: button })).toBeHidden();
  };
  for (const [family, mode] of [
    [null, 'Light'],
    [null, 'Dark'],
    ['High contrast', 'Dark'],
  ] as const) {
    await theme(page, family, mode);
    const label = `${family ?? 'Pigmento'} ${mode}`;
    await page.getByRole('tab', { name: 'Animate' }).click();
    findings.push(...(await audit(page, `${label} · Animate tab (loop drawings)`, '.ribbon')), ...(await audit(page, `${label} · Timeline (loops, spin, trim)`, '.timeline')));
    for (const tool of ['a', 'm'] as const) {
      await page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), pieceId);
      await page.locator('.canvas-host').focus();
      await page.keyboard.press(tool);
      const name = tool === 'm' ? 'Perspective plane' : 'Animate';
      await expect(bar.locator('.opt-pop-btn', { hasText: 'Spin' })).toBeVisible();
      findings.push(...(await audit(page, `${label} · ${name} options (path, face, loop)`, '.optionsbar')));
      await popover(`${label} · ${name} · Trail popover`, 'Trail');
      await popover(`${label} · ${name} · Spin popover`, 'Spin');
    }
    await page.locator('.canvas-host').focus();
    await page.keyboard.press('v');
    await page.evaluate(() => {
      const t = window.__pigmentoTest!;
      const shapes = t.layers().tree.find((l) => l.kind === 'vector')!.id;
      t.setActiveLayer(shapes);
      t.setVectorSelection([(t.vectorObjects(shapes) as { id: string }[])[0].id]);
    });
    await expect(bar.getByRole('button', { name: 'Draw on…' })).toBeVisible();
    findings.push(...(await audit(page, `${label} · Trim options`, '.optionsbar')));
    findings.push(...(await auditDialog(page, `${label} · Draw on`, () => bar.getByRole('button', { name: 'Draw on…' }).click())));
    await page.getByRole('tab', { name: 'Home' }).click();
  }
  for (const f of findings) console.warn(`[a11y] ${f.where} — ${f.rule} (${f.impact}): ${f.help} :: ${f.targets.join(' | ')}`);
  expect(findings.map((f) => `${f.where}: ${f.rule}`)).toEqual([]);
});
