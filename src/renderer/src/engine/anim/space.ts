import type { Point, Rect } from '../core/geometry';
import { matChain, matScale, matTranslate, type Mat } from '../core/matrix';
import { invertHomography, type Homography } from '../raster/warp';
import { stateMatrix, type PieceState } from './interpolate';

/**
 * Pieces in 3D. The canvas is the plane z = 0, seen by one camera straight on from its vanishing
 * point, `f` pixels in front of the canvas; z grows away from the viewer. A piece is a sheet:
 * scaled, skewed and spun in its own plane as in 1.1, then tilted (round its horizontal axis,
 * top edge back), then turned (round the upright, like a door), all about its pivot. Its x and y
 * are where the pivot shows on the canvas and its depth pushes it away without moving that spot.
 * A piece with no tilt or turn stays flat: depth only shrinks it towards that spot.
 */

/** The picture's camera: the vanishing point (document pixels) and how strong the perspective is. */
export interface Camera {
  x: number;
  y: number;
  /** 1 (almost flat) … 100 % (strong); 50 % is a normal lens. */
  strength: number;
}

export const MIN_STRENGTH = 1;
export const MAX_STRENGTH = 100;
export const DEFAULT_STRENGTH = 50;

export function defaultCamera(w: number, h: number): Camera {
  return { x: w / 2, y: h / 2, strength: DEFAULT_STRENGTH };
}

/** The camera worked out for a picture size: its vanishing point, and how far it is from the canvas (px). */
export interface Space {
  cx: number;
  cy: number;
  f: number;
}

/** No perspective at all (depth changes nothing): for pictures without a camera, and tests. */
export const FLAT_SPACE: Space = { cx: 0, cy: 0, f: 1e12 };

/**
 * The focal length follows the picture's size (50 % = its diagonal), so resizing the picture
 * keeps the same look without changing the camera.
 */
export function spaceOf(cam: Camera, w: number, h: number): Space {
  const s = Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, Number.isFinite(cam.strength) ? cam.strength : DEFAULT_STRENGTH));
  return { cx: cam.x, cy: cam.y, f: (50 * Math.hypot(w, h)) / s };
}

/** Where a piece is at one moment. */
export interface Placement {
  /** Piece pixels → document pixels while it faces the camera square on (no tilt or turn), else null. */
  affine: Mat | null;
  /**
   * Piece pixels → document pixels, row-major: (x, y) maps to (h0·x + h1·y + h2, h3·x + h4·y + h5)
   * divided by h6·x + h7·y + h8, which is the point's distance from the camera along its view
   * (positive in front of it).
   */
  h: Homography;
  /** Document pixels → piece pixels (the third value positive where the sheet is in front of the camera). */
  inv: Homography | null;
  /** How far the middle of the piece is behind the canvas (it sorts pieces back to front). */
  depth: number;
  /** The camera sees the side it was made on (turned or tilted round past edge-on, it sees its back). */
  front: boolean;
}

/** Closest a point may come to the camera and still be drawn, as a share of the focal length. */
export const NEAR = 0.01;

export type Vec3 = [number, number, number];

/** Tilt (round the horizontal axis) then turn (round the upright): columns of the rotation (c2 is the sheet's normal). */
export function rotation(tilt: number, turn: number): { c0: Vec3; c1: Vec3; c2: Vec3 } {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cr = Math.cos(turn);
  const sr = Math.sin(turn);
  // R = Ry(turn) · Rx(tilt), with Rx: y' = ct·y + st·z, z' = −st·y + ct·z (the top, y < 0, goes back)
  // and Ry: x' = cr·x − sr·z, z' = sr·x + cr·z (the right edge goes back).
  return { c0: [cr, 0, sr], c1: [sr * st, ct, -cr * st], c2: [-sr * ct, st, cr * ct] };
}

