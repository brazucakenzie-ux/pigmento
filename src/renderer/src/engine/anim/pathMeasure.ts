import type { Point } from '../core/geometry';
import { segmentsOf, type SubPath } from '../vector/pathData';

/**
 * A path measured along its length, for pieces that follow it: a point (and the direction) at
 * any share of the way along, the same distance apart for the same step, so a piece following it
 * at an even progress moves at an even speed. Bézier segments are walked as many short straight
 * pieces, fine enough that the difference doesn't show.
 */
export interface PathMeasure {
  /** Length in document pixels. */
  readonly length: number;
  readonly closed: boolean;
  /** The point at `t` of the way along (0 = the start, 1 = the end). A closed path goes round again past 1 or below 0; an open one stops at its ends. */
  at(t: number): Point;
  /** The direction of travel at `t` (radians, 0 = right, clockwise on the canvas), or null on a path with no length. */
  direction(t: number): number | null;
  /** How far along (0 … 1) the path comes nearest to p; on a closed path, the turn nearest `near` (so dragging keeps going round). */
  nearest(p: Point, near?: number): number;
}

/** Steps a Bézier segment is walked in, at most (fewer for short ones). */
const MAX_STEPS = 64;

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

/** Measure one subpath (null when it has fewer than two anchors). */
export function measurePath(sub: SubPath): PathMeasure | null {
  const a = sub.anchors;
  if (a.length < 2) return null;
  const xs: number[] = [a[0].x];
  const ys: number[] = [a[0].y];
  for (const [i, j] of segmentsOf(sub)) {
    const p = a[i];
    const q = a[j];
    const c1 = p.out ?? p;
    const c2 = q.in ?? q;
    const straight = c1.x === p.x && c1.y === p.y && c2.x === q.x && c2.y === q.y;
    // Roughly how long it is (the control polygon), for the number of steps.
    const hull = Math.hypot(c1.x - p.x, c1.y - p.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(q.x - c2.x, q.y - c2.y);
    const steps = straight ? 1 : Math.max(4, Math.min(MAX_STEPS, Math.ceil(hull / 4)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      xs.push(cubic(p.x, c1.x, c2.x, q.x, t));
      ys.push(cubic(p.y, c1.y, c2.y, q.y, t));
    }
  }
  return fromPolyline(xs, ys, sub.closed);
}

/** A measure of the polyline through (xs[i], ys[i]); a closed one comes back to its start. */
export function fromPolyline(xs: readonly number[], ys: readonly number[], closed: boolean): PathMeasure {
  const n = xs.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  const length = cum[n - 1];
  /** The share of the way along (0 … 1) that `t` means on this path. */
  const wrap = (t: number): number => {
    if (!Number.isFinite(t)) return 0;
    if (closed) return t - Math.floor(t);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
  /** The step the distance d falls in, and how far along it. */
  const locate = (d: number): { i: number; f: number } => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    return { i: lo, f: span > 0 ? (d - cum[lo]) / span : 0 };
  };
  const at = (t: number): Point => {
    if (length <= 0) return { x: xs[0], y: ys[0] };
    const { i, f } = locate(wrap(t) * length);
    const j = Math.min(n - 1, i + 1);
    return { x: xs[i] + (xs[j] - xs[i]) * f, y: ys[i] + (ys[j] - ys[i]) * f };
  };
  const direction = (t: number): number | null => {
    if (length <= 0) return null;
    // The step under t, or the nearest one with any length (corners take the step after them).
    let { i } = locate(wrap(t) * length);
    if (!closed && wrap(t) >= 1) i = n - 2;
    for (let k = 0; k < n - 1; k++) {
      const s = (i + k) % (n - 1);
      const dx = xs[s + 1] - xs[s];
      const dy = ys[s + 1] - ys[s];
      if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx);
    }
    return null;
  };
  const nearest = (p: Point, near = 0): number => {
    if (length <= 0) return 0;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i + 1 < n; i++) {
      const dx = xs[i + 1] - xs[i];
      const dy = ys[i + 1] - ys[i];
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - xs[i]) * dx + (p.y - ys[i]) * dy) / len2)) : 0;
      const d = Math.hypot(xs[i] + dx * u - p.x, ys[i] + dy * u - p.y);
      if (d < bestD) {
        bestD = d;
        best = (cum[i] + (cum[i + 1] - cum[i]) * u) / length;
      }
    }
    // Round a closed path, the turn nearest where it was.
    return closed ? best + Math.round(near - best) : best;
  };
  return { length, closed, at, direction, nearest };
}
