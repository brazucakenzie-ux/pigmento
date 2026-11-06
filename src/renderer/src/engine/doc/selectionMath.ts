import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Point, type Rect } from '../core/geometry';

/**
 * Pure mask operations behind selections. A mask is a coverage map (0–255) placed at integer
 * bounds in document space; 128 and up counts as "inside" for outlines and hit tests.
 */
export interface PlacedMask {
  bounds: Rect;
  mask: Uint8Array;
}

export type SelectionMode = 'replace' | 'add' | 'subtract' | 'intersect';

export const SELECTION_MODES: readonly SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

const INSIDE = 128;

function coverageAt(m: PlacedMask, x: number, y: number): number {
  const lx = x - m.bounds.x;
  const ly = y - m.bounds.y;
  if (lx < 0 || ly < 0 || lx >= m.bounds.w || ly >= m.bounds.h) return 0;
  return m.mask[ly * m.bounds.w + lx];
}

/** Copy `m` into a larger (or equal) area `r`, zero elsewhere. */
function placeInto(m: PlacedMask, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  const c = rectIntersect(m.bounds, r);
  if (!c) return out;
  for (let y = c.y; y < c.y + c.h; y++) {
    const si = (y - m.bounds.y) * m.bounds.w + (c.x - m.bounds.x);
    out.set(m.mask.subarray(si, si + c.w), (y - r.y) * r.w + (c.x - r.x));
  }
  return out;
}

/**
 * Combine the current selection `a` with a new one `b`. Soft masks use fuzzy logic:
 * add = max, intersect = min, subtract = min(a, 255 − b).
 */
export function combineMasks(a: PlacedMask | null, b: PlacedMask | null, mode: SelectionMode): PlacedMask | null {
  if (mode === 'replace') return b;
  if (mode === 'add') {
    if (!a) return b;
    if (!b) return a;
    const r = rectUnion(a.bounds, b.bounds)!;
    const out = placeInto(a, r);
    const c = rectIntersect(b.bounds, r)!;
    for (let y = c.y; y < c.y + c.h; y++) {
      let di = (y - r.y) * r.w + (c.x - r.x);
      let si = (y - b.bounds.y) * b.bounds.w + (c.x - b.bounds.x);
      for (let x = 0; x < c.w; x++, di++, si++) if (b.mask[si] > out[di]) out[di] = b.mask[si];
    }
    return { bounds: r, mask: out };
  }
  if (!a) return null;
  if (mode === 'intersect') {
    if (!b) return null;
    const r = rectIntersect(a.bounds, b.bounds);
    if (!r) return null;
    const out = placeInto(a, r);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = y * r.w + x;
        const v = coverageAt(b, r.x + x, r.y + y);
        if (v < out[i]) out[i] = v;
      }
    }
    return { bounds: r, mask: out };
  }
  // subtract
  if (!b) return a;
  const out = a.mask.slice();
  const r = a.bounds;
  const c = rectIntersect(r, b.bounds);
  if (c) {
    for (let y = c.y; y < c.y + c.h; y++) {
      let di = (y - r.y) * r.w + (c.x - r.x);
      let si = (y - b.bounds.y) * b.bounds.w + (c.x - b.bounds.x);
      for (let x = 0; x < c.w; x++, di++, si++) {
        const keep = 255 - b.mask[si];
        if (keep < out[di]) out[di] = keep;
      }
    }
  }
  return { bounds: { ...r }, mask: out };
}

