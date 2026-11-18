import type { Point } from '../core/geometry';
import type { Keyframe, PieceState } from './interpolate';
import { placementOf, unproject, worldOf, type Space } from './space';

/**
 * The Perspective plane tool's drags, as pure maths: each takes the state when the drag began and
 * how far the pointer has gone (screen-sized canvas pixels), and gives the new state.
 */

/** Canvas pixels of drag for a turn of one radian on the tilt and turn handles. */
export const TURN_PX = 150;
/** Canvas pixels of drag that push a piece e times further away (Ctrl-drag). */
export const DEPTH_PX = 200;
const SNAP = Math.PI / 12;

const snap = (a: number, on: boolean): number => (on ? Math.round(a / SNAP) * SNAP : a);

/** The top (n) or bottom (s) handle: dragging the top edge down pushes it back. */
export function tiltDrag(s0: PieceState, handle: 'n' | 's', dy: number, shift: boolean): PieceState {
  return { ...s0, tilt: snap(s0.tilt + ((handle === 'n' ? 1 : -1) * dy) / TURN_PX, shift) };
}

/** A side handle: dragging the right edge in (left) pushes it back, like a door. */
export function turnDrag(s0: PieceState, handle: 'e' | 'w', dx: number, shift: boolean): PieceState {
  return { ...s0, turn: snap(s0.turn + ((handle === 'e' ? -1 : 1) * dx) / TURN_PX, shift) };
}

/** Ctrl-drag: up pushes the piece away, down pulls it closer (never past the camera). */
export function depthDrag(s0: PieceState, dy: number, space: Space): PieceState {
  const f = space.f;
  const dist = (f + s0.depth) * Math.exp(-dy / DEPTH_PX);
  return { ...s0, depth: Math.max(-f * 0.99, dist - f) };
}

/**
 * A corner: the corner follows the pointer on the sheet's own plane, scaling about the pivot
 * (Shift keeps the proportions). The pointer is read through the placement the drag began with.
 */
export function resizeDrag(
  s0: PieceState,
  piece: { pivot: Point; w: number; h: number },
  corner: Point,
  p: Point,
  space: Space,
  shift: boolean,
): PieceState {
  const pl = placementOf(s0, piece.pivot, piece.w, piece.h, space);
  const q = pl.affine ? null : unproject(pl, p);
  const local = q ?? flatLocal(pl.affine, p);
  if (!local) return s0;
  const ex = corner.x - piece.pivot.x;
  const ey = corner.y - piece.pivot.y;
  let fx = Math.abs(ex) > 1e-9 ? (local.x - piece.pivot.x) / ex : 1;
  let fy = Math.abs(ey) > 1e-9 ? (local.y - piece.pivot.y) / ey : 1;
  if (shift) fx = fy = (fx + fy) / 2;
  const keep = (v: number) => (Math.abs(v) < 0.01 ? (v < 0 ? -0.01 : 0.01) : v);
  return { ...s0, sx: keep(s0.sx * fx), sy: keep(s0.sy * fy) };
}

function flatLocal(m: readonly number[] | null, p: Point): Point | null {
  if (!m) return null;
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const x = p.x - e;
  const y = p.y - f;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}

/**
 * Keyframes after moving the pivot to `next` (the piece's own pixels), so the piece stays exactly
 * where it is in 3D on every keyframe: each keyframe's position and depth become where the new
 * pivot already was.
 */
export function movePivot3D(keyframes: readonly Keyframe[], pivot: Point, next: Point, space: Space): Keyframe[] {
  return keyframes.map((k) => {
    const W = worldOf(k, pivot, next, space);
    // Where the new pivot shows on the canvas, and how far behind it it is.
    const z = space.f + W.z;
    const x = space.cx + ((W.x - space.cx) * space.f) / z;
    const y = space.cy + ((W.y - space.cy) * space.f) / z;
    return { ...k, x, y, depth: W.z };
  });
}
