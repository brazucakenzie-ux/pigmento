import type { Point } from '../core/geometry';
import { edgeOf, EDGES, frameApply, frameChain, frameInvert, hingeFrame, type Edge, type Hinge } from './frames';
import type { Piece } from './piece';
import type { Scene } from './scene';
import { project, unproject } from './space';

/** Where a dragged piece would hinge if it were let go now. */
export interface EdgeSnap {
  parent: Piece;
  hinge: Hinge;
  /** The fold (radians) that keeps it as near as can be to how it lies now. */
  fold: number;
  /** The parent's edge on the canvas (document pixels), to light up. */
  line: [Point, Point];
}

/** Edges at most this far from running the other way (radians) can meet. */
const MAX_ANGLE = (25 * Math.PI) / 180;

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;

/** An edge's ends on the canvas: where it starts and where it ends (clockwise round its box), or null behind the camera. */
function edgeOnCanvas(scene: Scene, p: Piece, e: Edge): [Point, Point] | null {
  const E = edgeOf(e, p.src.width, p.src.height);
  const pl = scene.placement(p);
  const a = project(pl, E.a);
  const b = project(pl, { x: E.a.x + E.u.x * E.len, y: E.a.y + E.u.y * E.len });
  return a && b ? [a, b] : null;
}

/**
 * The edge of a piece in `targets` that one of `child`'s edges lies along on the canvas: running
 * the other way (as two faces of a box share an edge), both its ends within `reach` document
 * pixels of the other's line, and overlapping it. Lengths within `reach` of each other are made
 * equal; otherwise the child lines up with the nearer end of the parent's edge, at its own size.
 * Null when no edge is near enough.
 */
export function findSnap(scene: Scene, child: Piece, targets: readonly Piece[], reach: number): EdgeSnap | null {
  let best: { score: number; parent: Piece; edge: Edge; childEdge: Edge; line: [Point, Point]; ends: [Point, Point] } | null = null;
  const own = EDGES.map((e) => edgeOnCanvas(scene, child, e));
  for (const parent of targets) {
    if (parent === child || parent.kind !== 'piece' || !scene.shows(parent)) continue;
    for (const edge of EDGES) {
      const line = edgeOnCanvas(scene, parent, edge);
      if (!line) continue;
      const dp = sub(line[1], line[0]);
      const lp = Math.hypot(dp.x, dp.y);
      if (lp < 1e-6) continue;
      for (let i = 0; i < EDGES.length; i++) {
        const childEdge = EDGES[i];
        const ends = own[i];
        if (!ends) continue;
        const dc = sub(ends[1], ends[0]);
        const lc = Math.hypot(dc.x, dc.y);
        if (lc < 1e-6 || dot(dp, dc) / (lp * lc) > -Math.cos(MAX_ANGLE)) continue;
        // Both ends close to the parent's edge line…
        const d0 = Math.abs(cross(dp, sub(ends[0], line[0]))) / lp;
        const d1 = Math.abs(cross(dp, sub(ends[1], line[0]))) / lp;
        if (d0 > reach || d1 > reach) continue;
        // …and alongside it for a good part of the shorter one, not just touching at the ends.
        const t0 = dot(sub(ends[1], line[0]), dp) / lp;
        const t1 = dot(sub(ends[0], line[0]), dp) / lp;
        if (Math.min(t1, lp) - Math.max(t0, 0) < 0.25 * Math.min(lc, lp)) continue;
        const score = Math.max(d0, d1);
        if (!best || score < best.score) best = { score, parent, edge, childEdge, line, ends };
      }
    }
  }
  if (!best) return null;
  const { parent, edge, childEdge, line, ends } = best;
  const P = edgeOf(edge, parent.src.width, parent.src.height);
  const C = edgeOf(childEdge, child.src.width, child.src.height);
  // The child's edge ends, read on the parent's plane, as distances along the parent's edge (its pixels).
  const pl = scene.placement(parent);
  const along = (p: Point): number | null => {
    const q = pl.affine ? fromAffine(pl.affine, p) : unproject(pl, p);
    return q && (q.x - P.a.x) * P.u.x + (q.y - P.a.y) * P.u.y;
  };
  // The child's edge runs the other way: its end sits nearest the parent's edge start.
  const start = along(ends[1]);
  const end = along(ends[0]);
  if (start === null || end === null || end - start <= 1e-6) return null;
  const natural = (end - start) / C.len;
  // `reach` in the parent's own pixels, along its edge.
  const reachP = (reach * P.len) / Math.hypot(line[1].x - line[0].x, line[1].y - line[0].y);
  let hinge: Hinge;
  if (Math.abs(natural * C.len - P.len) <= reachP) hinge = { edge, childEdge, offset: 0, along: P.len / C.len, across: natural };
  else if (Math.abs(start) <= Math.abs(P.len - end)) hinge = { edge, childEdge, offset: 0, along: natural, across: natural };
  else hinge = { edge, childEdge, offset: P.len - natural * C.len, along: natural, across: natural };
  return { parent, hinge, fold: foldNow(scene, child, parent, hinge), line };
}