/** Smallest bounds holding every non-zero pixel, or null when the mask is empty. */
export function tighten(m: PlacedMask): PlacedMask | null {
  const { w, h } = m.bounds;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (m.mask[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return m;
  const nb = { x: m.bounds.x + x0, y: m.bounds.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const nm = new Uint8Array(nb.w * nb.h);
  for (let y = 0; y < nb.h; y++) {
    const si = (y + y0) * w + x0;
    nm.set(m.mask.subarray(si, si + nb.w), y * nb.w);
  }
  return { bounds: nb, mask: nm };
}

// ---- shapes ---------------------------------------------------------------------------

/** Anti-aliased ellipse inscribed in `r` (4 sub-rows per pixel, exact horizontal coverage). */
export function ellipseMask(r: Rect, docW: number, docH: number): PlacedMask | null {
  if (r.w <= 0 || r.h <= 0) return null;
  const b = rectIntersect({ x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.x + r.w) - Math.floor(r.x), h: Math.ceil(r.y + r.h) - Math.floor(r.y) }, { x: 0, y: 0, w: docW, h: docH });
  if (!b) return null;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const SUB = 4;
  const acc = new Float32Array(b.w);
  const mask = new Uint8Array(b.w * b.h);
  for (let row = 0; row < b.h; row++) {
    acc.fill(0);
    for (let s = 0; s < SUB; s++) {
      const y = b.y + row + (s + 0.5) / SUB;
      const t = (y - cy) / ry;
      if (t <= -1 || t >= 1) continue;
      const half = rx * Math.sqrt(1 - t * t);
      const xa = cx - half - b.x;
      const xb = cx + half - b.x;
      const i0 = Math.max(0, Math.floor(xa));
      const i1 = Math.min(b.w - 1, Math.floor(xb));
      for (let i = i0; i <= i1; i++) {
        const cover = Math.min(i + 1, xb) - Math.max(i, xa);
        if (cover > 0) acc[i] += cover / SUB;
      }
    }
    for (let i = 0; i < b.w; i++) mask[row * b.w + i] = Math.round(Math.min(1, acc[i]) * 255);
  }
  return tighten({ bounds: b, mask });
}

/** Polygon approximating the ellipse inscribed in r (for marching ants). */
export function ellipseOutline(r: Rect): Point[] {
  const rx = r.w / 2;
  const ry = r.h / 2;
  const n = Math.max(24, Math.min(720, Math.round((Math.PI * (rx + ry)) / 3)));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: r.x + rx + rx * Math.cos(a), y: r.y + ry + ry * Math.sin(a) });
  }
  return pts;
}

// ---- outlines -------------------------------------------------------------------------

const RIGHT = 1;
const DOWN = 2;
const LEFT = 4;
const UP = 8;
/** Steps per direction bit, indexed by the bit value. */
const DX = [0, 1, 0, 0, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, 0, 0, 0, 0, 0, -1];
/** Clockwise order on screen (y down), so "turn right" is the next entry. */
const CW = [RIGHT, DOWN, LEFT, UP];
const CW_INDEX = [0, 0, 1, 0, 2, 0, 0, 0, 3];

/**
 * Closed outlines along the pixel edges between inside (≥ 128) and outside pixels, in
 * document coordinates, with collinear steps merged. Inside is on the right of each loop;
 * diagonal neighbours count as separate regions.
 */
export function traceOutlines(m: PlacedMask): Point[][] {
  const { x: ox, y: oy, w, h } = m.bounds;
  const mask = m.mask;
  const W = w + 1;
  const out = new Uint8Array(W * (h + 1));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= INSIDE;
  let edges = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] < INSIDE) continue;
      if (!inside(x, y - 1)) {
        out[y * W + x] |= RIGHT;
        edges++;
      }
      if (!inside(x + 1, y)) {
        out[y * W + x + 1] |= DOWN;
        edges++;
      }
      if (!inside(x, y + 1)) {
        out[(y + 1) * W + x + 1] |= LEFT;
        edges++;
      }
      if (!inside(x - 1, y)) {
        out[(y + 1) * W + x] |= UP;
        edges++;
      }
    }
  }
  const loops: Point[][] = [];
  if (edges === 0) return loops;
  for (let start = 0; start < out.length; start++) {
    while (out[start]) {
      let vx = start % W;
      let vy = (start - vx) / W;
      const sx = vx;
      const sy = vy;
      const first = out[start];
      let dir = first & RIGHT ? RIGHT : first & DOWN ? DOWN : first & LEFT ? LEFT : UP;
      const pts: Point[] = [{ x: ox + vx, y: oy + vy }];
      for (;;) {
        out[vy * W + vx] &= ~dir;
        vx += DX[dir];
        vy += DY[dir];
        if (vx === sx && vy === sy) break;
        const here = out[vy * W + vx];
        // Prefer a right turn (keeps diagonal regions apart), then straight, then left.
        const ci = CW_INDEX[dir];
        const right = CW[(ci + 1) & 3];
        const left = CW[(ci + 3) & 3];
        const next = here & right ? right : here & dir ? dir : here & left ? left : 0;
        if (next === 0) break;
        if (next !== dir) pts.push({ x: ox + vx, y: oy + vy });
        dir = next;
      }
      if (pts.length >= 3) loops.push(pts);
    }
  }
  return loops;
}

