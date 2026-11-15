import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { clickDoc, drag, launchApp, ready } from './harness';

// Captures screenshots of key UI states for visual review (not an assertion test).
test('capture UI states', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('button', { name: 'Rulers' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();

    await page.keyboard.press('b');
    await page.getByRole('button', { name: /Colour #4B4BE0/ }).click();
    await drag(page, [
      [200, 300],
      [300, 250],
      [420, 320],
      [520, 260],
    ]);
    await page.keyboard.press('o');
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await page.getByRole('button', { name: /Colour #FFC914/ }).click({ button: 'right' });
    await drag(page, [
      [700, 150],
      [950, 400],
    ]);
    await shot('light-live-shape');
    await page.keyboard.press('Enter');

    await page.keyboard.press('t');
    await drag(page, [
      [120, 520],
      [400, 600],
    ]);
    await page.keyboard.type('Hello Pigmento!\nSecond line');
    await shot('text-editing');
    await page.keyboard.press('Escape');

    await page.keyboard.press('s');
    await drag(page, [
      [180, 220],
      [560, 360],
    ]);
    await drag(page, [
      [300, 300],
      [360, 420],
    ]);
    await shot('floating-selection');
    await page.keyboard.press('Escape');

    // Selection modes: an ellipse added to a rectangle, then a hole subtracted.
    await drag(page, [
      [600, 450],
      [900, 650],
    ]);
    await page.keyboard.press('s');
    await page.keyboard.down('Shift');
    await drag(page, [
      [820, 400],
      [1050, 600],
    ]);
    await page.keyboard.up('Shift');
    await page.keyboard.down('Alt');
    await drag(page, [
      [650, 500],
      [720, 560],
    ]);
    await page.keyboard.up('Alt');
    await shot('selection-modes');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Modify selection' }).hover();
    await page.waitForTimeout(250);
    await shot('select-menu');
    await page.getByRole('menuitem', { name: 'Feather…' }).click();
    await page.waitForTimeout(200);
    await shot('feather-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Colour range…' }).click();
    await page.waitForTimeout(300);
    await shot('color-range-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Save selection…' }).click();
    await page.keyboard.press('Enter');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Select', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Load selection…' }).click();
    await page.waitForTimeout(200);
    await shot('load-selection-dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+d');

    // Free transform of the whole layer, with some perspective.
    await page.keyboard.press('Control+t');
    await page.getByRole('radio', { name: 'Perspective' }).click();
    const c = await page.evaluate(() => window.__pigmentoTest!.transformCorners());
    await drag(page, [
      [c![0].x, c![0].y],
      [c![0].x + 120, c![0].y],
    ]);
    await page.mouse.move(700, 700);
    await page.waitForTimeout(150);
    await shot('free-transform');
    await page.keyboard.press('Escape');

    // Gradient: a live radial gradient with its options, then the editor.
    await page.keyboard.press('g');
    await page.getByRole('radio', { name: 'Radial' }).click();
    await drag(page, [
      [900, 600],
      [1150, 760],
    ]);
    await page.mouse.move(700, 700);
    await page.waitForTimeout(150);
    await shot('gradient-live');
    await page.getByRole('button', { name: /^Colours:/ }).click();
    await page.getByRole('dialog', { name: 'Edit gradient' }).getByRole('button', { name: 'Dusk' }).click();
    await page.waitForTimeout(200);
    await shot('gradient-dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await page.getByRole('radio', { name: 'Pattern', exact: true }).click();
    await page.getByRole('button', { name: /^Pattern: / }).click();
    await page.waitForTimeout(200);
    await shot('pattern-picker');
    await page.keyboard.press('Escape');
    await page.getByRole('radio', { name: 'Colour', exact: true }).click();

    // Guides, and a smart alignment line while moving a selection onto the canvas centre.
    await page.evaluate(() => {
      const k = window.__pigmentoTest!;
      k.addGuide('x', 200);
      k.addGuide('y', 150);
      k.selectRect(120, 360, 160, 120);
    });
    await page.keyboard.press('s');
    await page.getByRole('tab', { name: 'View' }).click();
    const from = await page.evaluate(() => window.__pigmentoTest!.docToScreen(200, 420));
    const to = await page.evaluate(() => window.__pigmentoTest!.docToScreen(636, 420));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.waitForTimeout(150);
    await shot('guides-smart');
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Home' }).click();

    // Shape layer: two editable shapes, selected with Move.
    await page.keyboard.press('r');
    await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await drag(page, [
      [620, 560],
      [820, 700],
    ]);
    await page.keyboard.press('Enter');
    await shot('shape-tool-options');
    await page.keyboard.press('o');
    await drag(page, [
      [860, 560],
      [1000, 700],
    ]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('v');
    await page.evaluate(() => {
      const k = window.__pigmentoTest!;
      k.setVectorSelection((k.vectorObjects() ?? []).map((o) => o.id));
    });
    await page.waitForTimeout(150);
    await shot('move-shapes');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'File' }).click();
    await page.waitForTimeout(250);
    await shot('file-menu');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Edit colours' }).last().click();
    await page.waitForTimeout(250);
    await shot('edit-colors');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'Image' }).click();
    await page.keyboard.press('Control+w');
    await page.waitForTimeout(250);
    await shot('resize-dialog');
    await page.keyboard.press('Escape');
    await page.locator('.rb-split', { has: page.getByRole('button', { name: 'Crop', exact: true }) }).locator('[aria-haspopup="menu"]').click();
    await page.waitForTimeout(200);
    await shot('image-tab');
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.__pigmentoTest!.addLayer());
    await page.keyboard.press('Control+Alt+Shift+S');
    await page.getByRole('radio', { name: '2×' }).click();
    await page.getByRole('radio', { name: 'Selected layer' }).click();
    await page.waitForTimeout(250);
    await shot('export-dialog');
    await page.getByLabel('Format').selectOption('jpeg');
    await page.waitForTimeout(150);
    await shot('export-dialog-jpeg');
    await page.keyboard.press('Escape');

    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'High contrast' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.waitForTimeout(150);
    await shot('contrast-view-tab');
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Pigmento' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await shot('dark-zoomed');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

