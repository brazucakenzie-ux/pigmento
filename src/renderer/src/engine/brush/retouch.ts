import type { Point, Rect } from '../core/geometry';
import { rectIntersect } from '../core/geometry';
import { maskAt, type MaskView } from '../raster/pixels';
import type { Surface } from '../raster/Surface';
import { dabBounds, forEachDabPixel, type Dab, type DabShape } from './dab';

/**
 * Retouching dabs: each reads the layer's pixels under the dab and writes changed ones back
 * (smudge, blur, sharpen, clone, dodge/burn). Coverage comes from the brush tip, times the
 * selection. Pixels are blended premultiplied so transparent edges don't darken.
 */
export type DabOp = (d: Dab) => Rect | null;

interface Region {
  box: Rect;
  /** The pixels before this dab (one pixel of border for neighbourhood reads). */
  src: Uint8ClampedArray;
  sx: number;
  sy: number;
  sw: number;
  /** What gets written back. */
  out: Uint8ClampedArray;
}

function region(surface: Surface, d: Dab, border: number): Region | null {
  const box = rectIntersect(dabBounds(d), surface.bounds);
  if (!box) return null;
  const sBox = { x: box.x - border, y: box.y - border, w: box.w + border * 2, h: box.h + border * 2 };
  const src = surface.readRect(sBox);
  const out = surface.readRect(box);
  return { box, src, sx: sBox.x, sy: sBox.y, sw: sBox.w, out };
}

function write(surface: Surface, r: Region): Rect {
  surface.writeRect(r.box, { data: r.out, stride: r.box.w, ox: r.box.x, oy: r.box.y });
  return r.box;
}

/** Every covered pixel of the dab, its coverage already including the selection. */
function covered(d: Dab, shape: DabShape, box: Rect, clip: MaskView | null, fn: (x: number, y: number, cov: number) => void): void {
  forEachDabPixel(d, shape, box, (x, y, cov) => {
    const c = clip ? cov * (maskAt(clip, x, y) / 255) : cov;
    if (c > 0) fn(x, y, c);
  });
}

/** Blend premultiplied: dst = lerp(dst, src, t), both straight RGBA at index i / j. */
function mixInto(out: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number, t: number): void {
  const da = out[i + 3];
  const na = da + (a - da) * t;
  if (na <= 0) {
    out[i + 3] = 0;
    return;
  }
  out[i] = (out[i] * da + (r * a - out[i] * da) * t) / na;
  out[i + 1] = (out[i + 1] * da + (g * a - out[i + 1] * da) * t) / na;
  out[i + 2] = (out[i + 2] * da + (b * a - out[i + 2] * da) * t) / na;
  out[i + 3] = na;
}

/** Box-blurred (premultiplied) value at (x, y) from the region's source, radius r. */
function blurred(rg: Region, x: number, y: number, r: number): [number, number, number, number] {
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let pa = 0;
  let n = 0;
  for (let yy = y - r; yy <= y + r; yy++) {
    const ry = yy - rg.sy;
    if (ry < 0 || ry * rg.sw >= rg.src.length / 4) continue;
    for (let xx = x - r; xx <= x + r; xx++) {
      const rx = xx - rg.sx;
      if (rx < 0 || rx >= rg.sw) continue;
      const i = (ry * rg.sw + rx) * 4;
      const a = rg.src[i + 3];
      pr += rg.src[i] * a;
      pg += rg.src[i + 1] * a;
      pb += rg.src[i + 2] * a;
      pa += a;
      n++;
    }
  }
  if (!n || pa === 0) return [0, 0, 0, 0];
  return [pr / pa, pg / pa, pb / pa, pa / n];
}

const blurRadius = (d: Dab) => Math.max(1, Math.min(6, Math.round(d.size / 20)));

/** Blur: softens what's under the brush (repeated dabs blur more). */
export function blurOp(surface: Surface, shape: DabShape, clip: MaskView | null, strength: number): DabOp {
  return (d) => {
    const r = blurRadius(d);
    const rg = region(surface, d, r);
    if (!rg) return null;
    covered(d, shape, rg.box, clip, (x, y, cov) => {
      const [br, bg, bb, ba] = blurred(rg, x, y, r);
      mixInto(rg.out, ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4, br, bg, bb, ba, Math.min(1, strength * cov * d.alpha));
    });
    return write(surface, rg);
  };
}

/** Sharpen: pushes each pixel away from its blurred surroundings (an unsharp mask). */
export function sharpenOp(surface: Surface, shape: DabShape, clip: MaskView | null, strength: number): DabOp {
  return (d) => {
    const r = blurRadius(d);
    const rg = region(surface, d, r);
    if (!rg) return null;
    covered(d, shape, rg.box, clip, (x, y, cov) => {
      const [br, bg, bb] = blurred(rg, x, y, r);
      const i = ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4;
      const k = strength * cov * d.alpha * 0.6;
      rg.out[i] = rg.out[i] + (rg.out[i] - br) * k;
      rg.out[i + 1] = rg.out[i + 1] + (rg.out[i + 1] - bg) * k;
      rg.out[i + 2] = rg.out[i + 2] + (rg.out[i + 2] - bb) * k;
    });
    return write(surface, rg);
  };
}

