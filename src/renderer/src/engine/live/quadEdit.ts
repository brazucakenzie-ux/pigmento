import type { Point } from '../core/geometry';
import { matChain, matInvert, matRotate, matScale, matTranslate } from '../core/matrix';
import { applyHomography, fitAffine, homographyFromQuad, mapQuad, quadIsConvex, type Quad } from '../raster/warp';

/**
 * Pure editing operations for free transform: each takes the quad at the start of a drag
 * and the pointer, and returns the new quad (or the start quad when the edit would fold it).
 */
export type QuadHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type TransformMode = 'free' | 'skew' | 'distort' | 'perspective';

/** Corner indices (TL, TR, BR, BL) of each handle. */
const CORNER: Partial<Record<QuadHandle, number>> = { nw: 0, ne: 1, se: 2, sw: 3 };
const EDGE: Partial<Record<QuadHandle, [number, number]>> = { n: [0, 1], e: [1, 2], s: [3, 2], w: [0, 3] };

/** Handle position in source space (0…w, 0…h). */
const LOCAL: Record<QuadHandle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

export const QUAD_HANDLES = Object.keys(LOCAL) as QuadHandle[];

export function isCorner(h: QuadHandle): boolean {
  return CORNER[h] !== undefined;
}

/** Where a handle sits on the quad (corners, or the midpoint of an edge). */
export function handlePoint(q: Quad, h: QuadHandle): Point {
  const c = CORNER[h];
  if (c !== undefined) return q[c];
  const [i, j] = EDGE[h]!;
  return { x: (q[i].x + q[j].x) / 2, y: (q[i].y + q[j].y) / 2 };
}

/** Destination of the source centre (the visual centre, also for perspective quads). */
export function quadCentre(q: Quad, w: number, h: number): Point {
  return applyHomography(homographyFromQuad(w, h, q), w / 2, h / 2);
}

const valid = (start: Quad, next: Quad): Quad => (quadIsConvex(next) ? next : start);

export function moveQuad(start: Quad, dx: number, dy: number): Quad {
  return [
    { x: start[0].x + dx, y: start[0].y + dy },
    { x: start[1].x + dx, y: start[1].y + dy },
    { x: start[2].x + dx, y: start[2].y + dy },
    { x: start[3].x + dx, y: start[3].y + dy },
  ];
}

/**
 * Scale by dragging a handle, in the transform's own frame (so a rotated image scales along
 * its sides). Shift keeps the proportions; Alt scales about the centre.
 */
export function scaleQuad(start: Quad, w: number, h: number, handle: QuadHandle, p: Point, mods: { shift: boolean; alt: boolean }): Quad {
  const a0 = fitAffine(w, h, start);
  const inv = matInvert(a0);
  if (!inv) return start;
  const local = { x: inv[0] * p.x + inv[2] * p.y + inv[4], y: inv[1] * p.x + inv[3] * p.y + inv[5] };
  const [ux, uy] = LOCAL[handle];
  const hx = ux * w;
  const hy = uy * h;
  const ax = mods.alt ? w / 2 : w - hx;
  const ay = mods.alt ? h / 2 : h - hy;
  const movesX = ux !== 0.5;
  const movesY = uy !== 0.5;
  let fx = movesX ? (local.x - ax) / (hx - ax) : 1;
  let fy = movesY ? (local.y - ay) / (hy - ay) : 1;
  if (mods.shift) {
    if (movesX && movesY) {
      const m = Math.max(Math.abs(fx), Math.abs(fy));
      fx = Math.sign(fx || 1) * m;
      fy = Math.sign(fy || 1) * m;
    } else if (movesX) fy = Math.abs(fx);
    else fx = Math.abs(fy);
  }
  // Never collapse to zero width or height.
  const minF = 1 / Math.max(w, h);
  if (Math.abs(fx) < minF) fx = Math.sign(fx || 1) * minF;
  if (Math.abs(fy) < minF) fy = Math.sign(fy || 1) * minF;
  // Shift without a corner keeps the other axis centred.
  const pivot = { x: movesX ? ax : w / 2, y: movesY ? ay : h / 2 };
  const d = matChain(inv, matTranslate(-pivot.x, -pivot.y), matScale(fx, fy), matTranslate(pivot.x, pivot.y), a0);
  return valid(start, mapQuad(d, start));
}

/** Rotate about the centre by the pointer's angle change; Shift snaps to 15° steps. */
export function rotateQuad(start: Quad, w: number, h: number, from: Point, to: Point, snap: boolean): Quad {
  const c = quadCentre(start, w, h);
  let delta = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x);
  if (snap) {
    const step = Math.PI / 12;
    delta = Math.round(delta / step) * step;
  }
  return mapQuad(matChain(matTranslate(-c.x, -c.y), matRotate(delta), matTranslate(c.x, c.y)), start);
}

