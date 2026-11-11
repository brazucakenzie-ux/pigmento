import { describe, expect, it } from 'vitest';
import { BrushStroke, strokeSeed } from '@engine/brush/BrushStroke';
import { dabBounds, forEachDabPixel, paintDabInto, type Dab, type DabShape } from '@engine/brush/dab';
import { makeTip, sampleMask, tipLevel } from '@engine/brush/tips';
import { curveAt, defaultBrush, dynamicValue, LINEAR, seededRandom, type BrushSettings } from '@engine/brush/types';
import { Surface } from '@engine/raster/Surface';
import type { RGBA } from '@engine/core/color';

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const ROUND: DabShape = { tip: 'round', pixel: false, texture: null };
const still = { pressure: 1, tilt: 0, speed: 0 };

/** Run a stroke through points; returns its dabs and the surface they were painted into. */
function stroke(settings: BrushSettings, pts: [number, number, number?][], size = 10, seed = 1): { dabs: Dab[]; surface: Surface } {
  const surface = new Surface(200, 200);
  const dabs: Dab[] = [];
  const shape: DabShape = { tip: settings.tip.kind === 'square' ? 'square' : 'round', pixel: settings.pixel, texture: null };
  const s = new BrushStroke({ settings, size, color: BLACK, seed, emit: (d) => (dabs.push(d), paintDabInto(surface, d, shape)) });
  pts.forEach(([x, y, pressure = 1], i) => (i === 0 ? s.begin({ x, y, ...still, pressure }) : s.to({ x, y, ...still, pressure })));
  return { dabs, surface };
}

const alphaAt = (s: Surface, x: number, y: number) => s.getPixel(x, y).a;

describe('dab shapes', () => {
  it('covers a round dab with an anti-aliased edge and a hardness falloff', () => {
    const cov = new Map<string, number>();
    forEachDabPixel({ x: 20, y: 20, size: 16, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: BLACK }, ROUND, { x: 0, y: 0, w: 40, h: 40 }, (x, y, c) => cov.set(`${x},${y}`, c));
    expect(cov.get('20,20')).toBe(1);
    expect(cov.has('30,20')).toBe(false);
    const edge = cov.get('27,20')!;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThanOrEqual(1);
    const soft = new Map<string, number>();
    forEachDabPixel({ x: 20, y: 20, size: 16, angle: 0, roundness: 1, hardness: 0, alpha: 1, color: BLACK }, ROUND, { x: 0, y: 0, w: 40, h: 40 }, (x, y, c) => soft.set(`${x},${y}`, c));
    expect(soft.get('24,20')!).toBeLessThan(cov.get('24,20')!);
  });

  it('squashes and turns the tip with roundness and angle', () => {
    const covered = (angle: number) => {
      const pts: string[] = [];
      forEachDabPixel({ x: 20, y: 20, size: 20, angle, roundness: 0.2, hardness: 1, alpha: 1, color: BLACK }, ROUND, { x: 0, y: 0, w: 40, h: 40 }, (x, y, c) => {
        if (c > 0.5) pts.push(`${x},${y}`);
      });
      return pts;
    };
    // Flat: wide, not tall. A quarter turn: tall, not wide.
    expect(covered(0)).toContain('28,20');
    expect(covered(0)).not.toContain('20,28');
    expect(covered(Math.PI / 2)).toContain('20,28');
    expect(covered(Math.PI / 2)).not.toContain('28,20');
  });

  it('gives pixel dabs an exact footprint of whole pixels', () => {
    const px: string[] = [];
    const shape: DabShape = { tip: 'square', pixel: true, texture: null };
    forEachDabPixel({ x: 10.2, y: 10.7, size: 2, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: BLACK }, shape, dabBounds({ x: 10.2, y: 10.7, size: 2, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: BLACK }), (x, y, c) => {
      expect(c).toBe(1);
      px.push(`${x},${y}`);
    });
    expect(px.sort()).toEqual(['10,10', '10,11', '9,10', '9,11'].sort());
  });

  it('reads image tips (and smaller copies for small dabs) and grain', () => {
    const big = { w: 64, h: 64, data: new Uint8Array(64 * 64).fill(255) };
    const tip = makeTip(big);
    expect(tip.mips.map((m) => m.w)).toEqual([32, 16, 8]);
    expect(tipLevel(tip, 10).w).toBe(16);
    expect(sampleMask(big, 0.5, 0.5)).toBe(1);
    // A grain that's empty on odd columns lets paint through on even ones only.
    const stripes = { w: 2, h: 1, data: new Uint8Array([255, 0]) };
    const shape: DabShape = { tip: 'round', pixel: false, texture: { mask: stripes, scale: 1, depth: 1, mode: 'multiply' } };
    const seen = new Map<number, number>();
    forEachDabPixel({ x: 10, y: 10, size: 8, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: BLACK }, shape, { x: 0, y: 0, w: 20, h: 20 }, (x, _y, c) => seen.set(x % 2, Math.max(seen.get(x % 2) ?? 0, c)));
    expect(seen.get(0)).toBe(1);
    expect(seen.has(1)).toBe(false);
  });
});

