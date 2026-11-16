// Exporting an animation: the dialog, progress and Stop, GIF and MP4 files.
import { expect, test, type Page } from '@playwright/test';
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

/** Make the next native Save dialog return `file`, and count how often it's shown. */
async function stubSave(file: string): Promise<void> {
  await h.app.evaluate(({ dialog }, fp) => {
    const g = globalThis as unknown as { __saves: number };
    g.__saves = 0;
    dialog.showSaveDialog = (async () => {
      g.__saves++;
      return { canceled: false, filePath: fp };
    }) as typeof dialog.showSaveDialog;
  }, file);
}

const saves = () => h.app.evaluate(() => (globalThis as unknown as { __saves: number }).__saves);

/** A red square on white that moves 300 px right over frames 1–11 (frame 0 → 10). */
async function movingSquare(page: Page): Promise<string> {
  const layerId = await page.evaluate(() => window.__pigmentoTest!.layers().activeId);
  await page.evaluate((id) => window.__pigmentoTest!.fillLayer(id, { r: 230, g: 30, b: 30, a: 255 }, { x: 100, y: 100, w: 80, h: 80 }), layerId);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(100, 100, 80, 80));
  await page.getByRole('tab', { name: 'Animate' }).click();
  await page.locator('.ribbon').getByRole('button', { name: 'Animate selection' }).click();
  const id = (await page.evaluate(() => window.__pigmentoTest!.anim())).pieces[0].id;
  await page.evaluate((pid) => window.__pigmentoTest!.setPieceKey(pid, 10, { x: 440 }), id);
  return id;
}

test('the Export animation dialog shows progress, stops when asked, and saves a GIF', async () => {
  const { page } = h;
  await movingSquare(page);
  const file = tempFile('moving.gif');
  await stubSave(file);

  // A long export at 200 % can be stopped part way: nothing is saved and the dialog stays.
  await page.evaluate(() => window.__pigmentoTest!.setFrame(0));
  const timeline = page.getByRole('region', { name: 'Timeline' });
  const length = timeline.getByRole('textbox', { name: 'Length' });
  await length.fill('120');
  await length.press('Enter');
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await expect(dlg).toContainText('120 frames');
  await dlg.getByRole('radio', { name: '200 %' }).click();
  await expect(dlg.getByTestId('anim-export-size')).toContainText('2560 × 1600');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  const bar = dlg.getByRole('progressbar', { name: 'Export progress' });
  await expect(bar).toBeVisible();
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await dlg.getByRole('button', { name: 'Stop' }).click();
  await expect(bar).toHaveCount(0);
  await expect(dlg).toBeVisible();
  expect(await saves()).toBe(0);
  expect(existsSync(file)).toBe(false);

  // Frames 1–11 at 100 %: saved as an animated GIF, and the dialog closes.
  await dlg.getByRole('radio', { name: '100 %' }).click();
  await dlg.getByRole('textbox', { name: 'Last frame' }).fill('11');
  await dlg.getByRole('textbox', { name: 'Last frame' }).press('Tab');
  await expect(dlg).toContainText('11 frames');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.toast', { hasText: 'Exported 11 frames to moving.gif' })).toBeVisible();
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  // Exporting never changes the picture or its history.
  expect((await page.evaluate(() => window.__pigmentoTest!.anim())).length).toBe(120);
});

/** Decode a GIF in the page: frame count, loop count, each frame's delay (ms), and some pixels. */
async function decodeGif(page: Page, file: string, probes: { frame: number; x: number; y: number }[]) {
  const b64 = readFileSync(file).toString('base64');
  return page.evaluate(
    async ({ b64, probes }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
      await dec.tracks.ready;
      const track = dec.tracks.selectedTrack!;
      await dec.completed;
      const delays: number[] = [];
      for (let i = 0; i < track.frameCount; i++) delays.push(Math.round(((await dec.decode({ frameIndex: i })).image.duration ?? 0) / 1000));
      const pixels: number[][] = [];
      for (const p of probes) {
        const { image } = await dec.decode({ frameIndex: p.frame });
        const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        pixels.push(Array.from(ctx.getImageData(p.x, p.y, 1, 1).data));
        image.close();
      }
      return { frames: track.frameCount, repeat: track.repetitionCount, delays, pixels };
    },
    { b64, probes },
  );
}