/**
 * Smudge: the brush picks up the colours under it and drags them along. It keeps `strength` of
 * its colour per brush width moved (so the smear's length doesn't depend on dab spacing):
 * strength 1 keeps the first colours all the way (finger painting), lower values let the brush
 * clean itself sooner.
 */
export function smudgeOp(surface: Surface, shape: DabShape, clip: MaskView | null, strength: number): DabOp {
  /** The colours on the brush, premultiplied (so picking up transparency doesn't darken them). */
  let acc: Float32Array | null = null;
  let size = 0;
  let last: Point = { x: 0, y: 0 };
  const accAt = (d: Dab, x: number, y: number) => {
    const ax = Math.floor(x + 0.5 - d.x + size / 2);
    const ay = Math.floor(y + 0.5 - d.y + size / 2);
    return ax < 0 || ay < 0 || ax >= size || ay >= size ? -1 : (ay * size + ax) * 4;
  };
  return (d) => {
    const rg = region(surface, d, 0);
    if (!rg) return null;
    if (!acc) {
      // The first dab loads the brush with what's under it.
      size = Math.ceil(d.size) + 3;
      acc = new Float32Array(size * size * 4);
      for (let y = rg.box.y; y < rg.box.y + rg.box.h; y++) {
        for (let x = rg.box.x; x < rg.box.x + rg.box.w; x++) {
          const k = accAt(d, x, y);
          if (k < 0) continue;
          const i = ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4;
          const a = rg.out[i + 3];
          for (let c = 0; c < 3; c++) acc[k + c] = (rg.out[i + c] * a) / 255;
          acc[k + 3] = a;
        }
      }
      last = { x: d.x, y: d.y };
      return null;
    }
    const brush = acc;
    // The brush takes on some of what it paints over, more the further it has moved.
    const moved = Math.hypot(d.x - last.x, d.y - last.y) / Math.max(1, d.size);
    const keep = strength >= 1 ? 1 : Math.max(0, strength) ** moved;
    last = { x: d.x, y: d.y };
    covered(d, shape, rg.box, clip, (x, y, cov) => {
      const k = accAt(d, x, y);
      if (k < 0) return;
      const i = ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4;
      const ba = brush[k + 3];
      const un = ba > 0 ? 255 / ba : 0;
      mixInto(rg.out, i, brush[k] * un, brush[k + 1] * un, brush[k + 2] * un, ba, Math.min(1, cov * d.alpha * (0.4 + 0.6 * strength)));
      const oa = rg.out[i + 3];
      for (let c = 0; c < 3; c++) brush[k + c] = brush[k + c] * keep + ((rg.out[i + c] * oa) / 255) * (1 - keep);
      brush[k + 3] = ba * keep + oa * (1 - keep);
    });
    return write(surface, rg);
  };
}

/**
 * Clone stamp: paints the pixels from `source` (as they were when the stroke began) found at
 * the dab's position plus `offset`.
 */
export function cloneOp(surface: Surface, source: Surface, shape: DabShape, clip: MaskView | null, offset: Point, opacity: number): DabOp {
  return (d) => {
    const rg = region(surface, d, 0);
    if (!rg) return null;
    covered(d, shape, rg.box, clip, (x, y, cov) => {
      const s = source.getPixel(Math.round(x + offset.x), Math.round(y + offset.y));
      if (s.a === 0) return;
      const i = ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4;
      // Laid over what's there, like paint (so cloning onto transparency builds the copy).
      const sa = (s.a / 255) * cov * d.alpha * opacity;
      const da = rg.out[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) return;
      const kd = (da * (1 - sa)) / oa;
      const ks = sa / oa;
      rg.out[i] = s.r * ks + rg.out[i] * kd;
      rg.out[i + 1] = s.g * ks + rg.out[i + 1] * kd;
      rg.out[i + 2] = s.b * ks + rg.out[i + 2] * kd;
      rg.out[i + 3] = Math.ceil(oa * 255 - 1e-6);
    });
    return write(surface, rg);
  };
}

export const TONE_RANGES = ['shadows', 'midtones', 'highlights'] as const;
export type ToneRange = (typeof TONE_RANGES)[number];

/** How much a pixel of lightness l (0–1) is in a tonal range. */
export function toneWeight(range: ToneRange, l: number): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  if (range === 'shadows') return 1 - s(0.05, 0.6, l);
  if (range === 'highlights') return s(0.4, 0.95, l);
  return 1 - Math.min(1, Math.abs(l - 0.5) * 2) ** 2;
}

/** Dodge lightens, burn darkens, the chosen tonal range (a little per dab, building up). */
export function toneOp(surface: Surface, shape: DabShape, clip: MaskView | null, mode: 'dodge' | 'burn', range: ToneRange, exposure: number): DabOp {
  return (d) => {
    const rg = region(surface, d, 0);
    if (!rg) return null;
    covered(d, shape, rg.box, clip, (x, y, cov) => {
      const i = ((y - rg.box.y) * rg.box.w + (x - rg.box.x)) * 4;
      const o = rg.out;
      const l = (0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2]) / 255;
      const k = exposure * cov * d.alpha * toneWeight(range, l) * 0.35;
      if (k <= 0) return;
      for (let c = 0; c < 3; c++) o[i + c] = mode === 'dodge' ? o[i + c] + (255 - o[i + c]) * k : o[i + c] * (1 - k);
    });
    return write(surface, rg);
  };
}