describe('strokes', () => {
  it('builds up paint with flow, never past full cover', () => {
    const half = defaultBrush({ flow: 0.5, hardness: 1 });
    const one = stroke(half, [[50, 50]]);
    expect(alphaAt(one.surface, 50, 50)).toBe(128);
    // Two dabs on the same spot: 1 - 0.5 × 0.5 = 75%.
    const s = new Surface(100, 100);
    const shape: DabShape = { tip: 'round', pixel: false, texture: null };
    const d: Dab = { x: 50, y: 50, size: 10, angle: 0, roundness: 1, hardness: 1, alpha: 0.5, color: BLACK };
    paintDabInto(s, d, shape);
    paintDabInto(s, d, shape);
    expect(Math.abs(alphaAt(s, 50, 50) - 191)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 20; i++) paintDabInto(s, d, shape);
    expect(alphaAt(s, 50, 50)).toBe(255);
  });

  it('spaces dabs evenly whatever the input segmentation', () => {
    const brush = defaultBrush({ spacing: 0.5 });
    const count = (segments: number) => {
      const pts: [number, number][] = [[0, 0]];
      for (let i = 1; i <= segments; i++) pts.push([(100 * i) / segments, 0]);
      return stroke(brush, pts, 10).dabs.length;
    };
    // A dab every 5 px over 100 px, plus the first.
    expect(count(1)).toBe(21);
    expect(count(37)).toBe(21);
  });

  it('draws pixel lines one pixel wide and 8-connected (as Paint does)', () => {
    const pencil = defaultBrush({ tip: { kind: 'square' }, pixel: true });
    const { surface } = stroke(pencil, [
      [2.5, 2.5],
      [12.5, 7.5],
    ], 1);
    let n = 0;
    for (let y = 0; y < 20; y++) {
      let row = 0;
      for (let x = 0; x < 20; x++) if (alphaAt(surface, x, y) === 255) row++;
      n += row;
    }
    // Bresenham from (2, 2) to (12, 7): 11 pixels, no extra ones on the diagonal steps.
    expect(n).toBe(11);
    expect(alphaAt(surface, 2, 2)).toBe(255);
    expect(alphaAt(surface, 12, 7)).toBe(255);
    // One pixel per column: never two in the same column.
    for (let x = 2; x <= 12; x++) expect([...Array(20).keys()].filter((y) => alphaAt(surface, x, y) === 255)).toHaveLength(1);
  });

  it('follows pressure through the size dynamic', () => {
    const brush = defaultBrush({ spacing: 0.5, dynamics: { size: { source: 'pressure', curve: LINEAR, min: 0.1 } } });
    const { dabs } = stroke(brush, [
      [10, 10, 0],
      [110, 10, 1],
    ], 20);
    expect(dabs[0].size).toBeCloseTo(2);
    expect(dabs.at(-1)!.size).toBeGreaterThan(18);
    // Light pressure, small dabs, closer together.
    expect(dabs[1].x - dabs[0].x).toBeLessThan(dabs.at(-1)!.x - dabs.at(-2)!.x);
  });

  it('repeats exactly with the same seed, and jitters within its limits', () => {
    const brush = defaultBrush({ sizeJitter: 0.5, opacityJitter: 0.5, angleJitter: 1, scatter: 1, count: 3 });
    const a = stroke(brush, [
      [20, 20],
      [120, 80],
    ], 16, 7).dabs;
    const b = stroke(brush, [
      [20, 20],
      [120, 80],
    ], 16, 7).dabs;
    expect(a).toEqual(b);
    const c = stroke(brush, [
      [20, 20],
      [120, 80],
    ], 16, 8).dabs;
    expect(c).not.toEqual(a);
    for (const d of a) {
      expect(d.size).toBeGreaterThanOrEqual(8);
      expect(d.size).toBeLessThanOrEqual(16);
      expect(d.alpha).toBeGreaterThanOrEqual(0.5);
    }
    expect(strokeSeed(20, 20)).toBe(strokeSeed(20, 20));
    expect(strokeSeed(20, 20)).not.toBe(strokeSeed(21, 20));
  });

  it('turns tips with the stroke and jitters colour', () => {
    const follow = stroke(defaultBrush({ followStroke: true, spacing: 1 }), [
      [10, 10],
      [10, 110],
    ]).dabs;
    expect(follow.at(-1)!.angle).toBeCloseTo(Math.PI / 2);
    const red: RGBA = { r: 200, g: 40, b: 40, a: 255 };
    const s = new BrushStroke({ settings: defaultBrush({ hueJitter: 1, spacing: 1 }), size: 10, color: red, seed: 3, emit: () => null });
    const colours: RGBA[] = [];
    const t = new BrushStroke({ settings: defaultBrush({ hueJitter: 1, spacing: 1 }), size: 10, color: red, seed: 3, emit: (d) => (colours.push(d.color), null) });
    s.begin({ x: 0, y: 0, ...still });
    t.begin({ x: 0, y: 0, ...still });
    t.to({ x: 100, y: 0, ...still });
    expect(new Set(colours.map((c) => `${c.r},${c.g},${c.b}`)).size).toBeGreaterThan(3);
  });

  it('mixes in the colour under the dab for wet brushes', () => {
    const colours: RGBA[] = [];
    const s = new BrushStroke({
      settings: defaultBrush({ mix: 0.5 }),
      size: 10,
      color: { r: 0, g: 0, b: 255, a: 255 },
      seed: 1,
      pickColor: () => ({ r: 255, g: 255, b: 0, a: 255 }),
      emit: (d) => (colours.push(d.color), null),
    });
    s.begin({ x: 0, y: 0, ...still });
    expect(colours[0]).toMatchObject({ r: 127.5, g: 127.5, b: 127.5 });
  });

  it('keeps spraying for airbrushes held still', () => {
    let n = 0;
    const s = new BrushStroke({ settings: defaultBrush({ airbrush: true }), size: 10, color: BLACK, seed: 1, emit: () => (n++, null) });
    s.begin({ x: 0, y: 0, ...still });
    s.hold();
    s.hold();
    expect(n).toBe(3);
  });
});

