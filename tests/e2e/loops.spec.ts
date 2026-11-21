// Stop 7D's whole story: cloth on a line drawn twice loops Cycle while a rocket crosses 48 frames, a
// sign swings back and forth and a wind turbine's blade spins forever, fitted to the timeline; saved
// and reopened; exported as a GIF that runs round without a jump.
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

type RGBA = { r: number; g: number; b: number; a: number };
type Box = { x: number; y: number; w: number; h: number };
const RED: RGBA = { r: 220, g: 30, b: 30, a: 255 };
const ORANGE: RGBA = { r: 240, g: 140, b: 20, a: 255 };
const BLUE: RGBA = { r: 20, g: 50, b: 170, a: 255 };
const GREEN: RGBA = { r: 30, g: 150, b: 60, a: 255 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const DEG = Math.PI / 180;
const FRAMES = 48;

// Where things are: the rocket crosses along the bottom, the sign swings about its middle on the
// left, the blade turns about the turbine's hub on the right, and the cloth hangs at the top.
const ROCKET = { x: 40, y: 680, w: 100, h: 30 };
const SIGN = { x: 250, y: 400, w: 120, h: 40 };
const HUB = { x: 900, y: 400 };
const BLADE_R = 110;
const CLOTH_A = { x: 560, y: 140 };
const CLOTH_B = { x: 660, y: 140 };

type Rgb = { r: number; g: number; b: number };
const isRed = (p: Rgb) => p.r > 160 && p.g < 90 && p.b < 90;
const isOrange = (p: Rgb) => p.r > 180 && p.g > 90 && p.g < 190 && p.b < 80;
const isBlue = (p: Rgb) => p.b > 120 && p.r < 90 && p.g < 110;
const isGreen = (p: Rgb) => p.g > 100 && p.r < 90 && p.b < 110;

/** Where the blade's middle is, `turns` round from pointing right (clockwise, as the canvas turns). */
const bladeAt = (turns: number) => ({ x: Math.round(HUB.x + BLADE_R * Math.cos(turns * 2 * Math.PI)), y: Math.round(HUB.y + BLADE_R * Math.sin(turns * 2 * Math.PI)) });
/** The sign's right end at an angle. */
const signEnd = (deg: number) => ({ x: Math.round(310 + 50 * Math.cos(deg * DEG)), y: Math.round(420 + 50 * Math.sin(deg * DEG)) });
/** The rocket's middle at a frame: 1,100 px across 47 frames. */
const rocketAt = (f: number) => ({ x: Math.round(90 + (1100 * f) / 47), y: 695 });
/** The cloth's drawings go A A B B A A B B…: 2 frames each, round and round. */
const clothA = (f: number) => Math.floor(f / 2) % 2 === 0;

/** The probes for frame f: cloth A and B, the blade where it should be, and where it started. */
function probes(f: number): { x: number; y: number }[] {
  return [CLOTH_A, CLOTH_B, bladeAt(f / FRAMES), bladeAt(0), bladeAt(1 / FRAMES), signEnd(-20), signEnd(20), rocketAt(f), rocketAt(0)];
}

test('cloth loops, a sign swings back and forth and a turbine spins forever while a rocket crosses: saved, reopened, exported without a jump', async () => {
  const { page, app } = h;
  await page.evaluate((n) => window.__pigmentoTest!.setTimeline({ length: n }), FRAMES);
  const background = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);

  // Three pieces lifted from the background: the rocket, the sign and the blade (the right half of
  // a bar whose middle is the hub, so it turns about the hub).
  const lift = async (fill: Box, colour: RGBA, lifted: Box = fill): Promise<string> => {
    await page.evaluate(([id, c, r]) => window.__pigmentoTest!.fillLayer(id, c, r), [background, colour, fill] as const);
    await page.evaluate((r) => window.__pigmentoTest!.selectRect(r.x, r.y, r.w, r.h), lifted);
    expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
    return page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);
  };
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  const rocket = await lift(ROCKET, RED);
  const sign = await lift(SIGN, ORANGE);
  const blade = await lift({ x: HUB.x, y: HUB.y - 10, w: 150, h: 20 }, BLUE, { x: HUB.x - 150, y: HUB.y - 10, w: 300, h: 20 });

  // The rocket crosses the whole timeline.
  await page.evaluate((id) => window.__pigmentoTest!.setPieceKey(id, 47, { x: 1190 }), rocket);
  // The sign: −20° on the first frame, 20° at frame 7, then Back and forth for ever.
  await page.evaluate(([id, a, b]) => {
    window.__pigmentoTest!.setPieceKey(id, 0, { angle: a });
    window.__pigmentoTest!.setPieceKey(id, 6, { angle: b });
  }, [sign, -20 * DEG, 20 * DEG] as const);
  await page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), sign);
  await page.keyboard.press('a');
  const bar = page.locator('.optionsbar');
  await bar.getByRole('combobox', { name: 'Loop', exact: true }).selectOption({ label: 'Back and forth' });
  for (const [f, deg] of [
    [12, -20],
    [18, 20],
    [9, 0],
    [42, 20],
  ]) {
    expect((await page.evaluate(([id, n]) => window.__pigmentoTest!.pieceAt(id, n)!.angle, [sign, f] as const)) / DEG).toBeCloseTo(deg, 6);
  }

  // The turbine: its blade spins 0.3 turns a second, fitted to the timeline (48 frames at 12 a
  // second is 4 seconds: 1.2 turns, fitted to one, so a quarter turn a second).
  await page.evaluate((id) => window.__pigmentoTest!.selectPiece(id), blade);
  await bar.locator('.opt-pop-btn', { hasText: 'Spin' }).click();
  const pop = page.getByRole('dialog', { name: 'Spin' });
  const speed = pop.getByRole('textbox', { name: 'Spin', exact: true });
  await speed.fill('0.3');
  await speed.press('Enter');
  await expect(bar.locator('.opt-pop-btn', { hasText: 'Spin' })).toContainText('0.3 turns/s');
  await pop.getByRole('button', { name: 'Fit to the timeline' }).click();
  await expect(speed).toHaveValue('0.25');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.spin))!.spin).toBeCloseTo(0.25, 12);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  // Its keyframes are untouched.
  expect(await page.evaluate((id) => window.__pigmentoTest!.pieceKeys(id).length, blade)).toBe(1);

  // The cloth, on a layer of its own: on a line, hanging on the left in one drawing and the right in the next, looping Cycle.
  await page.evaluate(() => window.__pigmentoTest!.addLayer());
  const clothLayer = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.getByRole('tab', { name: 'Animate' }).click();
  // The blade's speed has a row of its own in the timeline, under the blade's.
  if (!(await page.locator('.tl-names').isVisible())) await page.locator('.ribbon').getByRole('button', { name: 'Timeline', exact: true }).click();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const spinRow = timeline.locator('.tl-spin-row');
  await expect(spinRow).toHaveCount(1);
  await expect(spinRow.locator('.tl-key')).toHaveCount(1);
  await expect(timeline.getByRole('button', { name: 'Piece 3 · spin', exact: true })).toBeVisible();
  const draw = async (cloth: Box) => {
    await page.evaluate(([id, c, r]) => window.__pigmentoTest!.fillLayer(id, c, r), [clothLayer, BLACK, { x: 480, y: 96, w: 260, h: 4 }] as const);
    await page.evaluate(([id, c, r]) => window.__pigmentoTest!.fillLayer(id, c, r), [clothLayer, GREEN, cloth] as const);
  };
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  await draw({ x: 520, y: 100, w: 80, h: 70 });
  await page.evaluate(() => window.__pigmentoTest!.setFrame(2));
  await page.locator('.ribbon').getByRole('button', { name: 'New drawing' }).click();
  await draw({ x: 620, y: 100, w: 80, h: 70 });
  await page.locator('.ribbon').getByRole('combobox', { name: 'Loop drawings' }).selectOption({ label: 'Cycle' });
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().celLoops))[clothLayer]).toEqual({ mode: 'cycle', end: 4 });

  /** The probes at frame f, read from the picture (CPU) or the screen. */
  const read = (f: number, screen: boolean): Promise<Rgb[]> =>
    page.evaluate(
      async ([n, pts, s]) => {
        const tt = window.__pigmentoTest!;
        tt.setFrame(n);
        return s ? tt.screenPixels(pts) : pts.map((p) => tt.pixel(p.x, p.y));
      },
      [f, probes(f), screen] as const,
    );
  const check = (f: number, px: Rgb[]) => {
    const [a, b, bladeNow, bladeStart, bladeNext, signUp, signDown, rocketNow, rocketStart] = px;
    const where = `frame ${f + 1}`;
    expect(isGreen(a), `${where}: cloth A`).toBe(clothA(f));
    expect(isGreen(b), `${where}: cloth B`).toBe(!clothA(f));
    expect(isBlue(bladeNow), `${where}: blade`).toBe(true);
    // Swinging between −20° (frames 1, 13, 25…) and 20° (frames 7, 19, 31…).
    const m = f % 12;
    if (m === 0) expect([isOrange(signUp), isOrange(signDown)], `${where}: sign up`).toEqual([true, false]);
    if (m === 6) expect([isOrange(signUp), isOrange(signDown)], `${where}: sign down`).toEqual([false, true]);
    expect(isRed(rocketNow), `${where}: rocket`).toBe(true);
    if (f === FRAMES - 1) {
      // One step short of where the blade started (and not past it), and the rocket long gone from the start.
      expect([isBlue(bladeStart), isBlue(bladeNext)], 'the last frame’s blade').toEqual([false, false]);
      expect(isRed(rocketStart)).toBe(false);
    }
  };
  // The screen and the CPU path agree.
  for (const f of [0, 13, 47]) {
    const cpu = await read(f, false);
    check(f, cpu);
    check(f, await read(f, true));
  }

  // Saved and opened again: the same loops and spin.
  const project = tempFile('loops.pigm');
  const stubSave = (fp: string) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, fp);
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  const info = await page.evaluate(() => window.__pigmentoTest!.anim());
  expect(info.length).toBe(FRAMES);
  expect(Object.values(info.celLoops)).toEqual([{ mode: 'cycle', end: 4 }]);
  expect(info.pieces.find((p) => p.id === sign)!.loop).toBe('pingpong');
  expect(info.pieces.find((p) => p.id === blade)!.spinKeys).toEqual([{ frame: 0, easing: 'linear' }]);
  check(47, await read(47, false));

  // Exported as a GIF: the cloth flapping all the way through, and the blade on the last frame one
  // step short of where it started.
  const gif = path.join(path.dirname(project), 'loops.gif');
  await stubSave(gif);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText(`${FRAMES} frames`);
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const bytes = readFileSync(gif);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  const all = Array.from({ length: FRAMES }, (_, f) => probes(f));
  const frames = await page.evaluate(
    async ([b64, pts]) => {
      const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), type: 'image/gif' });
      await dec.tracks.ready;
      await dec.completed;
      const out: { r: number; g: number; b: number }[][] = [];
      const n = dec.tracks.selectedTrack!.frameCount;
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        out.push(pts[i].map((p) => ({ r: d[(p.y * c.width + p.x) * 4], g: d[(p.y * c.width + p.x) * 4 + 1], b: d[(p.y * c.width + p.x) * 4 + 2] })));
      }
      return out;
    },
    [bytes.toString('base64'), all] as const,
  );
  expect(frames.length).toBe(FRAMES);
  frames.forEach((px, f) => check(f, px));
});
