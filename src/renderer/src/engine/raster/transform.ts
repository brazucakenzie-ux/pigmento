import type { Rect } from '../core/geometry';
import { matApplyRect, matInvert, type Mat } from '../core/matrix';

export interface ImageBuf {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export type Resample = 'nearest' | 'bilinear' | 'bicubic';

export function flipH(img: ImageBuf): ImageBuf {
  const { w, h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const s32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) d32[row + x] = s32[row + w - 1 - x];
  }
  return { w, h, data: out };
}

export function flipV(img: ImageBuf): ImageBuf {
  const { w, h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    out.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), (h - 1 - y) * rowBytes);
  }
  return { w, h, data: out };
}

/** Rotate by a multiple of 90° clockwise (1 = 90° CW, 2 = 180°, 3 = 270° CW). */
export function rotate90(img: ImageBuf, quarterTurns: number): ImageBuf {
  const q = ((quarterTurns % 4) + 4) % 4;
  if (q === 0) return { w: img.w, h: img.h, data: img.data.slice() };
  const { w, h, data } = img;
  const s32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const nw = q === 2 ? w : h;
  const nh = q === 2 ? h : w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (q === 1) {
        nx = h - 1 - y;
        ny = x;
      } else if (q === 2) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      d32[ny * nw + nx] = s32[y * w + x];
    }
  }
  return { w: nw, h: nh, data: out };
}

function cubic(x: number): number {
  // Keys cubic convolution, a = -0.5 (Catmull-Rom).
  const a = -0.5;
  x = Math.abs(x);
  if (x < 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a;
  return 0;
}

function triangle(x: number): number {
  x = Math.abs(x);
  return x < 1 ? 1 - x : 0;
}

interface Contrib {
  start: number;
  weights: Float32Array;
}

/** Filter contributions for one axis; the kernel widens when downscaling (anti-aliasing). */
function contributions(src: number, dst: number, kernel: (x: number) => number, support: number): Contrib[] {
  const scale = dst / src;
  const fscale = Math.min(1, scale);
  const sup = support / fscale;
  const out: Contrib[] = [];
  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) / scale;
    const start = Math.max(0, Math.floor(center - sup));
    const end = Math.min(src - 1, Math.ceil(center + sup));
    const weights = new Float32Array(end - start + 1);
    let sum = 0;
    for (let j = start; j <= end; j++) {
      const wgt = kernel((j + 0.5 - center) * fscale);
      weights[j - start] = wgt;
      sum += wgt;
    }
    if (sum !== 0) for (let k = 0; k < weights.length; k++) weights[k] /= sum;
    out.push({ start, weights });
  }
  return out;
}

/** Resize with the chosen filter. Works in premultiplied float to avoid dark fringes. */
export function resample(img: ImageBuf, nw: number, nh: number, method: Resample): ImageBuf {
  nw = Math.max(1, Math.round(nw));
  nh = Math.max(1, Math.round(nh));
  const { w, h, data } = img;
  if (method === 'nearest') {
    const out = new Uint8ClampedArray(nw * nh * 4);
    const s32 = new Uint32Array(data.buffer, data.byteOffset, w * h);
    const d32 = new Uint32Array(out.buffer);
    for (let y = 0; y < nh; y++) {
      const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh));
      for (let x = 0; x < nw; x++) {
        const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw));
        d32[y * nw + x] = s32[sy * w + sx];
      }
    }
    return { w: nw, h: nh, data: out };
  }
  const kernel = method === 'bicubic' ? cubic : triangle;
  const support = method === 'bicubic' ? 2 : 1;

  // Premultiply.
  const pre = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) {
    const a = data[i + 3] / 255;
    pre[i] = data[i] * a;
    pre[i + 1] = data[i + 1] * a;
    pre[i + 2] = data[i + 2] * a;
    pre[i + 3] = data[i + 3];
  }

  // Horizontal pass: w×h → nw×h.
  const cx = contributions(w, nw, kernel, support);
  const tmp = new Float32Array(nw * h * 4);
  for (let y = 0; y < h; y++) {
    const srow = y * w * 4;
    const drow = y * nw * 4;
    for (let x = 0; x < nw; x++) {
      const c = cx[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < c.weights.length; k++) {
        const wt = c.weights[k];
        const si = srow + (c.start + k) * 4;
        r += pre[si] * wt;
        g += pre[si + 1] * wt;
        b += pre[si + 2] * wt;
        a += pre[si + 3] * wt;
      }
      const di = drow + x * 4;
      tmp[di] = r;
      tmp[di + 1] = g;
      tmp[di + 2] = b;
      tmp[di + 3] = a;
    }
  }

  // Vertical pass: nw×h → nw×nh, then un-premultiply.
  const cy = contributions(h, nh, kernel, support);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const c = cy[y];
    for (let x = 0; x < nw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < c.weights.length; k++) {
        const wt = c.weights[k];
        const si = ((c.start + k) * nw + x) * 4;
        r += tmp[si] * wt;
        g += tmp[si + 1] * wt;
        b += tmp[si + 2] * wt;
        a += tmp[si + 3] * wt;
      }
      const di = (y * nw + x) * 4;
      const aa = Math.max(0, Math.min(255, a));
      if (aa > 0.5) {
        out[di] = (r * 255) / aa;
        out[di + 1] = (g * 255) / aa;
        out[di + 2] = (b * 255) / aa;
        out[di + 3] = aa;
      }
    }
  }
  return { w: nw, h: nh, data: out };
}

