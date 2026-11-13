import { describe, expect, it } from 'vitest';
import { filterRegistry, planBands, runJob } from '@engine/filters/FilterRegistry';
import { handleFilterRequest } from '@engine/filters/protocol';
import { smoothCurveAt } from '@engine/filters/adjustments';
import { defaultParams, type FilterParams } from '@engine/filters/types';

type Px = [number, number, number, number];

function img(w: number, h: number, fn: (x: number, y: number) => Px) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, w, h };
}

/** Run filter `id` over a whole image (as one band) with some settings changed. */
function run(id: string, image: { data: Uint8ClampedArray; w: number; h: number }, over: FilterParams = {}) {
  const def = filterRegistry.get(id)!;
  const out = def.run({ ...image, x0: 0, y0: 0, frame: { x: 0, y: 0, w: image.w, h: image.h }, scale: 1 }, { ...defaultParams(def), ...over });
  const at = (x: number, y: number): Px => Array.from(out.slice((y * image.w + x) * 4, (y * image.w + x) * 4 + 4)) as Px;
  return { out, at };
}

const solid = (c: Px, w = 4, h = 4) => img(w, h, () => c);
const one = (id: string, c: Px, over: FilterParams = {}) => run(id, solid(c, 1, 1), over).at(0, 0);

describe('adjustments', () => {
  it('brightness and contrast', () => {
    expect(Math.abs(one('brightnessContrast', [100, 100, 100, 255], { brightness: 100 })[0] - 228)).toBeLessThanOrEqual(1);
    expect(one('brightnessContrast', [20, 200, 90, 255], { contrast: -100 })).toEqual([128, 128, 128, 255]);
    expect(one('brightnessContrast', [140, 140, 140, 7], { contrast: 50 })).toEqual([152, 152, 152, 7]);
  });

  it('hue, saturation, lightness and colourise', () => {
    expect(one('hueSaturation', [255, 0, 0, 255], { hue: 180 })).toEqual([0, 255, 255, 255]);
    const grey = one('hueSaturation', [200, 50, 50, 255], { saturation: -100 });
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    expect(one('hueSaturation', [10, 10, 10, 255], { lightness: 100 })).toEqual([255, 255, 255, 255]);
    const tinted = one('hueSaturation', [128, 128, 128, 255], { colorize: true, hue: 120 });
    expect(tinted[1]).toBeGreaterThan(tinted[0]);
    expect(tinted[1]).toBeGreaterThan(tinted[2]);
  });

  it('levels', () => {
    expect(one('levels', [125, 50, 200, 255], { inBlack: 50, inWhite: 200 })).toEqual([128, 0, 255, 255]);
    expect(one('levels', [128, 128, 128, 255], { gamma: 2 })[0]).toBe(181);
    expect(one('levels', [0, 255, 0, 255], { outBlack: 20, outWhite: 220 })).toEqual([20, 220, 20, 255]);
  });

  it('curves, all channels and one', () => {
    const rev = [
      [0, 1],
      [1, 0],
    ] as const;
    expect(one('curves', [10, 100, 250, 255], { 'curve.rgb': rev })).toEqual([245, 155, 5, 255]);
    expect(one('curves', [10, 100, 250, 255], { 'curve.g': rev })).toEqual([10, 155, 250, 255]);
    // A smooth curve through its points, never past them.
    const pts = [
      [0, 0],
      [0.5, 0.8],
      [1, 1],
    ] as const;
    expect(smoothCurveAt(pts, 0.5)).toBeCloseTo(0.8);
    for (let x = 0; x <= 1; x += 0.05) expect(smoothCurveAt(pts, x)).toBeLessThanOrEqual(1);
  });

  it('colour balance moves the chosen tones', () => {
    const dark = one('colorBalance', [40, 40, 40, 255], { 'shadows.cyanRed': 100, preserveLuminosity: false });
    expect(dark[0]).toBeGreaterThan(70);
    expect(dark[1]).toBe(40);
    // Highlights only: a dark pixel barely moves.
    expect(one('colorBalance', [20, 20, 20, 255], { 'highlights.yellowBlue': 100 })[2]).toBeLessThan(23);
    const kept = one('colorBalance', [128, 128, 128, 255], { 'midtones.cyanRed': 100 });
    expect(Math.abs(0.299 * kept[0] + 0.587 * kept[1] + 0.114 * kept[2] - 128)).toBeLessThan(2);
  });

  it('greyscale, sepia, invert, posterise and threshold', () => {
    expect(one('grayscale', [255, 0, 0, 200])).toEqual([76, 76, 76, 200]);
    expect(one('sepia', [255, 255, 255, 255])).toEqual([255, 255, 239, 255]);
    expect(one('sepia', [100, 50, 20, 255], { amount: 0 })).toEqual([100, 50, 20, 255]);
    expect(one('invert', [10, 200, 0, 99])).toEqual([245, 55, 255, 99]);
    expect(one('posterize', [100, 200, 127, 255], { levels: 2 })).toEqual([0, 255, 0, 255]);
    expect(one('threshold', [127, 127, 127, 255], { level: 128 })[0]).toBe(0);
    expect(one('threshold', [129, 129, 129, 255], { level: 128 })[0]).toBe(255);
  });
});

