import { describe, expect, it } from 'vitest';
import {
  colorAt,
  GRADIENT_PRESETS,
  gradientParam,
  normalizeStops,
  presetStops,
  renderGradient,
  wrapParam,
  type GradientSpec,
} from '@engine/raster/gradient';
import { BUILTIN_PATTERNS, patternById, renderPattern, tileInto } from '@engine/raster/patterns';

const black = { r: 0, g: 0, b: 0, a: 255 };
const white = { r: 255, g: 255, b: 255, a: 255 };
const red = { r: 255, g: 0, b: 0, a: 255 };

const px = (img: { w: number; data: Uint8ClampedArray }, x: number, y: number) => [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 4)];

describe('gradient geometry', () => {
  const s = { x: 0, y: 0 };
  const e = { x: 100, y: 0 };

  it('linear projects onto the drag line', () => {
    expect(gradientParam('linear', s, e, 50, 999)).toBeCloseTo(0.5);
    expect(gradientParam('linear', s, e, -10, 0)).toBeCloseTo(-0.1);
  });

  it('radial measures distance from the start', () => {
    expect(gradientParam('radial', s, e, 0, 50)).toBeCloseTo(0.5);
    expect(gradientParam('radial', s, e, 60, 80)).toBeCloseTo(1);
  });

  it('angular sweeps a full turn starting along the drag', () => {
    expect(gradientParam('angular', s, e, 10, 0)).toBeCloseTo(0);
    expect(gradientParam('angular', s, e, 0, 10)).toBeCloseTo(0.25);
    expect(gradientParam('angular', s, e, -10, 0)).toBeCloseTo(0.5);
  });

  it('diamond follows the drag direction', () => {
    expect(gradientParam('diamond', s, e, 50, 0)).toBeCloseTo(0.5);
    expect(gradientParam('diamond', s, e, 25, 25)).toBeCloseTo(0.5);
    const rotated = gradientParam('diamond', s, { x: 0, y: 100 }, 0, 50);
    expect(rotated).toBeCloseTo(0.5);
  });

  it('wraps by clamping, repeating or reflecting, and reverses', () => {
    expect(wrapParam(1.25, 'none', false)).toBe(1);
    expect(wrapParam(1.25, 'repeat', false)).toBeCloseTo(0.25);
    expect(wrapParam(1.25, 'reflect', false)).toBeCloseTo(0.75);
    expect(wrapParam(-0.25, 'reflect', false)).toBeCloseTo(0.25);
    expect(wrapParam(0.2, 'none', true)).toBeCloseTo(0.8);
  });
});

describe('gradient colours', () => {
  it('sorts and completes stops', () => {
    expect(normalizeStops([{ pos: 1.5, color: red }, { pos: -1, color: black }]).map((s) => s.pos)).toEqual([0, 1]);
    expect(normalizeStops([{ pos: 0.3, color: red }])).toHaveLength(2);
  });

  it('fades to transparent without darkening (premultiplied)', () => {
    const c = colorAt([{ pos: 0, color: red }, { pos: 1, color: { ...red, a: 0 } }], 0.5);
    expect(c.r).toBe(255);
    expect(c.a).toBeGreaterThan(125);
    expect(c.a).toBeLessThan(130);
  });

  it('renders the stop colours at the ends and blends between', () => {
    const spec: GradientSpec = { type: 'linear', stops: [{ pos: 0, color: black }, { pos: 1, color: white }], start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, reverse: false, repeat: 'none' };
    const img = renderGradient(spec, { x: 0, y: 0, w: 100, h: 4 }, false);
    expect(px(img, 0, 0)[0]).toBeLessThanOrEqual(2);
    expect(px(img, 99, 0)[0]).toBeGreaterThanOrEqual(253);
    expect(Math.abs(px(img, 50, 0)[0] - 129)).toBeLessThanOrEqual(1);
    const rev = renderGradient({ ...spec, reverse: true }, { x: 0, y: 0, w: 100, h: 1 }, false);
    expect(rev.data[0]).toBeGreaterThanOrEqual(253);
  });

  it('dithers by less than one level', () => {
    const spec: GradientSpec = { type: 'linear', stops: [{ pos: 0, color: black }, { pos: 1, color: white }], start: { x: 0, y: 0 }, end: { x: 64, y: 0 }, reverse: false, repeat: 'none' };
    const a = renderGradient(spec, { x: 0, y: 0, w: 64, h: 4 }, false);
    const b = renderGradient(spec, { x: 0, y: 0, w: 64, h: 4 }, true);
    for (let i = 0; i < a.data.length; i++) expect(Math.abs(a.data[i] - b.data[i])).toBeLessThanOrEqual(1);
    expect([...a.data].some((v, i) => v !== b.data[i])).toBe(true);
  });

  it('fills presets with the current colours', () => {
    const p = GRADIENT_PRESETS.find((x) => x.id === 'fade')!;
    const stops = presetStops(p, red, white);
    expect(stops[0].color).toEqual(red);
    expect(stops[1].color).toEqual({ ...red, a: 0 });
  });
});

describe('patterns', () => {
  it('has ten original tiles that all draw something', () => {
    expect(BUILTIN_PATTERNS).toHaveLength(10);
    for (const p of BUILTIN_PATTERNS) {
      const tile = renderPattern(p, black, white);
      expect([tile.w, tile.h]).toEqual([p.w, p.h]);
      let dark = 0;
      for (let i = 0; i < tile.data.length; i += 4) if (tile.data[i] < 128) dark++;
      expect(dark).toBeGreaterThan(0);
      expect(dark).toBeLessThan(p.w * p.h);
    }
  });

  it('scales tiles and can leave the background transparent', () => {
    const checker = patternById('checker')!;
    const t2 = renderPattern(checker, red, null, 2);
    expect([t2.w, t2.h]).toEqual([32, 32]);
    expect(px(t2, 20, 2)).toEqual([255, 0, 0, 255]);
    expect(px(t2, 2, 2)[3]).toBe(0);
  });

  it('tiles from the document origin so neighbouring fills line up', () => {
    const tile = renderPattern(patternById('checker')!, black, white);
    const a = tileInto(tile, { x: 5, y: 3, w: 20, h: 20 });
    const b = tileInto(tile, { x: 0, y: 0, w: 40, h: 40 });
    expect(px(a, 0, 0)).toEqual(px(b, 5, 3));
    expect(px(a, 13, 9)).toEqual(px(b, 18, 12));
  });
});