export interface TransformedImage extends ImageBuf {
  /** Integer position of the output's top-left in destination space. */
  x: number;
  y: number;
}

/**
 * Warp `img` by affine `m` (source pixel space → destination space). Output covers the
 * transformed bounds. Bilinear sampling in premultiplied space, or nearest for pixel art.
 */
export function affineTransform(img: ImageBuf, m: Mat, smooth: boolean, clipTo?: Rect): TransformedImage {
  const b = matApplyRect(m, { x: 0, y: 0, w: img.w, h: img.h });
  let x0 = Math.floor(b.x + 1e-6);
  let y0 = Math.floor(b.y + 1e-6);
  let x1 = Math.ceil(b.x + b.w - 1e-6);
  let y1 = Math.ceil(b.y + b.h - 1e-6);
  if (clipTo) {
    x0 = Math.max(x0, clipTo.x);
    y0 = Math.max(y0, clipTo.y);
    x1 = Math.min(x1, clipTo.x + clipTo.w);
    y1 = Math.min(y1, clipTo.y + clipTo.h);
  }
  const ow = Math.max(0, x1 - x0);
  const oh = Math.max(0, y1 - y0);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const inv = matInvert(m);
  if (!inv || ow === 0 || oh === 0) return { x: x0, y: y0, w: ow, h: oh, data: out };
  const { w, h, data } = img;
  const [ia, ib, ic, id, ie, iff] = inv;

  for (let oy = 0; oy < oh; oy++) {
    const dy = y0 + oy + 0.5;
    for (let ox = 0; ox < ow; ox++) {
      const dx = x0 + ox + 0.5;
      // Source coordinates of this destination pixel centre.
      const sx = ia * dx + ic * dy + ie;
      const sy = ib * dx + id * dy + iff;
      const di = (oy * ow + ox) * 4;
      if (!smooth) {
        const px = Math.floor(sx);
        const py = Math.floor(sy);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const si = (py * w + px) * 4;
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = data[si + 3];
        continue;
      }
      const fx = sx - 0.5;
      const fy = sy - 0.5;
      const px = Math.floor(fx);
      const py = Math.floor(fy);
      if (px < -1 || py < -1 || px >= w || py >= h) continue;
      const tx = fx - px;
      const ty = fy - py;
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const qx = px + (k & 1);
        const qy = py + (k >> 1);
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const wt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
        if (wt === 0) continue;
        const si = (qy * w + qx) * 4;
        const sa = data[si + 3] * wt;
        r += data[si] * sa;
        g += data[si + 1] * sa;
        bl += data[si + 2] * sa;
        a += sa;
      }
      if (a > 0) {
        out[di] = r / a;
        out[di + 1] = g / a;
        out[di + 2] = bl / a;
        out[di + 3] = a;
      }
    }
  }
  return { x: x0, y: y0, w: ow, h: oh, data: out };
}

/** Alpha mask → binary mask bounds helper: makes pixels outside `mask` transparent. */
export function applyMaskToImage(img: ImageBuf, mask: Uint8Array): void {
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) {
    if (mask[p] !== 255) img.data[i] = (img.data[i] * mask[p]) / 255;
  }
}

/** Make pixels matching `key` (within tolerance 0–255 per channel) transparent. */
export function keyOutColor(
  img: ImageBuf,
  key: { r: number; g: number; b: number },
  tolerance = 2,
): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (
      Math.abs(d[i] - key.r) <= tolerance &&
      Math.abs(d[i + 1] - key.g) <= tolerance &&
      Math.abs(d[i + 2] - key.b) <= tolerance
    ) {
      d[i + 3] = 0;
    }
  }
}

/** Crop/extend an image: returns nw×nh with the source placed at (ox, oy). */
export function placeImage(img: ImageBuf, nw: number, nh: number, ox: number, oy: number): ImageBuf {
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < img.h; y++) {
    const dy = y + oy;
    if (dy < 0 || dy >= nh) continue;
    const sx0 = Math.max(0, -ox);
    const sx1 = Math.min(img.w, nw - ox);
    if (sx1 <= sx0) continue;
    const si = (y * img.w + sx0) * 4;
    out.set(img.data.subarray(si, si + (sx1 - sx0) * 4), (dy * nw + sx0 + ox) * 4);
  }
  return { w: nw, h: nh, data: out };
}
