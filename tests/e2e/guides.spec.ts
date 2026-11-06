import { expect, test, type Page } from '@playwright/test';
import { docToScreen, drag, launchApp, ready, type AppHandle } from './harness';

let h: AppHandle;

test.afterEach(async () => {
  if (!h) return;
  expect(h.errors).toEqual([]);
  await h.close();
  h = undefined as unknown as AppHandle;
});

const guides = (page: Page) => page.evaluate(() => window.__pigmentoTest!.guides());
const historyLabels = (page: Page) => page.locator('.history-list li').allInnerTexts();

test('drags guides out of the rulers, moves them with any tool, and drops them back to delete', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.keyboard.press('Control+r');
  await expect(page.locator('.ruler.top')).toBeVisible();
  await page.keyboard.press('p'); // pencil: guides still win when grabbed

  // Out of the top ruler: a horizontal guide.
  const ruler = (await page.locator('.ruler.top').boundingBox())!;
  const target = await docToScreen(page, 500, 200);
  await page.mouse.move(target.x, ruler.y + ruler.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await page.mouse.up();
  expect(await guides(page)).toEqual([{ axis: 'y', pos: 200 }]);
  // Out of the left ruler: a vertical one.
  const left = (await page.locator('.ruler.left').boundingBox())!;
  const t2 = await docToScreen(page, 300, 500);
  await page.mouse.move(left.x + left.width / 2, t2.y);
  await page.mouse.down();
  await page.mouse.move(t2.x, t2.y, { steps: 6 });
  await page.mouse.up();
  expect(await guides(page)).toEqual([
    { axis: 'y', pos: 200 },
    { axis: 'x', pos: 300 },
  ]);

  // Ctrl+drag the horizontal guide on the canvas to move it; the pencil draws nothing.
  await page.keyboard.down('Control');
  await drag(page, [
    [700, 200],
    [700, 320],
  ]);
  await page.keyboard.up('Control');
  expect((await guides(page))[0]).toEqual({ axis: 'y', pos: 320 });
  expect(await historyLabels(page)).toEqual(['New image', 'Add guide', 'Add guide', 'Move guide']);
  await page.keyboard.press('Control+z');
  expect((await guides(page))[0]).toEqual({ axis: 'y', pos: 200 });
  await page.keyboard.press('Control+y');

  // Dragging a guide back onto its ruler removes it.
  const g = await docToScreen(page, 700, 320);
  await page.mouse.move(g.x, g.y);
  await expect(page.locator('.statusbar')).toContainText('Ctrl+drag to move this guide');
  await page.keyboard.down('Control');
  await page.mouse.down();
  await page.mouse.move(g.x, ruler.y + ruler.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  expect(await guides(page)).toEqual([{ axis: 'x', pos: 300 }]);

  // Without Ctrl the pencil draws right across a guide.
  await drag(page, [
    [300, 600],
    [300, 700],
  ]);
  expect((await historyLabels(page)).at(-1)).toBe('Pencil');
  // Locked guides can't be moved even with Ctrl.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Lock guides' }).click();
  await page.keyboard.down('Control');
  await drag(page, [
    [300, 600],
    [400, 600],
  ]);
  await page.keyboard.up('Control');
  expect(await guides(page)).toEqual([{ axis: 'x', pos: 300 }]);
  // Clear guides (Snapping menu).
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitem', { name: 'Clear guides' }).click();
  expect(await guides(page)).toEqual([]);
});

test('snaps to guides, and shows alignment lines when a moving selection centres on the canvas', async () => {
  h = await launchApp();
  await ready(h.page);
  const { page } = h;
  await page.evaluate(() => window.__pigmentoTest!.addGuide('x', 300));
  await page.keyboard.press('s');
  // Starting 4 px from the guide snaps the corner onto it.
  await drag(page, [
    [296, 100],
    [400, 200],
  ]);
  expect((await page.evaluate(() => window.__pigmentoTest!.selection()))!.x).toBe(300);

  await page.evaluate(() => {
    const k = window.__pigmentoTest!;
    k.fillLayer(k.layers().activeId, { r: 30, g: 136, b: 229, a: 255 }, { x: 100, y: 500, w: 100, h: 100 });
    k.selectRect(100, 500, 100, 100);
  });
  // Drag the block so its centre lands 3 px left of the canvas centre (x 640).
  const a = await docToScreen(page, 150, 550);
  const b = await docToScreen(page, 637, 550);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  const lines = await page.evaluate(() => window.__pigmentoTest!.snapLines());
  expect(lines).toContainEqual(expect.objectContaining({ axis: 'x', pos: 640, kind: 'canvas' }));
  await page.mouse.up();
  expect(await page.evaluate(() => window.__pigmentoTest!.snapLines())).toEqual([]);
  expect(await page.evaluate(() => window.__pigmentoTest!.liveKind())).toBe('float');
  await page.keyboard.press('Enter');
  const px = (x: number, y: number) => page.evaluate(([dx, dy]) => window.__pigmentoTest!.pixel(dx, dy), [x, y] as const);
  expect((await px(590, 550)).b).toBe(229);
  expect((await px(589, 550)).b).toBe(255);
  expect((await px(689, 550)).b).toBe(229);

  // With snapping off, the same drag lands exactly where the pointer goes.
  await page.getByRole('tab', { name: 'View' }).click();
  await page.getByRole('button', { name: 'Snapping' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Snap', exact: true }).click();
  await page.keyboard.press('s');
  await drag(page, [
    [296, 100],
    [400, 200],
  ]);
  expect((await page.evaluate(() => window.__pigmentoTest!.selection()))!.x).toBe(296);
});