/** Move one corner freely. */
export function distortCorner(start: Quad, corner: number, dx: number, dy: number): Quad {
  const next = start.map((pt, i) => (i === corner ? { x: pt.x + dx, y: pt.y + dy } : { ...pt })) as unknown as Quad;
  return valid(start, next);
}

/** Slide one edge along its own direction (a skew). */
export function skewEdge(start: Quad, handle: QuadHandle, dx: number, dy: number): Quad {
  const e = EDGE[handle];
  if (!e) return start;
  const [i, j] = e;
  const len = Math.hypot(start[j].x - start[i].x, start[j].y - start[i].y) || 1;
  const ux = (start[j].x - start[i].x) / len;
  const uy = (start[j].y - start[i].y) / len;
  const t = dx * ux + dy * uy;
  const next = start.map((pt, k) => (k === i || k === j ? { x: pt.x + ux * t, y: pt.y + uy * t } : { ...pt })) as unknown as Quad;
  return valid(start, next);
}

/** Move a whole edge freely (distort mode on a side handle). */
export function distortEdge(start: Quad, handle: QuadHandle, dx: number, dy: number): Quad {
  const e = EDGE[handle];
  if (!e) return start;
  const next = start.map((pt, k) => (k === e[0] || k === e[1] ? { x: pt.x + dx, y: pt.y + dy } : { ...pt })) as unknown as Quad;
  return valid(start, next);
}

/**
 * Perspective: a corner slides along one of its two sides (whichever the drag follows more)
 * and the other corner on that side slides the opposite way, keeping the shape symmetric.
 */
export function perspectiveCorner(start: Quad, corner: number, dx: number, dy: number): Quad {
  // Neighbours along the horizontal side (TL↔TR, BL↔BR) and the vertical side (TL↔BL, TR↔BR).
  const horiz = [1, 0, 3, 2][corner];
  const vert = [3, 2, 1, 0][corner];
  const along = (k: number) => {
    const len = Math.hypot(start[k].x - start[corner].x, start[k].y - start[corner].y) || 1;
    return { x: (start[k].x - start[corner].x) / len, y: (start[k].y - start[corner].y) / len };
  };
  const uh = along(horiz);
  const uv = along(vert);
  const th = dx * uh.x + dy * uh.y;
  const tv = dx * uv.x + dy * uv.y;
  const [other, u, t] = Math.abs(th) >= Math.abs(tv) ? [horiz, uh, th] : [vert, uv, tv];
  const next = start.map((pt, k) =>
    k === corner ? { x: pt.x + u.x * t, y: pt.y + u.y * t } : k === other ? { x: pt.x - u.x * t, y: pt.y - u.y * t } : { ...pt },
  ) as unknown as Quad;
  return valid(start, next);
}

/**
 * What a handle drag does: Free scales; Skew slides sides; Distort moves corners and sides
 * freely; Perspective makes symmetric trapezoids. Ctrl distorts a corner or skews a side
 * whatever the mode.
 */
export function dragHandle(
  start: Quad,
  w: number,
  h: number,
  handle: QuadHandle,
  from: Point,
  to: Point,
  mode: TransformMode,
  mods: { shift: boolean; alt: boolean; ctrl: boolean },
): Quad {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const corner = CORNER[handle];
  const effective: TransformMode = mods.ctrl ? (corner !== undefined ? 'distort' : 'skew') : mode;
  if (effective === 'free') {
    // Keep the grab offset: scale as if the pointer were exactly on the handle.
    const hp = handlePoint(start, handle);
    return scaleQuad(start, w, h, handle, { x: hp.x + dx, y: hp.y + dy }, mods);
  }
  if (corner === undefined) return effective === 'distort' ? distortEdge(start, handle, dx, dy) : skewEdge(start, handle, dx, dy);
  if (effective === 'perspective') return perspectiveCorner(start, corner, dx, dy);
  if (effective === 'skew') {
    // A corner in skew mode slides along whichever side the drag follows.
    const horiz = [1, 0, 3, 2][corner];
    const vert = [3, 2, 1, 0][corner];
    const proj = (k: number) => {
      const len = Math.hypot(start[k].x - start[corner].x, start[k].y - start[corner].y) || 1;
      return Math.abs((dx * (start[k].x - start[corner].x) + dy * (start[k].y - start[corner].y)) / len);
    };
    const k = proj(horiz) >= proj(vert) ? horiz : vert;
    const len = Math.hypot(start[k].x - start[corner].x, start[k].y - start[corner].y) || 1;
    const ux = (start[k].x - start[corner].x) / len;
    const uy = (start[k].y - start[corner].y) / len;
    const t = dx * ux + dy * uy;
    return distortCorner(start, corner, ux * t, uy * t);
  }
  return distortCorner(start, corner, dx, dy);
}

/** Mirror the content inside the same quad. */
export function flipQuad(q: Quad, axis: 'h' | 'v'): Quad {
  return axis === 'h' ? [q[1], q[0], q[3], q[2]] : [q[3], q[2], q[1], q[0]];
}