describe('filters', () => {
  const dot = () => img(21, 21, (x, y) => (x === 10 && y === 10 ? [255, 255, 255, 255] : [0, 0, 0, 255]));

  it('gaussian blur spreads a dot evenly and leaves flat colour alone', () => {
    const { at } = run('gaussianBlur', dot(), { radius: 2 });
    expect(at(10, 10)[0]).toBeLessThan(255);
    expect(at(10, 10)[0]).toBeGreaterThan(at(12, 10)[0]);
    expect(at(12, 10)[0]).toBe(at(10, 12)[0]);
    expect(run('gaussianBlur', solid([50, 60, 70, 255], 12, 12), { radius: 3 }).at(5, 5)).toEqual([50, 60, 70, 255]);
  });

  it('motion blur smears along its angle only', () => {
    const { at } = run('motionBlur', dot(), { angle: 0, distance: 8 });
    expect(at(13, 10)[0]).toBeGreaterThan(0);
    expect(at(10, 13)[0]).toBe(0);
  });

  it('sharpen raises contrast at edges, not on flat colour', () => {
    const edge = img(20, 4, (x) => (x < 10 ? [100, 100, 100, 255] : [150, 150, 150, 255]));
    const { at } = run('unsharpMask', edge, { amount: 200, radius: 2 });
    expect(at(9, 1)[0]).toBeLessThan(100);
    expect(at(10, 1)[0]).toBeGreaterThan(150);
    expect(at(1, 1)[0]).toBe(100);
    // Below the threshold nothing changes.
    expect(run('unsharpMask', edge, { amount: 200, radius: 2, threshold: 100 }).at(9, 1)[0]).toBe(100);
  });

  it('noise is repeatable and within its amount', () => {
    const a = run('noise', solid([128, 128, 128, 255], 30, 30), { amount: 10 }).out;
    const b = run('noise', solid([128, 128, 128, 255], 30, 30), { amount: 10 }).out;
    expect(a).toEqual(b);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      expect(Math.abs(a[i] - 128)).toBeLessThanOrEqual(26);
      expect(a[i]).toBe(a[i + 1]);
      if (a[i] !== 128) changed++;
    }
    expect(changed).toBeGreaterThan(800);
  });

  it('pixelate makes blocks of each cell’s average', () => {
    const grad = img(8, 8, (x) => [x * 30, 0, 0, 255]);
    const { at } = run('pixelate', grad, { cell: 4 });
    expect(at(0, 0)[0]).toBe(45);
    expect(at(3, 3)[0]).toBe(45);
    expect(at(4, 0)[0]).toBe(165);
  });

  it('emboss and find edges', () => {
    expect(run('emboss', solid([90, 30, 200, 255], 6, 6)).at(3, 3)).toEqual([128, 128, 128, 255]);
    const edge = img(10, 4, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const { at } = run('edgeDetect', edge);
    expect(at(1, 1)[0]).toBe(255);
    expect(at(5, 1)[0]).toBeLessThan(100);
  });

  it('vignette darkens the corners, not the middle', () => {
    const { at } = run('vignette', solid([200, 200, 200, 255], 40, 40), { amount: 100 });
    expect(at(20, 20)[0]).toBe(200);
    expect(at(0, 0)[0]).toBeLessThan(120);
    expect(run('vignette', solid([100, 100, 100, 255], 40, 40), { amount: -100 }).at(0, 0)[0]).toBeGreaterThan(150);
  });

  /** A 10×10 opaque red square in the middle of 40×40 transparency. */
  const square = () => img(40, 40, (x, y) => (x >= 15 && x < 25 && y >= 15 && y < 25 ? [255, 0, 0, 255] : [0, 0, 0, 0]));

  it('drop shadow falls below and to the right, under the shape', () => {
    const { at } = run('dropShadow', square(), { angle: -45, distance: 6, blur: 0, opacity: 100 });
    expect(at(28, 28)).toEqual([0, 0, 0, 255]);
    expect(at(12, 12)[3]).toBe(0);
    expect(at(20, 20)).toEqual([255, 0, 0, 255]);
  });

  it('outer glow surrounds the shape', () => {
    const { at } = run('outerGlow', square(), { size: 10 });
    expect(at(27, 20)[3]).toBeGreaterThan(0);
    expect(at(27, 20)[0]).toBe(255);
    expect(at(2, 2)[3]).toBe(0);
  });

  it('outline outside or inside the shape', () => {
    const out = run('outline', square(), { width: 3 });
    expect(out.at(26, 20)).toEqual([0, 0, 0, 255]);
    expect(out.at(31, 20)[3]).toBe(0);
    expect(out.at(20, 20)).toEqual([255, 0, 0, 255]);
    const inner = run('outline', square(), { width: 2, position: 'inside' });
    expect(inner.at(15, 20)).toEqual([0, 0, 0, 255]);
    expect(inner.at(20, 20)).toEqual([255, 0, 0, 255]);
    expect(inner.at(13, 20)[3]).toBe(0);
  });
});

