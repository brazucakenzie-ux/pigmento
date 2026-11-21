// Stop 7C's whole story: a rocket along a drawn path, facing its way, smoke lit at ignition that
// thins out, its path erased behind it; saved and reopened; exported as a GIF and an MP4.
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { clickDoc, drag, launchApp, ready, tempFile, type AppHandle } from './harness';

let h: AppHandle;

test.beforeEach(async () => {
  h = await launchApp();
  await ready(h.page);
});

test.afterEach(async () => {
  expect(h.errors).toEqual([]);
  await h.close();
});

const RED = { r: 220, g: 30, b: 30, a: 255 };

/** Pixels of the picture in r (CPU path), every `step`: smoke (grey), and path ink (blue). */
async function survey(page: Page, frame: number, r: { x: number; y: number; w: number; h: number }, step = 3): Promise<{ smoke: number; ink: number; at: { x: number; y: number } | null }> {
  return page.evaluate(
    ([f, rr, st]) => {
      const t = window.__pigmentoTest!;
      t.setFrame(f as number);
      const box = rr as { x: number; y: number; w: number; h: number };
      let smoke = 0;
      let ink = 0;
      let best = 255;
      let at: { x: number; y: number } | null = null;
      for (let y = box.y; y < box.y + box.h; y += st as number) {
        for (let x = box.x; x < box.x + box.w; x += st as number) {
          const p = t.pixel(x, y);
          // Smoke is near grey (the path's light blue edges aren't).
          const grey = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) <= 10;
          if (p.b > 150 && p.r < 120) ink++;
          else if (grey && p.r < 235) {
            smoke++;
            if (p.r < best) {
              best = p.r;
              at = { x, y };
            }
          }
        }
      }
      return { smoke, ink, at };
    },
    [frame, r, step] as const,
  );
}

/** Play an MP4 in Chromium's own player (a hidden window of its own: Pigmento's doesn't allow media). */
async function probeVideo(file: string, probes: { t: number; x: number; y: number }[]): Promise<{ duration: number; w: number; h: number; pixels: number[][] }> {
  const url = 'file:///' + file.split(path.sep).join('/');
  const script = `(async () => {
    const video = document.createElement('video');
    video.muted = true;
    video.src = ${JSON.stringify(url)};
    await new Promise((res, rej) => {
      video.onloadeddata = () => res();
      video.onerror = () => rej(new Error('video error ' + (video.error && video.error.message)));
    });
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const pixels = [];
    for (const p of ${JSON.stringify(probes)}) {
      await new Promise((res) => {
        video.onseeked = () => res();
        video.currentTime = p.t;
      });
      ctx.drawImage(video, 0, 0);
      pixels.push(Array.from(ctx.getImageData(p.x, p.y, 1, 1).data));
    }
    return { duration: video.duration, w: video.videoWidth, h: video.videoHeight, pixels };
  })()`;
  return h.app.evaluate(async ({ BrowserWindow }, js) => {
    const win = new BrowserWindow({ show: false, webPreferences: { partition: 'mp4-probe', webSecurity: false } });
    try {
      await win.loadURL('about:blank');
      return (await win.webContents.executeJavaScript(js)) as { duration: number; w: number; h: number; pixels: number[][] };
    } finally {
      win.destroy();
    }
  }, script);
}

