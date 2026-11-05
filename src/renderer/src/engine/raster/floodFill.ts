import type { Rect } from '../core/geometry';

export interface FillResult {
  /** w×h mask (255 = fill) in image coordinates. */
  mask: Uint8Array;
  bounds: Rect | null;
  count: number;
}

export interface FillOptions {
  /** 0–100 (% of the channel range). */
  tolerance: number;
  /** false = fill every matching pixel in the image ("global"). */
  contiguous: boolean;
  /** Optional w×h clip mask (e.g. the selection); pixels with 0 are never filled. */
  clip?: Uint8Array | null;
}

/**
 * Scanline flood fill over straight-alpha RGBA. Colours are compared premultiplied, using the
 * largest channel difference, so transparent pixels match each other regardless of RGB.
 */
export function floodFill(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  sx: number,
  sy: number,
  opts: FillOptions,
): FillResult {
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, bounds: null, count: 0 };
  const clip = opts.clip ?? null;
  if (clip && clip[sy * w + sx] === 0) return { mask, bounds: null, count: 0 };

  const thr = Math.max(0, Math.min(100, opts.tolerance)) * 2.55;
  const si = (sy * w + sx) * 4;
  const sa = data[si + 3] / 255;
  const tr = data[si] * sa;
  const tg = data[si + 1] * sa;
  const tb = data[si + 2] * sa;
  const ta = data[si + 3];

  const matches = (p: number): boolean => {
    if (clip && clip[p] === 0) return false;
    const i = p * 4;
    const a = data[i + 3];
    const pa = a / 255;
    return (
      Math.abs(a - ta) <= thr &&
      Math.abs(data[i] * pa - tr) <= thr &&
      Math.abs(data[i + 1] * pa - tg) <= thr &&
      Math.abs(data[i + 2] * pa - tb) <= thr
    );
  };

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  if (!opts.contiguous) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (matches(p)) {
          mask[p] = 255;
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  } else {
    // Stack of seed points; each seed fills its whole horizontal span.
    const stack: number[] = [sx, sy];
    while (stack.length > 0) {
      const y = stack.pop()!;
      let x = stack.pop()!;
      let p = y * w + x;
      if (mask[p] || !matches(p)) continue;
      while (x > 0 && !mask[p - 1] && matches(p - 1)) {
        x--;
        p--;
      }
      let spanUp = false;
      let spanDown = false;
      const rowStart = x;
      while (x < w && !mask[p] && matches(p)) {
        mask[p] = 255;
        count++;
        if (y > 0) {
          const up = p - w;
          const m = !mask[up] && matches(up);
          if (m && !spanUp) {
            stack.push(x, y - 1);
            spanUp = true;
          } else if (!m) spanUp = false;
        }
        if (y < h - 1) {
          const dn = p + w;
          const m = !mask[dn] && matches(dn);
          if (m && !spanDown) {
            stack.push(x, y + 1);
            spanDown = true;
          } else if (!m) spanDown = false;
        }
        x++;
        p++;
      }
      if (rowStart < minX) minX = rowStart;
      if (x - 1 > maxX) maxX = x - 1;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const bounds = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
  return { mask, bounds, count };
}

/** Crop a w-wide mask to rect r (returns r.w×r.h). */
export function cropMask(mask: Uint8Array, w: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const si = (r.y + y) * w + r.x;
    out.set(mask.subarray(si, si + r.w), y * r.w);
  }
  return out;
}
