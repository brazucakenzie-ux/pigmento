import { describe, expect, it } from 'vitest';
import type { Dab, DabShape } from '@engine/brush/dab';
import { blurOp, cloneOp, sharpenOp, smudgeOp, toneOp, toneWeight } from '@engine/brush/retouch';
import { Surface } from '@engine/raster/Surface';
import type { MaskView } from '@engine/raster/pixels';

const ROUND: DabShape = { tip: 'round', pixel: false, texture: null };
const BLACK = { r: 0, g: 0, b: 0, a: 255 };
const dab = (x: number, y: number, size = 12): Dab => ({ x, y, size, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: BLACK });

/** 40×40: black on the left half, white on the right. */
function edge(): Surface {
  const s = new Surface(40, 40);
  s.fillRect({ x: 0, y: 0, w: 20, h: 40 }, { r: 0, g: 0, b: 0, a: 255 });
  s.fillRect({ x: 20, y: 0, w: 20, h: 40 }, { r: 255, g: 255, b: 255, a: 255 });
  return s;
}

const grey = (s: Surface, x: number, y: number) => s.getPixel(x, y).r;

describe('retouching dabs', () => {
  it('blurs an edge under the brush only', () => {
    const s = edge();
    const op = blurOp(s, ROUND, null, 1);
    for (let i = 0; i < 4; i++) op(dab(20, 20));
    expect(grey(s, 19, 20)).toBeGreaterThan(0);
    expect(grey(s, 20, 20)).toBeLessThan(255);
    // Outside the dab the edge is untouched.
    expect(grey(s, 19, 2)).toBe(0);
    expect(grey(s, 20, 2)).toBe(255);
  });

  it('sharpens a soft edge into a harder one', () => {
    const s = new Surface(40, 40);
    for (let x = 0; x < 40; x++) s.fillRect({ x, y: 0, w: 1, h: 40 }, { r: Math.round((x / 39) * 255), g: 0, b: 0, a: 255 });
    // A step: dark left, light right, then sharpened.
    s.fillRect({ x: 0, y: 0, w: 20, h: 40 }, { r: 80, g: 0, b: 0, a: 255 });
    s.fillRect({ x: 20, y: 0, w: 20, h: 40 }, { r: 170, g: 0, b: 0, a: 255 });
    sharpenOp(s, ROUND, null, 1)(dab(20, 20));
    expect(grey(s, 19, 20)).toBeLessThan(80);
    expect(grey(s, 20, 20)).toBeGreaterThan(170);
    // Flat areas stay flat.
    expect(grey(s, 12, 20)).toBe(80);
  });

  it('smudges colour along the stroke, further with more strength', () => {
    const reach = (strength: number) => {
      const s = edge();
      const op = smudgeOp(s, ROUND, null, strength);
      for (let x = 14; x <= 34; x += 2) op(dab(x, 20));
      return 255 - grey(s, 30, 20);
    };
    expect(reach(0.95)).toBeGreaterThan(reach(0.2));
    expect(reach(0.2)).toBeGreaterThan(0);
  });

  it('smudges into and out of transparency without darkening the colour', () => {
    const BLUE = { r: 75, g: 75, b: 224, a: 255 };
    for (const [from, to] of [
      [8, 34],
      [32, 6],
    ]) {
      const s = new Surface(40, 40);
      s.fillRect({ x: 20, y: 0, w: 20, h: 40 }, BLUE);
      const op = smudgeOp(s, ROUND, null, 0.8);
      const step = Math.sign(to - from) * 2;
      for (let x = from; x !== to; x += step) op(dab(x, 20));
      let touched = 0;
      for (let x = 0; x < 40; x++) {
        const p = s.getPixel(x, 20);
        if (p.a < 8) continue;
        expect(Math.abs(p.r - BLUE.r)).toBeLessThanOrEqual(3);
        expect(Math.abs(p.b - BLUE.b)).toBeLessThanOrEqual(3);
        if (p.a < 250) touched++;
      }
      expect(touched).toBeGreaterThan(0);
    }
  });

  it('smears as far whatever the dab spacing', () => {
    const smear = (step: number) => {
      const s = edge();
      const op = smudgeOp(s, ROUND, null, 0.6);
      for (let x = 14; x <= 34; x += step) op(dab(x, 20));
      return 255 - grey(s, 30, 20);
    };
    expect(Math.abs(smear(1) - smear(4))).toBeLessThan(40);
  });

  it('clones from where the stroke started, not from paint it just laid', () => {
    const s = new Surface(60, 20);
    s.fillRect({ x: 0, y: 0, w: 10, h: 20 }, { r: 200, g: 10, b: 10, a: 255 });
    const op = cloneOp(s, s.snapshot(), ROUND, null, { x: -20, y: 0 }, 1);
    s.beginEdit();
    // Painting at x = 25 copies from x = 5 (red); at x = 45 it would copy from x = 25, which was
    // empty when the stroke began.
    op(dab(25, 10, 8));
    op(dab(45, 10, 8));
    s.endEdit();
    expect(s.getPixel(25, 10)).toEqual({ r: 200, g: 10, b: 10, a: 255 });
    expect(s.getPixel(45, 10).a).toBe(0);
  });

  it('dodges and burns by tonal range, leaving alpha alone', () => {
    const mid = new Surface(20, 20);
    mid.fillRect(mid.bounds, { r: 128, g: 128, b: 128, a: 200 });
    toneOp(mid, ROUND, null, 'dodge', 'midtones', 1)(dab(10, 10));
    expect(grey(mid, 10, 10)).toBeGreaterThan(150);
    expect(mid.getPixel(10, 10).a).toBe(200);
    const dark = new Surface(20, 20);
    dark.fillRect(dark.bounds, { r: 128, g: 128, b: 128, a: 255 });
    toneOp(dark, ROUND, null, 'burn', 'midtones', 1)(dab(10, 10));
    expect(grey(dark, 10, 10)).toBeLessThan(110);
    expect(toneWeight('shadows', 0.05)).toBeCloseTo(1);
    expect(toneWeight('shadows', 0.9)).toBe(0);
    expect(toneWeight('highlights', 0.98)).toBe(1);
    expect(toneWeight('midtones', 0.5)).toBe(1);
    expect(toneWeight('midtones', 0)).toBe(0);
  });

  it('keeps to the selection', () => {
    const s = edge();
    const mask = new Uint8Array(40 * 40);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) mask[y * 40 + x] = 255;
    const clip: MaskView = { data: mask, stride: 40, ox: 0, oy: 0, w: 40, h: 40 };
    const op = blurOp(s, ROUND, clip, 1);
    for (let i = 0; i < 4; i++) op(dab(20, 20));
    // The white side is outside the selection.
    expect(grey(s, 20, 20)).toBe(255);
    expect(grey(s, 19, 20)).toBeGreaterThan(0);
  });
});