describe('dynamics', () => {
  it('maps input through a curve between its minimum and full', () => {
    expect(curveAt(LINEAR, 0.25)).toBe(0.25);
    expect(curveAt([[0, 1], [1, 0]], 0.25)).toBe(0.75);
    expect(curveAt([[0, 0], [0.5, 1], [1, 1]], 0.25)).toBe(0.5);
    const d = { source: 'pressure' as const, curve: LINEAR, min: 0.2 };
    expect(dynamicValue(d, { pressure: 0, tilt: 0, speed: 0 }, Math.random)).toBeCloseTo(0.2);
    expect(dynamicValue(d, { pressure: 1, tilt: 0, speed: 0 }, Math.random)).toBe(1);
    expect(dynamicValue({ ...d, source: 'speed' }, { pressure: 1, tilt: 0, speed: 0.5 }, Math.random)).toBeCloseTo(0.6);
    expect(dynamicValue(undefined, { pressure: 0, tilt: 0, speed: 0 }, Math.random)).toBe(1);
    expect(dynamicValue({ ...d, source: 'off' }, { pressure: 0, tilt: 0, speed: 0 }, Math.random)).toBe(1);
    const r = seededRandom(5);
    expect(dynamicValue({ ...d, source: 'random', min: 0 }, still, r)).toBe(seededRandom(5)());
  });
});
