import type { Point } from '../core/geometry';
import { selectionOutlines, type PlacedMask } from '../doc/selectionMath';
import { corner, type SubPath } from './pathData';

/** Distance from p to the segment a–b. */
function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Ramer–Douglas–Peucker on an open polyline (the ends are kept). */
export function simplifyOpen(pts: readonly Point[], eps: number): Point[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let dist = eps;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b]);
      if (d > dist) {
        dist = d;
        far = i;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

/** The same on a closed loop: split at the point farthest from the first, simplify both halves. */
export function simplifyClosed(loop: readonly Point[], eps: number): Point[] {
  const pts = loop.length > 1 && loop[0].x === loop[loop.length - 1].x && loop[0].y === loop[loop.length - 1].y ? loop.slice(0, -1) : [...loop];
  if (pts.length <= 3) return pts;
  let far = 1;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), eps);
  const b = simplifyOpen([...pts.slice(far), pts[0]], eps);
  return [...a, ...b.slice(1, -1)];
}

/**
 * A selection's outlines as path subpaths: traced along the pixel edges, then simplified so
 * stair-steps become straight and diagonal lines (holes are separate subpaths).
 */
export function maskToSubpaths(m: PlacedMask, eps = 0.8): SubPath[] {
  return selectionOutlines(m)
    .map((loop) => simplifyClosed(loop, eps))
    .filter((pts) => pts.length >= 3)
    .map((pts) => ({ closed: true, anchors: pts.map((p) => corner(p.x, p.y)) }));
}
