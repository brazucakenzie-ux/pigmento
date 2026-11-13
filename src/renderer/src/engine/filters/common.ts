/** Helpers shared by filters: per-pixel maps, blurs and alpha masks. */

export const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Map every pixel's colour (alpha stays). `fn` writes r, g, b into `out` (0–255 floats). */
export function mapPixels(src: Uint8ClampedArray, fn: (r: number, g: number, b: number, out: number[], i: number) => void): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.length);
  const out = [0, 0, 0];
  for (let i = 0; i < src.length; i += 4) {
    fn(src[i], src[i + 1], src[i + 2], out, i);
    dst[i] = out[0];
    dst[i + 1] = out[1];
    dst[i + 2] = out[2];
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

/** A 256-entry lookup applied to each colour channel (or one per channel). */
export function applyLut(src: Uint8ClampedArray, r: Uint8ClampedArray, g = r, b = r): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = r[src[i]];
    dst[i + 1] = g[src[i + 1]];
    dst[i + 2] = b[src[i + 2]];
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

export function lut(fn: (v: number) => number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(fn(v));
  return t;
}

export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Box sizes whose three passes approximate a gaussian of this sigma. */
function boxesFor(sigma: number): number[] {
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => Math.max(0, ((i < m ? wl : wu) - 1) / 2));
}

/** One horizontal then vertical box pass of radius r over `ch` float channels (edges clamp). */
function boxPass(a: Float32Array, b: Float32Array, w: number, h: number, ch: number, r: number): void {
  if (r <= 0) return;
  const k = 1 / (2 * r + 1);
  // Horizontal: a → b
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < ch; c++) {
      const row = y * w;
      let acc = a[row * ch + c] * (r + 1);
      for (let x = 1; x <= r; x++) acc += a[(row + Math.min(w - 1, x)) * ch + c];
      for (let x = 0; x < w; x++) {
        b[(row + x) * ch + c] = acc * k;
        acc += a[(row + Math.min(w - 1, x + r + 1)) * ch + c] - a[(row + Math.max(0, x - r)) * ch + c];
      }
    }
  }
  // Vertical: b → a
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < ch; c++) {
      let acc = b[x * ch + c] * (r + 1);
      for (let y = 1; y <= r; y++) acc += b[(Math.min(h - 1, y) * w + x) * ch + c];
      for (let y = 0; y < h; y++) {
        a[(y * w + x) * ch + c] = acc * k;
        acc += b[(Math.min(h - 1, y + r + 1) * w + x) * ch + c] - b[(Math.max(0, y - r) * w + x) * ch + c];
      }
    }
  }
}

/** Gaussian-like blur of float channels in place (three box passes). */
export function blurChannels(a: Float32Array, w: number, h: number, ch: number, sigma: number): void {
  if (sigma < 0.2) return;
  const tmp = new Float32Array(a.length);
  for (const r of boxesFor(sigma)) boxPass(a, tmp, w, h, ch, Math.round(r));
}

/** Gaussian blur of straight RGBA, done premultiplied so transparent edges don't darken. */
export function gaussianRgba(src: Uint8ClampedArray, w: number, h: number, sigma: number): Uint8ClampedArray {
  const f = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255;
    f[i] = src[i] * a;
    f[i + 1] = src[i + 1] * a;
    f[i + 2] = src[i + 2] * a;
    f[i + 3] = src[i + 3];
  }
  blurChannels(f, w, h, 4, sigma);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = f[i + 3];
    if (a <= 0.01) continue;
    const k = 255 / a;
    out[i] = f[i] * k;
    out[i + 1] = f[i + 1] * k;
    out[i + 2] = f[i + 2] * k;
    out[i + 3] = a;
  }
  return out;
}

/** The alpha channel as floats 0–1. */
export function alphaOf(src: Uint8ClampedArray): Float32Array {
  const a = new Float32Array(src.length / 4);
  for (let i = 0; i < a.length; i++) a[i] = src[i * 4 + 3] / 255;
  return a;
}

/** Lay the band's pixels over a solid colour with this per-pixel alpha (shadows, glows, outlines). */
export function overColor(src: Uint8ClampedArray, under: Float32Array, c: { r: number; g: number; b: number }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < under.length; p++) {
    const i = p * 4;
    const ta = src[i + 3] / 255;
    const ba = Math.min(1, Math.max(0, under[p])) * (1 - ta);
    const oa = ta + ba;
    if (oa <= 0) continue;
    out[i] = (src[i] * ta + c.r * ba) / oa;
    out[i + 1] = (src[i + 1] * ta + c.g * ba) / oa;
    out[i + 2] = (src[i + 2] * ta + c.b * ba) / oa;
    out[i + 3] = oa * 255;
  }
  return out;
}

/**
 * Approximate distance (px) from each pixel to the nearest pixel where `inside` holds, by a
 * two-pass chamfer transform (0 inside).
 */
export function distanceTo(inside: (p: number) => boolean, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = inside(p) ? 0 : INF;
  const A = 1;
  const B = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p];
      if (x > 0) v = Math.min(v, d[p - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[p - w] + A);
        if (x > 0) v = Math.min(v, d[p - w - 1] + B);
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + B);
      }
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p];
      if (x < w - 1) v = Math.min(v, d[p + 1] + A);
      if (y < h - 1) {
        v = Math.min(v, d[p + w] + A);
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + B);
        if (x > 0) v = Math.min(v, d[p + w - 1] + B);
      }
      d[p] = v;
    }
  }
  return d;
}

/** A repeatable pseudo-random value in [0, 1) for an image position. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
