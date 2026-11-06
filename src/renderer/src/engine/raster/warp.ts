import type { Point, Rect } from '../core/geometry';
import { matChain, matInvert, matRotate, matScale, matTranslate, type Mat } from '../core/matrix';
import type { ImageBuf, TransformedImage } from './transform';

/**
 * Projective (four-corner) transforms for free transform. A quad lists the destination of
 * the source image's corners in order: top-left, top-right, bottom-right, bottom-left.
 */
export type Quad = readonly [Point, Point, Point, Point];

/** Row-major 3×3: x' = (h0·x + h1·y + h2) / (h6·x + h7·y + h8), y' likewise with h3…h5. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

export function rectQuad(r: Rect): Quad {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

export function quadBounds(q: Quad): Rect {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** A parallelogram: the transform is affine (no perspective). */
export function quadIsAffine(q: Quad, eps = 1e-6): boolean {
  const dx = q[0].x - q[1].x + q[2].x - q[3].x;
  const dy = q[0].y - q[1].y + q[2].y - q[3].y;
  const size = Math.max(1, quadBounds(q).w, quadBounds(q).h);
  return Math.abs(dx) <= eps * size && Math.abs(dy) <= eps * size;
}

/** Strictly convex with consistent winding (no bow-ties, no collapsed corners). */
export function quadIsConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Point inside a convex quad (either winding). */
export function quadContains(q: Quad, p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** The homography taking the w×h source rectangle onto q (Heckbert's square-to-quad). */
export function homographyFromQuad(w: number, h: number, q: Quad): Homography {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let hh = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + hh * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + hh * p3.y;
  // Unit square (u, v) → quad; then u = x / w, v = y / h.
  return [a / w, b / h, p0.x, d / w, e / h, p0.y, g / w, hh / h, 1];
}

export function applyHomography(m: Homography, x: number, y: number): Point {
  const z = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / z, y: (m[3] * x + m[4] * y + m[5]) / z };
}

export function invertHomography(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

/** Exact affine for a parallelogram quad (source pixel space → destination). */
export function quadToAffine(w: number, h: number, q: Quad): Mat {
  return [(q[1].x - q[0].x) / w, (q[1].y - q[0].y) / w, (q[3].x - q[0].x) / h, (q[3].y - q[0].y) / h, q[0].x, q[0].y];
}

/** Least-squares affine through all four corners (exact for parallelograms). */
export function fitAffine(w: number, h: number, q: Quad): Mat {
  const src: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  // Normal equations: N·[a c e]ᵀ = Σ xi'·[xi yi 1], same N for the y' row.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx = 0;
  let sy = 0;
  const rx = [0, 0, 0];
  const ry = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx += x;
    sy += y;
    rx[0] += x * q[k].x;
    rx[1] += y * q[k].x;
    rx[2] += q[k].x;
    ry[0] += x * q[k].y;
    ry[1] += y * q[k].y;
    ry[2] += q[k].y;
  }
  const n = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, 4],
  ];
  const solve = (r: number[]): [number, number, number] => {
    const det3 = (m: number[][]) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det3(n);
    const col = (j: number) => n.map((row, i) => row.map((v, k) => (k === j ? r[i] : v)));
    return [det3(col(0)) / D, det3(col(1)) / D, det3(col(2)) / D];
  };
  const [a, c, e] = solve(rx);
  const [b, d, f] = solve(ry);
  return [a, b, c, d, e, f];
}

/** What the free-transform number fields show and edit. */
export interface TransformParams {
  /** Destination of the source centre. */
  cx: number;
  cy: number;
  /** Scale along the source axes (1 = 100%); negative = flipped. */
  sx: number;
  sy: number;
  /** Rotation and horizontal skew, in radians. */
  angle: number;
  skew: number;
}

/** Decompose m = translate · rotate · skew · scale (about the source centre). */
export function paramsFromAffine(m: Mat, w: number, h: number): TransformParams {
  const [a, b, c, d, e, f] = m;
  const angle = Math.atan2(b, a);
  const sx = Math.hypot(a, b);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const p = cos * c + sin * d;
  const qy = -sin * c + cos * d;
  const sy = qy;
  const skew = Math.abs(qy) < 1e-12 ? 0 : Math.atan(p / qy);
  return { cx: a * (w / 2) + c * (h / 2) + e, cy: b * (w / 2) + d * (h / 2) + f, sx, sy, angle, skew };
}

export function affineFromParams(p: TransformParams, w: number, h: number): Mat {
  const shear: Mat = [1, 0, Math.tan(p.skew), 1, 0, 0];
  return matChain(matTranslate(-w / 2, -h / 2), matScale(p.sx, p.sy), shear, matRotate(p.angle), matTranslate(p.cx, p.cy));
}

/** Apply an affine to every corner. */
export function mapQuad(m: Mat, q: Quad): Quad {
  const f = (pt: Point): Point => ({ x: m[0] * pt.x + m[2] * pt.y + m[4], y: m[1] * pt.x + m[3] * pt.y + m[5] });
  return [f(q[0]), f(q[1]), f(q[2]), f(q[3])];
}

/** Change the transform's numeric parameters, keeping any perspective it has. */
export function quadWithParams(q: Quad, w: number, h: number, change: Partial<TransformParams>): Quad {
  const before = fitAffine(w, h, q);
  const inv = matInvert(before);
  if (!inv) return q;
  const after = affineFromParams({ ...paramsFromAffine(before, w, h), ...change }, w, h);
  return mapQuad(matChain(inv, after), q);
}

/**
 * Warp `img` onto quad `q` with a projective transform: bilinear sampling in premultiplied
 * space (nearest when `smooth` is false). Output covers the quad's bounds (∩ clipTo).
 */
export function perspectiveWarp(img: ImageBuf, q: Quad, smooth: boolean, clipTo?: Rect): TransformedImage {
  const b = quadBounds(q);
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
  const { w, h, data } = img;
  const inv = invertHomography(homographyFromQuad(w, h, q));
  if (!inv || ow === 0 || oh === 0) return { x: x0, y: y0, w: ow, h: oh, data: out };
  const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inv;
  // Pixels beyond the vanishing line map "behind" the viewer; the quad's centre shows which side is real.
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const side = Math.sign(i6 * cx + i7 * cy + i8);

  for (let oy = 0; oy < oh; oy++) {
    const dy = y0 + oy + 0.5;
    for (let ox = 0; ox < ow; ox++) {
      const dx = x0 + ox + 0.5;
      const z = i6 * dx + i7 * dy + i8;
      if (Math.sign(z) !== side) continue;
      const sx = (i0 * dx + i1 * dy + i2) / z;
      const sy = (i3 * dx + i4 * dy + i5) / z;
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