// The Shapes tab, the full gallery and library shapes on the canvas (light and dark).
test('capture shape library', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('tab', { name: 'Shapes' }).click();
    const gallery = page.getByRole('listbox', { name: 'Shape gallery' });
    const names = ['5-point star', 'Heart', 'Right arrow', 'Speech bubble', 'Decision', 'Gear', 'Ribbon banner', 'Left brace', 'Flower', 'Cloud', 'Lightning bolt', 'Cube'];
    await page.getByRole('button', { name: /Colour #4B4BE0/ }).click();
    await page.getByRole('button', { name: /Colour #FFC914/ }).click({ button: 'right' });
    for (let i = 0; i < names.length; i++) {
      await gallery.getByRole('option', { name: names[i], exact: true }).click();
      if (i === 0) await page.getByRole('radio', { name: 'Outline and fill' }).click();
      const x = 60 + (i % 6) * 190;
      const y = 60 + Math.floor(i / 6) * 220;
      await drag(page, [
        [x, y],
        [x + 160, y + 170],
      ]);
      if (i < names.length - 1) await page.keyboard.press('Enter');
    }
    await shot('shapes-tab');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Show all shapes' }).click();
    await page.waitForTimeout(200);
    await shot('shapes-menu');
    await page.keyboard.press('Escape');
    await gallery.getByRole('option', { name: 'Right arrow', exact: true }).click();
    await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
    await drag(page, [
      [300, 560],
      [700, 700],
    ]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('v');
    await clickDoc(page, 500, 630);
    await page.waitForTimeout(150);
    await shot('shapes-move');
    await page.getByRole('combobox', { name: 'Category' }).selectOption('callouts');
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('tab', { name: 'Shapes' }).click();
    await page.waitForTimeout(150);
    await shot('shapes-tab-dark');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

// Fill and outline styles: gradient, pattern and dashed shapes, arrowheads and the popovers.
test('capture shape styles', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const popover = (name: 'Fill' | 'Outline') => page.locator('.opt-pop-btn', { hasText: name });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.getByRole('button', { name: /Colour #4B4BE0/ }).click();
    await page.getByRole('button', { name: /Colour #FFC914/ }).click({ button: 'right' });
    await page.keyboard.press('r');
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await popover('Fill').click();
    await page.getByRole('dialog', { name: 'Fill' }).getByRole('radio', { name: 'Gradient' }).click();
    await page.waitForTimeout(150);
    await shot('style-fill-popover');
    await page.keyboard.press('Escape');
    await drag(page, [
      [80, 80],
      [380, 300],
    ]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('o');
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await popover('Fill').click();
    await page.getByRole('dialog', { name: 'Fill' }).getByRole('radio', { name: 'Pattern' }).click();
    await page.keyboard.press('Escape');
    await popover('Outline').click();
    await page.getByRole('dialog', { name: 'Outline' }).getByRole('radio', { name: 'Dashes' }).click();
    await page.waitForTimeout(150);
    await shot('style-outline-popover');
    await page.keyboard.press('Escape');
    await drag(page, [
      [460, 80],
      [760, 300],
    ]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('l');
    await page.getByRole('button', { name: '8', exact: true }).click();
    await popover('Outline').click();
    const ol = page.getByRole('dialog', { name: 'Outline' });
    await ol.getByRole('radiogroup', { name: 'End' }).getByRole('radio', { name: 'Arrow' }).click();
    await ol.getByRole('radiogroup', { name: 'Start' }).getByRole('radio', { name: 'Dot' }).click();
    await ol.getByRole('radio', { name: 'Gradient' }).click();
    await page.keyboard.press('Escape');
    await drag(page, [
      [100, 420],
      [700, 560],
    ]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    await shot('style-canvas');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

// The Pen: a path being edited (points, handles, options bar) and the Save as my shape dialog.
test('capture pen and my shapes', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  const at = async (x: number, y: number) => {
    const s = await page.evaluate(([dx, dy]) => window.__pigmentoTest!.docToScreen(dx, dy), [x, y] as const);
    await page.mouse.click(s.x, s.y);
  };
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('tab', { name: 'Shapes' }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).click();
    await page.getByRole('radio', { name: 'Outline and fill' }).click();
    await at(150, 400);
    await drag(page, [
      [350, 150],
      [450, 150],
    ]);
    await at(550, 400);
    await at(350, 330);
    await at(150, 400);
    await page.waitForTimeout(150);
    await shot('pen-editing');
    await page.locator('.ribbon').getByRole('button', { name: 'Save as my shape…' }).click();
    await page.waitForTimeout(200);
    await shot('pen-save-dialog');
    await page.getByRole('dialog', { name: 'Save as my shape' }).getByRole('button', { name: 'Save' }).click();
    await page.getByRole('combobox', { name: 'Category' }).selectOption('custom');
    await page.waitForTimeout(200);
    await shot('pen-my-shapes');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

// An imported palette bigger than the ribbon, its popover, and the Edit colours dialog.
test('capture palettes', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    const rows = Array.from({ length: 40 }, (_, i) => `${(i * 37) % 256} ${(i * 91) % 256} ${(i * 53) % 256}\tC${i}`).join('\n');
    const file = path.join(out, 'shot.gpl');
    writeFileSync(file, `GIMP Palette\nName: Shot\n${rows}\n`);
    await h.app.evaluate(({ dialog }, fp) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [fp] })) as typeof dialog.showOpenDialog;
    }, file);
    await page.getByRole('button', { name: 'Edit colours' }).click();
    await page.getByRole('dialog', { name: 'Edit colours' }).getByRole('button', { name: 'Import palette…' }).click();
    await page.waitForTimeout(300);
    await shot('palette-dialog');
    await page.getByRole('dialog', { name: 'Edit colours' }).getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'All 40 palette colours' }).click();
    await page.waitForTimeout(200);
    await shot('palette-more');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

// Brushes: symmetry axes and strokes, the options bar with the Symmetry popover.
test('capture brushes', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'View' }).click();
    await page.getByRole('button', { name: 'Light' }).click();
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.getByRole('button', { name: /Colour #4B4BE0/ }).click();
    await page.keyboard.press('b');
    await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
    await page.getByRole('dialog', { name: 'Symmetry' }).getByRole('radio', { name: 'Radial' }).click();
    await page.waitForTimeout(150);
    await shot('brush-symmetry-popover');
    await page.keyboard.press('Escape');
    await drag(page, [
      [640, 250],
      [700, 300],
      [680, 360],
      [760, 330],
    ]);
    await page.mouse.move(900, 700);
    await page.waitForTimeout(150);
    await shot('brush-symmetry');
    await page.locator('.opt-pop-btn', { hasText: 'Symmetry' }).click();
    await page.getByRole('dialog', { name: 'Symmetry' }).getByRole('radio', { name: 'Off' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await page.keyboard.press('b');
    // A row of strokes, each with a different brush at its own size.
    const names = ['Oil', 'Watercolour', 'Chalk', 'Charcoal', 'Crayon', 'Calligraphy', 'Ink pen', 'Graphite pencil', 'Marker', 'Highlighter', 'Airbrush', 'Spray can', 'Splatter', 'Grass', 'Stars', 'Sparkles', 'Fur', 'Leaves', 'Confetti', 'Sponge', 'Soft pastel', 'Canvas', 'Dither (ordered)', 'Pixel round'];
    for (let i = 0; i < names.length; i++) {
      await page.locator('.brush-pick').click();
      await page.getByRole('dialog', { name: 'Brushes' }).getByRole('option', { name: names[i], exact: true }).click();
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 30 + col * 310;
      const y = 50 + row * 125;
      await drag(page, [
        [x, y + 40],
        [x + 80, y],
        [x + 160, y + 60],
        [x + 260, y + 20],
      ]);
    }
    await page.mouse.move(1300, 850);
    await shot('brush-strokes');
    await page.locator('.brush-pick').click();
    await page.waitForTimeout(300);
    await shot('brush-picker');
    await page.keyboard.press('Escape');
    // The Retouch tools, and a smudge across the first row of strokes.
    await page.locator('.ribbon').getByRole('button', { name: 'Retouch' }).click();
    await page.waitForTimeout(150);
    await shot('retouch-menu');
    await page.getByRole('menu', { name: 'Retouch' }).locator('[role^="menuitem"]', { hasText: 'Smudge' }).click();
    await drag(page, [
      [60, 30],
      [80, 80],
      [100, 130],
    ]);
    await drag(page, [
      [380, 30],
      [400, 80],
      [420, 130],
    ]);
    await page.mouse.move(700, 600);
    await page.waitForTimeout(150);
    await shot('retouch-smudge');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

test('capture brush designer', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.getByRole('tab', { name: 'Brushes' }).click();
    await page.waitForTimeout(150);
    await shot('brushes-tab');
    await page.locator('.ribbon').getByRole('button', { name: 'New brush…' }).click();
    const dlg = page.getByRole('dialog', { name: 'New brush' });
    await dlg.getByRole('radio', { name: 'Charcoal' }).click();
    await page.waitForTimeout(150);
    await shot('designer-tip');
    await dlg.getByRole('button', { name: 'Draw a tip' }).click();
    const grid = dlg.getByRole('img', { name: 'Tip drawing grid' });
    const b = (await grid.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.8, b.y + b.height * 0.2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    await shot('designer-draw');
    await dlg.getByRole('tab', { name: 'Grain' }).click();
    await dlg.getByRole('radio', { name: 'Canvas' }).click();
    await page.waitForTimeout(150);
    await shot('designer-texture');
    await dlg.getByRole('tab', { name: 'Dynamics' }).click();
    await dlg.getByRole('combobox', { name: 'Controlled by' }).selectOption('pressure');
    await dlg.getByRole('button', { name: 'S-curve' }).click();
    await page.waitForTimeout(150);
    await shot('designer-dynamics');
    await dlg.getByRole('tab', { name: 'Stroke' }).click();
    await page.waitForTimeout(150);
    await shot('designer-stroke');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

test('capture effects', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  const shot = (name: string) => page.screenshot({ path: path.join(out, `${name}.png`) });
  try {
    await ready(page);
    await page.evaluate(() => {
      const t = window.__pigmentoTest!;
      t.fillLayer(t.layers().activeId, { r: 40, g: 110, b: 200, a: 255 }, { x: 200, y: 150, w: 600, h: 400 });
      t.fillLayer(t.layers().activeId, { r: 255, g: 140, b: 60, a: 255 }, { x: 450, y: 300, w: 300, h: 200 });
    });
    await page.getByRole('tab', { name: 'Effects' }).click();
    await page.locator('.ribbon').getByRole('button', { name: 'Curves…' }).click();
    await page.waitForTimeout(600);
    await shot('effects-curves');
    await page.keyboard.press('Escape');
    await page.locator('.ribbon').getByRole('button', { name: 'Drop shadow…' }).click();
    await page.waitForTimeout(800);
    await shot('effects-shadow');
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

test('capture turned view', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  try {
    await ready(page);
    await page.evaluate(() => {
      const t = window.__pigmentoTest!;
      t.fillLayer(t.layers().activeId, { r: 40, g: 110, b: 200, a: 255 }, { x: 100, y: 100, w: 500, h: 300 });
      t.addGuide('x', 640);
      t.selectRect(700, 200, 300, 200);
    });
    await page.getByRole('tab', { name: 'View' }).click();
    for (let i = 0; i < 2; i++) await page.locator('.ribbon').getByRole('button', { name: 'Right 15°' }).click();
    await page.locator('.ribbon').getByRole('button', { name: 'Turn view' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, 'view-turned.png') });
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});

test('capture settings', async () => {
  test.skip(!process.env.PIGMENTO_SCREENSHOT, 'Set PIGMENTO_SCREENSHOT=1 to capture screenshots');
  const out = process.env.PIGMENTO_SCREENSHOT_DIR ?? path.resolve('test-results');
  const h = await launchApp();
  const { page } = h;
  try {
    await ready(page);
    await page.keyboard.press('Control+Alt+s');
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    await dlg.getByRole('tab', { name: 'Keyboard shortcuts' }).click();
    await dlg.getByRole('group', { name: 'Pencil', exact: true }).getByRole('button', { name: 'Add a shortcut for Pencil' }).click();
    await page.keyboard.press('b');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, 'settings-shortcuts.png') });
    console.warn('errors:', JSON.stringify(h.errors));
  } finally {
    await h.close();
  }
});