test('GIFs play the right frames for the right time, and stay clean when see-through', async () => {
  const { page } = h;
  await movingSquare(page);
  // Frames 1–11 at 12 fps, played once, on the white paper.
  const opaque = tempFile('once.gif');
  await stubSave(opaque);
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  let dlg = page.getByRole('dialog', { name: 'Export animation' });
  await dlg.getByRole('textbox', { name: 'Last frame' }).fill('11');
  await dlg.getByLabel('Playback').selectOption('once');
  await dlg.getByRole('checkbox', { name: /^Transparent/ }).uncheck();
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  let gif = await decodeGif(page, opaque, [
    { frame: 0, x: 140, y: 140 },
    { frame: 5, x: 290, y: 140 },
    { frame: 5, x: 140, y: 140 },
    { frame: 10, x: 440, y: 140 },
  ]);
  expect(gif.frames).toBe(11);
  // Played once: no repeats.
  expect(gif.repeat).toBe(0);
  // 12 fps in hundredths of a second: 80 or 90 ms a frame, 11 frames adding up to 920 ms.
  expect(gif.delays.every((d) => d === 80 || d === 90)).toBe(true);
  expect(gif.delays.reduce((a, b) => a + b, 0)).toBe(920);
  const red = (p: number[]) => p[0] > 200 && p[1] < 80 && p[2] < 80 && p[3] === 255;
  expect(red(gif.pixels[0])).toBe(true);
  expect(red(gif.pixels[1])).toBe(true);
  // Where it was is white paper (the piece left a hole the paper shows through).
  expect(gif.pixels[2].slice(0, 3).every((c) => c > 240)).toBe(true);
  expect(red(gif.pixels[3])).toBe(true);

  // See-through, back and forth over frames 1–5: 8 frames, repeating, with no trail.
  const clear = tempFile('pingpong.gif');
  await stubSave(clear);
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  dlg = page.getByRole('dialog', { name: 'Export animation' });
  await dlg.getByRole('textbox', { name: 'Last frame' }).fill('5');
  await dlg.getByLabel('Playback').selectOption('pingpong');
  await dlg.getByRole('checkbox', { name: /^Transparent/ }).check();
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 30_000 });
  gif = await decodeGif(page, clear, [
    { frame: 4, x: 260, y: 140 },
    { frame: 4, x: 140, y: 140 },
    { frame: 6, x: 200, y: 140 },
    { frame: 0, x: 600, y: 600 },
  ]);
  expect(gif.frames).toBe(8);
  expect(gif.repeat).toBe(Infinity);
  expect(red(gif.pixels[0])).toBe(true);
  // Frame 0's square isn't left behind by later frames.
  expect(gif.pixels[1][3]).toBe(0);
  // On the way back (frame 3 → 2…): the square at frame 2's place.
  expect(red(gif.pixels[2])).toBe(true);
  expect(gif.pixels[3][3]).toBe(0);
});

/**
 * Play an MP4 in Chromium's own player: its length, size, and the colour at (x, y) at a few times.
 * Pigmento's window doesn't allow media (its security policy), so this uses a hidden test-only
 * window with a session of its own.
 */
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

test('MP4 videos play for the right time at the right size, frame by frame', async () => {
  const { page } = h;
  await movingSquare(page);
  const file = tempFile('moving.mp4');
  await stubSave(file);
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await dlg.getByRole('radio', { name: 'MP4 video' }).click();
  // MP4 has no transparency, so the background choice gives way to quality.
  await expect(dlg.getByRole('checkbox', { name: /^Transparent/ })).toHaveCount(0);
  await dlg.getByRole('radio', { name: 'Best' }).click();
  await dlg.getByLabel('Playback').selectOption('loop');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('.toast', { hasText: 'Exported 24 frames to moving.mp4' })).toBeVisible();
  const head = readFileSync(file).subarray(4, 8).toString('ascii');
  expect(head).toBe('ftyp');
  // 24 frames at 12 fps: 2 seconds. Frame 0 at 0 s, frame 5 at 5/12 s, frame 10 onwards held.
  const v = await probeVideo(file, [
    { t: 0.01, x: 140, y: 140 },
    { t: 5 / 12 + 0.02, x: 290, y: 140 },
    { t: 5 / 12 + 0.02, x: 140, y: 140 },
    { t: 1.5, x: 440, y: 140 },
  ]);
  expect(v.duration).toBeCloseTo(2, 1);
  expect({ w: v.w, h: v.h }).toEqual({ w: 1280, h: 800 });
  // Video is lossy, so colours are close rather than exact.
  const redish = (p: number[]) => p[0] > 180 && p[1] < 90 && p[2] < 90;
  const whiteish = (p: number[]) => p[0] > 220 && p[1] > 220 && p[2] > 220;
  expect(redish(v.pixels[0])).toBe(true);
  expect(redish(v.pixels[1])).toBe(true);
  expect(whiteish(v.pixels[2])).toBe(true);
  expect(redish(v.pixels[3])).toBe(true);
});

test('odd sizes are padded to even for MP4', async () => {
  const { page } = h;
  await movingSquare(page);
  await page.evaluate(() => window.__pigmentoTest!.selectRect(0, 0, 641, 401));
  await page.keyboard.press('Control+Shift+x');
  expect(await page.evaluate(() => window.__pigmentoTest!.doc())).toEqual({ width: 641, height: 401 });
  const file = tempFile('odd.mp4');
  await stubSave(file);
  await page.locator('.ribbon').getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Export animation' });
  await dlg.getByRole('radio', { name: 'MP4 video' }).click();
  await dlg.getByRole('textbox', { name: 'Last frame' }).fill('3');
  await dlg.getByRole('button', { name: 'Export…' }).click();
  await expect(dlg).toBeHidden({ timeout: 60_000 });
  const v = await probeVideo(file, [{ t: 0.01, x: 140, y: 140 }]);
  expect({ w: v.w, h: v.h }).toEqual({ w: 642, h: 402 });
  expect(v.duration).toBeCloseTo(0.25, 1);
});