/** Edge count beyond which marching ants are traced from a coarser copy of the mask. */
export const MAX_OUTLINE_EDGES = 250_000;

/** Number of pixel edges between inside and outside (an upper bound on outline points). */
function countEdges(m: PlacedMask): number {
  const { w, h } = m.bounds;
  const mask = m.mask;
  let n = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const inside = mask[row + x] >= INSIDE;
      if ((x === 0 ? false : mask[row + x - 1] >= INSIDE) !== inside) n++;
      if ((y === 0 ? false : mask[row - w + x] >= INSIDE) !== inside) n++;
    }
    if (mask[row + w - 1] >= INSIDE) n++;
  }
  for (let x = 0; x < w; x++) if (mask[(h - 1) * w + x] >= INSIDE) n++;
  return n;
}

/** Average coverage over k×k blocks (the block grid starts at the mask's top-left). */
function downsample(m: PlacedMask, k: number): PlacedMask {
  const { w, h } = m.bounds;
  const cw = Math.ceil(w / k);
  const ch = Math.ceil(h / k);
  const out = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let sum = 0;
      let count = 0;
      for (let y = cy * k; y < Math.min(h, cy * k + k); y++) {
        for (let x = cx * k; x < Math.min(w, cx * k + k); x++) {
          sum += m.mask[y * w + x];
          count++;
        }
      }
      out[cy * cw + cx] = Math.round(sum / count);
    }
  }
  return { bounds: { x: 0, y: 0, w: cw, h: ch }, mask: out };
}

/**
 * Outlines for marching ants. Very busy masks (speckled magic-wand results on photos) would
 * mean millions of points per frame, so above `maxEdges` they're traced from a coarser copy;
 * the selection mask itself is unchanged.
 */
export function selectionOutlines(m: PlacedMask, maxEdges = MAX_OUTLINE_EDGES): Point[][] {
  if (countEdges(m) <= maxEdges) return traceOutlines(m);
  let k = 2;
  let coarse = downsample(m, k);
  while (countEdges(coarse) > maxEdges && k < 256) {
    k *= 2;
    coarse = downsample(m, k);
  }
  const { x: ox, y: oy, w, h } = m.bounds;
  return traceOutlines(coarse).map((loop) =>
    loop.map((p) => ({ x: ox + Math.min(w, p.x * k), y: oy + Math.min(h, p.y * k) })),
  );
}

// ---- modify: grow, shrink, feather, border --------------------------------------------

/**
 * Expand `m` by `pad` pixels on every side. Outside the document, the mask is either empty
 * (`edges`: the canvas edge is a selection edge) or continues the edge pixels (it isn't).
 */
function padded(m: PlacedMask, pad: number, docW: number, docH: number, edges: boolean): PlacedMask {
  const r = { x: m.bounds.x - pad, y: m.bounds.y - pad, w: m.bounds.w + 2 * pad, h: m.bounds.h + 2 * pad };
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const dy = r.y + y;
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x;
      const inDoc = dx >= 0 && dy >= 0 && dx < docW && dy < docH;
      if (inDoc) out[y * r.w + x] = coverageAt(m, dx, dy);
      else if (!edges) out[y * r.w + x] = coverageAt(m, Math.min(docW - 1, Math.max(0, dx)), Math.min(docH - 1, Math.max(0, dy)));
    }
  }
  return { bounds: r, mask: out };
}

/** Clip to the document and drop empty edges. */
function finish(m: PlacedMask, docW: number, docH: number): PlacedMask | null {
  const c = rectIntersect(m.bounds, { x: 0, y: 0, w: docW, h: docH });
  if (!c) return null;
  return tighten({ bounds: c, mask: placeInto(m, c) });
}

/** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Distance from each pixel centre to the nearest pixel where `feature` is true. */
function distanceTo(w: number, h: number, feature: (i: number) => boolean): Float64Array {
  const BIG = 1e20;
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = feature(i) ? 0 : BIG;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]);
  }
  return g;
}