function fromAffine(m: readonly number[], p: Point): Point | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  const x = p.x - m[4];
  const y = p.y - m[5];
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
}

/**
 * The fold that turns the child round the parent's edge to lie as near as it can to how it lies
 * now: the way its face runs away from its edge, in the parent's own space (out from the parent,
 * and back along its normal).
 */
function foldNow(scene: Scene, child: Piece, parent: Piece, h: Hinge): number {
  const inv = frameInvert(scene.pose(parent).frame);
  if (!inv) return 0;
  const C = edgeOf(h.childEdge, child.src.width, child.src.height);
  const P = edgeOf(h.edge, parent.src.width, parent.src.height);
  const local = frameChain(inv, scene.pose(child).frame);
  const mid = { x: C.a.x + (C.u.x * C.len) / 2, y: C.a.y + (C.u.y * C.len) / 2 };
  const depth = Math.min(child.src.width, child.src.height) / 2;
  const a = frameApply(local, mid.x, mid.y);
  const b = frameApply(local, mid.x + C.v.x * depth, mid.y + C.v.y * depth);
  const out = -((b[0] - a[0]) * P.v.x + (b[1] - a[1]) * P.v.y);
  const back = b[2] - a[2];
  return Math.abs(out) < 1e-12 && Math.abs(back) < 1e-12 ? 0 : Math.atan2(back, out);
}

const OPPOSITE: Record<Edge, Edge> = { n: 's', e: 'w', s: 'n', w: 'e' };

/** The middle of a hinged piece's edge across from its hinge (its own pixels): where its fold handle is. */
export function foldHandle(piece: Piece): Point | null {
  const h = piece.link?.hinge;
  if (!h) return null;
  const E = edgeOf(OPPOSITE[h.childEdge], piece.src.width, piece.src.height);
  return { x: E.a.x + (E.u.x * E.len) / 2, y: E.a.y + (E.u.y * E.len) / 2 };
}

const STEP = (15 * Math.PI) / 180;

/**
 * The fold (radians) that brings a hinged piece's fold handle nearest canvas point p, searched
 * within half a turn either way of `near` so it carries on smoothly (`steps`: 15° steps).
 */
export function foldToward(scene: Scene, piece: Piece, p: Point, near: number, steps: boolean): number {
  const parent = scene.parentOf(piece);
  const h = piece.link?.hinge;
  const handle = foldHandle(piece);
  if (!parent || parent.kind !== 'piece' || !h || !handle) return near;
  const pf = scene.pose(parent).frame;
  const { cx, cy, f } = scene.space;
  const dist = (phi: number): number => {
    const W = frameApply(frameChain(pf, hingeFrame(parent.src.width, parent.src.height, piece.src.width, piece.src.height, h, phi)), handle.x, handle.y);
    const z = W[2] + f;
    if (!(z > f * 0.01)) return Infinity;
    return Math.hypot((f * W[0] + cx * W[2]) / z - p.x, (f * W[1] + cy * W[2]) / z - p.y);
  };
  const search = (from: number, to: number, step: number): number => {
    let best = near;
    let bestD = Infinity;
    for (let phi = from; phi <= to + 1e-12; phi += step) {
      const d = dist(phi);
      if (d < bestD) {
        bestD = d;
        best = phi;
      }
    }
    return best;
  };
  const coarse = (2 * Math.PI) / 180;
  let phi = search(near - Math.PI, near + Math.PI, coarse);
  phi = search(phi - coarse, phi + coarse, coarse / 40);
  return steps ? Math.round(phi / STEP) * STEP : phi;
}
