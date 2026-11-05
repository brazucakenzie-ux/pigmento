// Note: Uint8ClampedArray assignment already rounds to nearest; never add 0.5 before storing.
import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';

/**
 * A window onto RGBA pixel memory in document coordinates: document pixel (x, y) lives at
 * index ((y - oy) * stride + (x - ox)) * 4. Tiles, temp buffers and full images all fit this.
 */
export interface PixelView {
  data: Uint8ClampedArray;
  stride: number;
  ox: number;
  oy: number;
}

/** 8-bit coverage mask in document coordinates; samples outside w×h read as 0. */
export interface MaskView {
  data: Uint8Array;
  stride: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** How a source is combined with destination pixels. */
export type PixelOp = 'over' | 'replace' | 'erase';

export function maskAt(m: MaskView, x: number, y: number): number {
  const mx = x - m.ox;
  const my = y - m.oy;
  if (mx < 0 || my < 0 || mx >= m.w || my >= m.h) return 0;
  return m.data[my * m.stride + mx];
}

/** Source-over of a straight-alpha colour with coverage `a` (0–1) onto dst[i..i+3]. */
function over(dst: Uint8ClampedArray, i: number, r: number, g: number, b: number, sa: number): void {
  if (sa <= 0) return;
  const da = dst[i + 3] / 255;
  if (sa >= 1 || da === 0) {
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = sa * 255;
    if (sa >= 1) dst[i + 3] = 255;
    return;
  }
  const oa = sa + da * (1 - sa);
  const k = (da * (1 - sa)) / oa;
  const s = sa / oa;
  dst[i] = r * s + dst[i] * k;
  dst[i + 1] = g * s + dst[i + 1] * k;
  dst[i + 2] = b * s + dst[i + 2] * k;
  dst[i + 3] = oa * 255;
}

/**
 * Apply a solid colour through a coverage mask (and optional clip mask) inside `r`.
 * `opacity` scales coverage. Returns true if any pixel could have changed.
 */
export function applyColorMask(
  dst: PixelView,
  r: Rect,
  color: RGBA,
  mask: MaskView | null,
  op: PixelOp,
  opacity: number,
  clip?: MaskView | null,
): void {
  const ca = (color.a / 255) * opacity;
  for (let y = r.y; y < r.y + r.h; y++) {
    let di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    for (let x = r.x; x < r.x + r.w; x++, di += 4) {
      let cov = mask ? maskAt(mask, x, y) / 255 : 1;
      if (clip) cov *= maskAt(clip, x, y) / 255;
      if (cov <= 0) continue;
      const d = dst.data;
      if (op === 'erase') {
        d[di + 3] = d[di + 3] * (1 - cov * opacity);
      } else if (op === 'replace') {
        if (cov >= 1) {
          d[di] = color.r;
          d[di + 1] = color.g;
          d[di + 2] = color.b;
          d[di + 3] = color.a * opacity;
        } else {
          // Blend toward the replacement colour by coverage (straight alpha lerp).
          d[di] += (color.r - d[di]) * cov;
          d[di + 1] += (color.g - d[di + 1]) * cov;
          d[di + 2] += (color.b - d[di + 2]) * cov;
          d[di + 3] += (color.a * opacity - d[di + 3]) * cov;
        }
      } else {
        over(d, di, color.r, color.g, color.b, ca * cov);
      }
    }
  }
}

/** Composite an RGBA source view into dst inside `r`. */
export function applyImage(
  dst: PixelView,
  r: Rect,
  src: PixelView,
  op: PixelOp,
  opacity: number,
  clip?: MaskView | null,
): void {
  const d = dst.data;
  const s = src.data;
  for (let y = r.y; y < r.y + r.h; y++) {
    let di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    let si = ((y - src.oy) * src.stride + (r.x - src.ox)) * 4;
    for (let x = r.x; x < r.x + r.w; x++, di += 4, si += 4) {
      const cov = clip ? maskAt(clip, x, y) / 255 : 1;
      if (cov <= 0) continue;
      if (op === 'replace' && cov >= 1 && opacity >= 1) {
        d[di] = s[si];
        d[di + 1] = s[si + 1];
        d[di + 2] = s[si + 2];
        d[di + 3] = s[si + 3];
      } else if (op === 'erase') {
        d[di + 3] = d[di + 3] * (1 - (s[si + 3] / 255) * cov * opacity);
      } else if (op === 'replace') {
        const t = cov * opacity;
        d[di] += (s[si] - d[di]) * t;
        d[di + 1] += (s[si + 1] - d[di + 1]) * t;
        d[di + 2] += (s[si + 2] - d[di + 2]) * t;
        d[di + 3] += (s[si + 3] - d[di + 3]) * t;
      } else {
        over(d, di, s[si], s[si + 1], s[si + 2], (s[si + 3] / 255) * cov * opacity);
      }
    }
  }
}

/** Copy rect r from src view into dst view (no blending). */
export function copyRect(dst: PixelView, src: PixelView, r: Rect): void {
  const rowBytes = r.w * 4;
  for (let y = r.y; y < r.y + r.h; y++) {
    const di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    const si = ((y - src.oy) * src.stride + (r.x - src.ox)) * 4;
    dst.data.set(src.data.subarray(si, si + rowBytes), di);
  }
}

/** Fill rect r of a view with a colour (no blending). */
export function fillRectView(dst: PixelView, r: Rect, c: RGBA): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    let di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    for (let x = 0; x < r.w; x++, di += 4) {
      dst.data[di] = c.r;
      dst.data[di + 1] = c.g;
      dst.data[di + 2] = c.b;
      dst.data[di + 3] = c.a;
    }
  }
}

/** Invert RGB inside r, weighted by optional clip mask. */
export function invertView(dst: PixelView, r: Rect, clip?: MaskView | null): void {
  const d = dst.data;
  for (let y = r.y; y < r.y + r.h; y++) {
    let di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    for (let x = r.x; x < r.x + r.w; x++, di += 4) {
      const cov = clip ? maskAt(clip, x, y) / 255 : 1;
      if (cov <= 0) continue;
      if (cov >= 1) {
        d[di] = 255 - d[di];
        d[di + 1] = 255 - d[di + 1];
        d[di + 2] = 255 - d[di + 2];
      } else {
        d[di] += (255 - 2 * d[di]) * cov;
        d[di + 1] += (255 - 2 * d[di + 1]) * cov;
        d[di + 2] += (255 - 2 * d[di + 2]) * cov;
      }
    }
  }
}

/** Flatten `src` (straight alpha) over an opaque colour, in place. */
export function flattenOnto(data: Uint8ClampedArray, bg: RGBA): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = data[i] * a + bg.r * (1 - a);
    data[i + 1] = data[i + 1] * a + bg.g * (1 - a);
    data[i + 2] = data[i + 2] * a + bg.b * (1 - a);
    data[i + 3] = 255;
  }
}

export function hasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}