/** Where `s` puts a w × h piece turning about `pivot` (its own pixels), seen by `space`. */
export function placementOf(s: PieceState, pivot: Point, w: number, h: number, space: Space): Placement {
  const m = stateMatrix(s, pivot);
  const { cx, cy, f } = space;
  // A depth at or past the camera can't be seen: keep it just in front.
  const depth = Math.max(s.depth, -f * (1 - NEAR));
  if (s.tilt === 0 && s.turn === 0) {
    const k = f / (f + depth);
    const affine = k === 1 ? m : matChain(m, matTranslate(-s.x, -s.y), matScale(k), matTranslate(s.x, s.y));
    const hm: Homography = [affine[0], affine[2], affine[4], affine[1], affine[3], affine[5], 0, 0, 1];
    return { affine, h: hm, inv: invertHomography(hm), depth, front: true };
  }
  const { c0, c1 } = rotation(s.tilt, s.turn);
  // The pivot in 3D: the point at that depth that shows where the pivot is on the canvas.
  const g = (f + depth) / f;
  const P = [cx + (s.x - cx) * g, cy + (s.y - cy) * g, depth];
  // u(q) = m(q) − (x, y): the piece in its own plane, about the pivot. World W = P + c0·u.x + c1·u.y.
  const [a, b, c, d, e, ff] = m;
  const ex = e - s.x;
  const fy = ff - s.y;
  const row = (i: number): [number, number, number] => [c0[i] * a + c1[i] * b, c0[i] * c + c1[i] * d, P[i] + c0[i] * ex + c1[i] * fy];
  const X = row(0);
  const Y = row(1);
  const Z = row(2);
  // Seen from (cx, cy, −f): x' = (f·X + cx·Z) / (f + Z), and likewise y'.
  const hm: Homography = [
    f * X[0] + cx * Z[0],
    f * X[1] + cx * Z[1],
    f * X[2] + cx * Z[2],
    f * Y[0] + cy * Z[0],
    f * Y[1] + cy * Z[1],
    f * Y[2] + cy * Z[2],
    Z[0],
    Z[1],
    Z[2] + f,
  ];
  const mid = { x: w / 2, y: h / 2 };
  const zMid = Z[0] * mid.x + Z[1] * mid.y + Z[2];
  // The sheet's normal (c0 × c1) points away from the camera while its front faces it.
  const n = [c0[1] * c1[2] - c0[2] * c1[1], c0[2] * c1[0] - c0[0] * c1[2], c0[0] * c1[1] - c0[1] * c1[0]];
  const W = [X[0] * mid.x + X[1] * mid.y + X[2], Y[0] * mid.x + Y[1] * mid.y + Y[2], zMid];
  const toCam = [cx - W[0], cy - W[1], -f - W[2]];
  const front = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2] < 0;
  return { affine: null, h: hm, inv: invertHomography(hm), depth: zMid, front };
}

/** Where piece point q (its own pixels) is in 3D at state s (z: behind the canvas). */
export function worldOf(s: PieceState, pivot: Point, q: Point, space: Space): { x: number; y: number; z: number } {
  const { cx, cy, f } = space;
  const depth = Math.max(s.depth, -f * (1 - NEAR));
  const m = stateMatrix(s, pivot);
  const p = { x: m[0] * q.x + m[2] * q.y + m[4], y: m[1] * q.x + m[3] * q.y + m[5] };
  const u = { x: p.x - s.x, y: p.y - s.y };
  const { c0, c1 } = rotation(s.tilt, s.turn);
  const g = (f + depth) / f;
  return {
    x: cx + (s.x - cx) * g + c0[0] * u.x + c1[0] * u.y,
    y: cy + (s.y - cy) * g + c0[1] * u.x + c1[1] * u.y,
    z: depth + c0[2] * u.x + c1[2] * u.y,
  };
}

/**
 * The picture's light for shading pieces in 3D: which way it comes from round the view (degrees
 * clockwise from straight above) and how high it is (degrees: 0 grazes the canvas, 90 shines
 * straight from the camera).
 */