describe('running filters in bands', () => {
  // Busy enough that any band seam would show.
  const busy = img(90, 300, (x, y) => [(x * 37 + y * 11) % 256, (x * y) % 256, (y * 7) % 256, x % 9 === 0 ? 0 : 255]);
  const frame = { x: 0, y: 0, w: busy.w, h: busy.h };

  it.each(filterRegistry.all().map((d) => d.id))('%s gives the same pixels in bands as in one go', (id) => {
    const def = filterRegistry.get(id)!;
    const params = defaultParams(def);
    const whole = def.run({ ...busy, x0: 0, y0: 0, frame, scale: 1 }, params);
    const banded = runJob({ filterId: id, params, src: busy, x0: 0, y0: 0, inner: frame, frame, scale: 1 });
    expect(planBands(frame, busy.h, 0, 1).length).toBeGreaterThan(1);
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - banded[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('plans bands that cover every row once, with the padding they read', () => {
    const bands = planBands({ y: 10, h: 500 }, 600, 40, 2);
    expect(bands[0].y0).toBe(10);
    expect(bands[bands.length - 1].y1).toBe(510);
    for (let i = 1; i < bands.length; i++) expect(bands[i].y0).toBe(bands[i - 1].y1);
    for (const b of bands) {
      expect(b.r0).toBe(Math.max(0, b.y0 - 40));
      expect(b.r1).toBe(Math.min(600, b.y1 + 40));
      expect(b.y1 - b.y0).toBeGreaterThanOrEqual(Math.min(80, 510 - b.y0));
    }
  });
});

describe('the filter worker protocol', () => {
  const input = { data: new Uint8ClampedArray([10, 20, 30, 255]), w: 1, h: 1, x0: 0, y0: 0, frame: { x: 0, y: 0, w: 1, h: 1 }, scale: 1 };

  it('answers a band with its filtered pixels, by id', () => {
    const res = handleFilterRequest({ id: 7, filterId: 'invert', params: {}, input });
    expect(res).toEqual({ id: 7, ok: true, data: new Uint8ClampedArray([245, 235, 225, 255]) });
  });

  it('reports unknown filters and malformed images instead of throwing', () => {
    expect(handleFilterRequest({ id: 1, filterId: 'nope', params: {}, input })).toMatchObject({ id: 1, ok: false });
    expect(handleFilterRequest({ id: 2, filterId: 'invert', params: {}, input: { ...input, w: 3 } })).toMatchObject({ id: 2, ok: false, error: 'Bad image' });
    // Settings of the wrong type fall back to defaults.
    expect(handleFilterRequest({ id: 3, filterId: 'posterize', params: { levels: 'many' }, input })).toMatchObject({ id: 3, ok: true });
  });
});
