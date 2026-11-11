import type { Mask } from './tips';

/**
 * Making brush tips and grain textures from pictures (a selection, an imported PNG), and the
 * Brush Designer's small tip editor. Masks are greyscale: 0 = nothing, 255 = full.
 */
export interface RgbaImage {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** Largest side of a tip made from a picture (big dabs scale it up smoothly). */
export const MAX_TIP_SIZE = 256;
/** Largest side of a grain texture (it repeats across the image). */
export const MAX_TEXTURE_SIZE = 512;
/** The tip editor's grid. */
export const TIP_EDITOR_SIZE = 48;

/** Luminance (0–255) of a pixel laid over white. */
function lumOverWhite(d: RgbaImage['data'], i: number): number {
  const a = d[i + 3] / 255;
  const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return l * a + 255 * (1 - a);
}

function hasTransparency(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return true;
  return false;
}

/**
 * A tip from a picture. `dark`: dark paints (the picture laid over white, as a selection of a
 * drawing). `alpha`: a PNG with transparency gives its alpha; an opaque one, dark paints. The
 * result is cropped to what paints, centred in a square and at most `MAX_TIP_SIZE` across.
 * Null when nothing would paint.
 */
export function tipFromImage(img: RgbaImage, rule: 'dark' | 'alpha'): Mask | null {
  const useAlpha = rule === 'alpha' && hasTransparency(img);
  const data = new Uint8Array(img.w * img.h);
  for (let p = 0; p < data.length; p++) data[p] = useAlpha ? img.data[p * 4 + 3] : Math.round(255 - lumOverWhite(img.data, p * 4));
  const cropped = cropMask({ w: img.w, h: img.h, data }, 4);
  if (!cropped) return null;
  return fitMask(padSquare(cropped), MAX_TIP_SIZE);
}

/** A grain texture from a picture: light parts catch paint, dark parts don't. */
export function textureFromImage(img: RgbaImage): Mask {
  const data = new Uint8Array(img.w * img.h);
  for (let p = 0; p < data.length; p++) data[p] = Math.round(lumOverWhite(img.data, p * 4));
  return fitMask({ w: img.w, h: img.h, data }, MAX_TEXTURE_SIZE);
}

/** The smallest box holding every value above `threshold`, or null if there is none. */
export function cropMask(m: Mask, threshold = 0): Mask | null {
  let x0 = m.w;
  let y0 = m.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.data[y * m.w + x] <= threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) data.set(m.data.subarray((y0 + y) * m.w + x0, (y0 + y) * m.w + x0 + w), y * w);
  return { w, h, data };
}

/** Centred in a square (dabs are square boxes, so a tip keeps its proportions). */
export function padSquare(m: Mask): Mask {
  const s = Math.max(m.w, m.h);
  if (m.w === s && m.h === s) return m;
  const data = new Uint8Array(s * s);
  const ox = Math.floor((s - m.w) / 2);
  const oy = Math.floor((s - m.h) / 2);
  for (let y = 0; y < m.h; y++) data.set(m.data.subarray(y * m.w, (y + 1) * m.w), (oy + y) * s + ox);
  return { w: s, h: s, data };
}

/** Scaled (area average when shrinking, nearest when growing) to w×h. */
export function resizeMask(m: Mask, w: number, h: number): Mask {
  if (w === m.w && h === m.h) return m;
  const data = new Uint8Array(w * h);
  const sx = m.w / w;
  const sy = m.h / h;
  for (let y = 0; y < h; y++) {
    const ya = y * sy;
    const yb = Math.max(ya + 1e-9, (y + 1) * sy);
    for (let x = 0; x < w; x++) {
      const xa = x * sx;
      const xb = Math.max(xa + 1e-9, (x + 1) * sx);
      let sum = 0;
      let area = 0;
      for (let yy = Math.floor(ya); yy < Math.min(m.h, Math.ceil(yb)); yy++) {
        const fy = Math.min(yb, yy + 1) - Math.max(ya, yy);
        for (let xx = Math.floor(xa); xx < Math.min(m.w, Math.ceil(xb)); xx++) {
          const f = fy * (Math.min(xb, xx + 1) - Math.max(xa, xx));
          sum += m.data[yy * m.w + xx] * f;
          area += f;
        }
      }
      data[y * w + x] = area > 0 ? Math.round(sum / area) : 0;
    }
  }
  return { w, h, data };
}

/** No side longer than `max` (proportions kept). */
export function fitMask(m: Mask, max: number): Mask {
  const k = max / Math.max(m.w, m.h);
  if (k >= 1) return m;
  return resizeMask(m, Math.max(1, Math.round(m.w * k)), Math.max(1, Math.round(m.h * k)));
}

export function invertMask(m: Mask): Mask {
  const data = new Uint8Array(m.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 255 - m.data[i];
  return { w: m.w, h: m.h, data };
}

/** A light 3×3 blur (softens a drawn tip's edges). */
export function softenMask(m: Mask): Mask {
  const data = new Uint8Array(m.data.length);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      let sum = 0;
      let wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const wt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          // Outside the grid counts as empty, so edges fade out.
          sum += xx < 0 || yy < 0 || xx >= m.w || yy >= m.h ? 0 : m.data[yy * m.w + xx] * wt;
          wsum += wt;
        }
      }
      data[y * m.w + x] = Math.round(sum / wsum);
    }
  }
  return { w: m.w, h: m.h, data };
}

/** Paint (value 255) or erase (0) a round spot of `radius` cells on the tip editor's grid. */
export function paintMask(m: Mask, cx: number, cy: number, radius: number, value: number): Mask {
  const data = new Uint8Array(m.data);
  const r = Math.max(0.5, radius);
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) data[y * m.w + x] = value;
    }
  }
  return { w: m.w, h: m.h, data };
}

/** A mask the tip editor starts from: an existing one fitted to its grid, or empty. */
export function editorMask(from: Mask | null): Mask {
  const n = TIP_EDITOR_SIZE;
  if (!from) return { w: n, h: n, data: new Uint8Array(n * n) };
  return resizeMask(padSquare(from), n, n);
}