/** Select everything within `r` px of the selection (round corners, 1 px soft edge). */
export function growMask(m: PlacedMask, r: number, docW: number, docH: number): PlacedMask | null {
  if (r <= 0) return m;
  const p = padded(m, Math.ceil(r) + 1, docW, docH, true);
  const { w, h } = p.bounds;
  const dist = distanceTo(w, h, (i) => p.mask[i] >= INSIDE);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const grown = Math.round(Math.max(0, Math.min(1, r + 1 - dist[i])) * 255);
    out[i] = Math.max(p.mask[i], grown);
  }
  return finish({ bounds: p.bounds, mask: out }, docW, docH);
}

/** Drop everything within `r` px of the selection's edge. */
export function shrinkMask(m: PlacedMask, r: number, docW: number, docH: number, edges: boolean): PlacedMask | null {
  if (r <= 0) return m;
  const p = padded(m, 1, docW, docH, edges);
  const { w, h } = p.bounds;
  const dist = distanceTo(w, h, (i) => p.mask[i] < INSIDE);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (p.mask[i] < INSIDE) continue;
    out[i] = Math.round(Math.max(0, Math.min(1, dist[i] - r)) * 255);
  }
  return finish({ bounds: p.bounds, mask: out }, docW, docH);
}

/** Three box blurs ≈ a Gaussian (σ ≈ r / 2) along one axis, clamping at the buffer edges. */
function boxBlur(src: Float32Array, dst: Float32Array, w: number, h: number, radius: number, horizontal: boolean): void {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  const norm = 1 / (2 * radius + 1);
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l;
    const at = (i: number) => src[base + Math.min(len - 1, Math.max(0, i)) * step];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += at(i);
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = sum * norm;
      sum += at(i + radius + 1) - at(i - radius);
    }
  }
}

/** Soften the selection edge over about `r` px on each side. */
export function featherMask(m: PlacedMask, r: number, docW: number, docH: number, edges: boolean): PlacedMask | null {
  if (r <= 0) return m;
  const p = padded(m, Math.ceil(r * 1.5) + 2, docW, docH, edges);
  const { w, h } = p.bounds;
  const a = Float32Array.from(p.mask);
  const b = new Float32Array(w * h);
  // Box widths for three passes approximating a Gaussian with σ = r / 2.
  const sigma = r / 2;
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  const box = Math.max(0, Math.round((ideal - 1) / 2));
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(a, b, w, h, box, true);
    boxBlur(b, a, w, h, box, false);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.round(Math.max(0, Math.min(255, a[i])));
  return finish({ bounds: p.bounds, mask: out }, docW, docH);
}

/** A band `width` px wide centred on the selection edge. */
export function borderMask(m: PlacedMask, width: number, docW: number, docH: number, edges: boolean): PlacedMask | null {
  if (width <= 0) return null;
  const outer = growMask(m, width / 2, docW, docH);
  const inner = shrinkMask(m, width / 2, docW, docH, edges);
  const band = combineMasks(outer, inner, 'subtract');
  return band ? tighten(band) : null;
}

// ---- colour range ---------------------------------------------------------------------

/**
 * Pixels close to `target` anywhere in the w×h image. Compared like the fill tool (largest
 * premultiplied channel difference); fully inside up to half the tolerance, then fading out.
 */
export function colorRangeMask(data: Uint8ClampedArray, w: number, h: number, target: RGBA, tolerance: number): PlacedMask | null {
  const thr = Math.max(0, Math.min(100, tolerance)) * 2.55;
  const ta = target.a / 255;
  const tr = target.r * ta;
  const tg = target.g * ta;
  const tb = target.b * ta;
  const mask = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    const a = data[i + 3];
    const pa = a / 255;
    const diff = Math.max(Math.abs(a - target.a), Math.abs(data[i] * pa - tr), Math.abs(data[i + 1] * pa - tg), Math.abs(data[i + 2] * pa - tb));
    if (thr === 0) {
      if (diff < 0.5) mask[p] = 255;
    } else if (diff <= thr) {
      mask[p] = Math.round(Math.min(1, (2 * (thr - diff)) / thr) * 255);
    }
  }
  return tighten({ bounds: { x: 0, y: 0, w, h }, mask });
}