export interface Light {
  angle: number;
  height: number;
}

export function defaultLight(): Light {
  return { angle: -30, height: 45 };
}

/** Pointing from a surface towards the light (z away from the viewer, so a light in front has z < 0). */
function lightVector(l: Light): [number, number, number] {
  const a = (l.angle * Math.PI) / 180;
  const h = (Math.min(90, Math.max(0, l.height)) * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(h), -Math.cos(a) * Math.cos(h), -Math.sin(h)];
}

/**
 * How bright a shaded piece's face is at state s (0 … 1, multiplying its colours): a face that
 * faces the camera keeps its colours, and one turned away from the light darkens, by `strength`
 * (0 … 1) at most. Flat pieces aren't shaded.
 */
export function shadeOf(s: PieceState, front: boolean, light: Light, strength: number): number {
  if (strength <= 0 || (s.tilt === 0 && s.turn === 0)) return 1;
  return shadeFor(rotation(s.tilt, s.turn).c2, front, light, strength);
}

/**
 * The same for a sheet whose front's normal (a unit vector pointing away from the camera while
 * the front faces it) is `normal`.
 */
export function shadeFor(normal: Vec3, front: boolean, light: Light, strength: number): number {
  if (strength <= 0) return 1;
  // The normal of the side the camera sees.
  const k = front ? -1 : 1;
  const n = [k * normal[0], k * normal[1], k * normal[2]];
  const L = lightVector(light);
  const lit = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  // Facing the camera square on counts as fully lit.
  const ref = Math.max(1e-6, -L[2]);
  return 1 - Math.min(1, strength) * (1 - Math.min(1, lit / ref));
}

/** A piece point on the canvas, or null behind the camera. */
export function project(pl: Placement, q: Point): Point | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = pl.h;
  const z = h6 * q.x + h7 * q.y + h8;
  if (!(z > 0)) return null;
  return { x: (h0 * q.x + h1 * q.y + h2) / z, y: (h3 * q.x + h4 * q.y + h5) / z };
}

/** The piece point (its own pixels) seen at canvas point p, or null where the sheet's plane isn't (behind the camera, edge-on). */
export function unproject(pl: Placement, p: Point): Point | null {
  const inv = pl.inv;
  if (!inv) return null;
  const z = inv[6] * p.x + inv[7] * p.y + inv[8];
  if (!(z > 0)) return null;
  return { x: (inv[0] * p.x + inv[1] * p.y + inv[2]) / z, y: (inv[3] * p.x + inv[4] * p.y + inv[5]) / z };
}

/**
 * The piece's w × h box on the canvas: its corners, with the part too close to (or behind) the
 * camera cut away, so a sheet reaching past the camera still has a sensible outline.
 */
export function placementOutline(pl: Placement, w: number, h: number, space: Space): Point[] {
  const box: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const [, , , , , , h6, h7, h8] = pl.h;
  const near = space.f * NEAR;
  const dist = (q: Point) => h6 * q.x + h7 * q.y + h8 - near;
  // Keep the side of `dist = 0` in front of the camera (Sutherland–Hodgman against one line).
  const kept: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const a = box[i];
    const b = box[(i + 1) % 4];
    const da = dist(a);
    const db = dist(b);
    if (da >= 0) kept.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      kept.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return kept.map((q) => project(pl, q)).filter((p): p is Point => p !== null);
}

/** Bounds of the outline, rounded out (plus a pixel for smoothing), or null when it's all behind the camera. */
export function placementBounds(pl: Placement, w: number, h: number, space: Space): Rect | null {
  const pts = placementOutline(pl, w, h, space);
  if (pts.length < 3) return null;
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
  const x = Math.floor(x0) - 1;
  const y = Math.floor(y0) - 1;
  return { x, y, w: Math.ceil(x1) + 1 - x, h: Math.ceil(y1) + 1 - y };
}