test('a rocket along a path, facing its way, smoke from ignition thinning out, the path erased behind it: saved, reopened, exported', async () => {
  const { page, app } = h;
  // The rocket: a red bar lifted into a piece.
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate(([lid, col]) => window.__pigmentoTest!.fillLayer(lid as string, col as typeof RED, { x: 100, y: 60, w: 120, h: 40 }), [layerId, RED] as const);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 60, 120, 40));
  expect(await page.evaluate(() => window.__pigmentoTest!.animateSelection(false))).toBe(true);
  const id = await page.evaluate(() => window.__pigmentoTest!.anim().selectedId!);

  // A curve with the Pen, as a shape (blue, so it's told apart from the smoke): up from the bottom left, over the top, down to the right.
  await page.getByRole('button', { name: /Colour #1E88E5/ }).click();
  await page.getByRole('tab', { name: 'Shapes' }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('radio', { name: 'Shape layer (stays editable)' }).click();
  await clickDoc(page, 200, 600);
  await drag(page, [
    [640, 200],
    [740, 200],
    [840, 200],
  ]);
  await clickDoc(page, 1080, 600);
  await page.keyboard.press('Enter');

  // The rocket follows it and faces its way.
  await page.keyboard.press('a');
  const bar = page.locator('.optionsbar');
  await bar.getByRole('combobox', { name: 'Path' }).selectOption({ index: 1 });
  await bar.getByRole('checkbox', { name: 'Face its way' }).check();

  // Smoke from its tail: off at first, lit at frame 5 (sharply), thinning to 30 % by frame 18.
  await bar.locator('.opt-pop-btn', { hasText: 'Trail' }).click();
  const pop = page.getByRole('dialog', { name: 'Trail' });
  await pop.getByRole('button', { name: 'Add a trail' }).click();
  const emission = pop.getByRole('textbox', { name: 'Emission', exact: true });
  const keyAt = async (frame: number, percent: string) => {
    await page.evaluate((f) => window.__pigmentoTest!.setFrame(f), frame);
    await emission.fill(percent);
    await emission.press('Enter');
  };
  await keyAt(0, '0');
  await pop.getByRole('combobox', { name: 'Easing' }).selectOption('hold');
  await keyAt(4, '100');
  await keyAt(17, '30');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].keys).toEqual([
    { frame: 0, amount: 0, easing: 'hold' },
    { frame: 4, amount: 1, easing: 'hold' },
    { frame: 17, amount: 0.3, easing: 'hold' },
  ]);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  const handle = (x: number, y: number) => page.evaluate(([pid, px, py]) => window.__pigmentoTest!.pieceHandle(pid as string, px as number, py as number), [id, x, y] as const);
  const from = await handle(60, 20);
  const to = await handle(0, 20);
  await drag(page, [
    [from.x, from.y],
    [(from.x + to.x) / 2, (from.y + to.y) / 2],
    [to.x, to.y],
  ]);
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].emitter.x).toBeCloseTo(0, 0);

  // The path erased behind it.
  await page.keyboard.press('v');
  await clickDoc(page, 1080, 600);
  await bar.getByRole('combobox', { name: 'Tie' }).selectOption({ label: 'Erase behind Piece 1' });

  // Before ignition, no smoke; once lit, smoke behind it; the path gone behind it but still ahead.
  const behind = { x: 180, y: 220, w: 420, h: 420 };
  const early = await survey(page, 3, behind);
  expect(early.smoke).toBe(0);
  const lit = await survey(page, 12, behind);
  expect(lit.smoke).toBeGreaterThan(200);
  expect(lit.ink).toBe(0);
  expect((await survey(page, 12, { x: 900, y: 300, w: 200, h: 320 })).ink).toBeGreaterThan(10);
  // Thinning out: by frame 22 it gives off less than when lit.
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].emission).toBe(1);
  await page.evaluate(() => window.__pigmentoTest!.setFrame(22));
  await page.keyboard.press('a');
  expect((await page.evaluate(() => window.__pigmentoTest!.anim().current!.trails))[0].emission).toBeCloseTo(0.3, 9);

  // Saved and opened again: the same smoke, pixel for pixel.
  const dir = path.dirname(tempFile('x'));
  const project = path.join(dir, 'rocket-smoke.pigm');
  const stubSave = (fp: string) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    }, fp);
  await stubSave(project);
  await page.keyboard.press('Control+Shift+s');
  await expect.poll(() => existsSync(project)).toBe(true);
  await page.evaluate((p) => window.__pigmentoTest!.openPath(p), project);
  await expect.poll(() => page.evaluate(() => window.__pigmentoTest!.history().length)).toBe(0);
  expect(await survey(page, 12, behind)).toEqual(lit);
  expect((await survey(page, 3, behind)).smoke).toBe(0);

  // Exported as a GIF: smoke in frame 13, none in frame 4.
  const gif = path.join(dir, 'rocket-smoke.gif');
  await stubSave(gif);
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText('24 frames');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const bytes = readFileSync(gif);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  const smoky = await page.evaluate(
    async ([b64, r]) => {
      const box = r as { x: number; y: number; w: number; h: number };
      const dec = new ImageDecoder({ data: Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0)), type: 'image/gif' });
      await dec.tracks.ready;
      await dec.completed;
      const out: number[] = [];
      for (const i of [3, 12]) {
        const { image } = await dec.decode({ frameIndex: i });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const d = ctx.getImageData(box.x, box.y, box.w, box.h).data;
        let n = 0;
        for (let k = 0; k < d.length; k += 12) if (Math.max(d[k], d[k + 1], d[k + 2]) - Math.min(d[k], d[k + 1], d[k + 2]) <= 14 && d[k] < 235) n++;
        out.push(n);
      }
      return { frames: dec.tracks.selectedTrack!.frameCount, early: out[0], lit: out[1] };
    },
    [bytes.toString('base64'), behind] as const,
  );
  expect(smoky.frames).toBe(24);
  expect(smoky.early).toBe(0);
  expect(smoky.lit).toBeGreaterThan(200);

  // And as an MP4: at frame 12 the smokiest point of the picture is grey in the video too.
  const mp4 = path.join(dir, 'rocket-smoke.mp4');
  await stubSave(mp4);
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  await dlg.getByRole('radio', { name: 'MP4 video' }).click();
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  expect(readFileSync(mp4).subarray(4, 8).toString('ascii')).toBe('ftyp');
  const spot = lit.at!;
  const v = await probeVideo(mp4, [{ t: 12 / 12 + 0.02, x: spot.x, y: spot.y }]);
  expect(v.duration).toBeCloseTo(2, 1);
  const [r, g, b] = v.pixels[0];
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
  expect(r).toBeLessThan(230);
});
