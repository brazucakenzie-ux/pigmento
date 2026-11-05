import type { Point, Rect } from './geometry';

/**
 * 2D affine matrix in DOMMatrix/Canvas order:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Mat = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Composition: the result applies `m2` first, then `m1`. */
export function matMul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** Compose left to right: matChain(A, B, C) applies A, then B, then C. */
export function matChain(...ms: Mat[]): Mat {
  return ms.reduce<Mat>((acc, m) => matMul(m, acc), IDENTITY);
}

export function matTranslate(tx: number, ty: number): Mat {
  return [1, 0, 0, 1, tx, ty];
}

export function matScale(sx: number, sy: number = sx): Mat {
  return [sx, 0, 0, sy, 0, 0];
}

export function matRotate(rad: number): Mat {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, s, -s, c, 0, 0];
}

/** Skew by angles (radians): x' = x + tan(ax)·y, y' = y + tan(ay)·x. */
export function matSkew(ax: number, ay: number): Mat {
  return [1, Math.tan(ay), Math.tan(ax), 1, 0, 0];
}

/** Matrix that applies `m` around pivot point p. */
export function matAround(m: Mat, p: Point): Mat {
  return matChain(matTranslate(-p.x, -p.y), m, matTranslate(p.x, p.y));
}

export function matDeterminant(m: Mat): number {
  return m[0] * m[3] - m[1] * m[2];
}

export function matInvert(m: Mat): Mat | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return [d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id];
}

export function matApply(m: Mat, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function matApplyPoints(m: Mat, pts: readonly Point[]): Point[] {
  return pts.map((p) => matApply(m, p.x, p.y));
}

/** Axis-aligned bounds of a rect after transformation. */
export function matApplyRect(m: Mat, r: Rect): Rect {
  const pts = [
    matApply(m, r.x, r.y),
    matApply(m, r.x + r.w, r.y),
    matApply(m, r.x + r.w, r.y + r.h),
    matApply(m, r.x, r.y + r.h),
  ];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function matIsIdentity(m: Mat, eps = 1e-9): boolean {
  return (
    Math.abs(m[0] - 1) < eps &&
    Math.abs(m[1]) < eps &&
    Math.abs(m[2]) < eps &&
    Math.abs(m[3] - 1) < eps &&
    Math.abs(m[4]) < eps &&
    Math.abs(m[5]) < eps
  );
}

/** True if the matrix is a translation by whole pixels (lossless placement). */
export function matIsIntegerTranslation(m: Mat, eps = 1e-6): boolean {
  return (
    Math.abs(m[0] - 1) < eps &&
    Math.abs(m[1]) < eps &&
    Math.abs(m[2]) < eps &&
    Math.abs(m[3] - 1) < eps &&
    Math.abs(m[4] - Math.round(m[4])) < eps &&
    Math.abs(m[5] - Math.round(m[5])) < eps
  );
}
