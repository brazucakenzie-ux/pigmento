import type { Point } from '../core/geometry';

/**
 * Facing the way it goes. A piece's heading at a moment is the way it moves over a short time
 * either side of it (FACE_SMOOTHING), so it turns smoothly through sharp corners. While it's
 * still, it keeps the way it was going when it stopped (or, before it first moves, the way it's
 * about to go).
 */

/** Seconds of motion either side of a moment that a heading is taken over. */
export const FACE_SMOOTHING = 0.2;

/** Less movement than this (document pixels) over the window is standing still. */
const STILL = 1e-4;

/** Frames either side of a moment that a heading is taken over, at `fps` (at least half a frame, so windows a frame apart meet). */
export function faceSpan(fps: number): number {
  return Math.max(0.5, FACE_SMOOTHING * (Number.isFinite(fps) && fps > 0 ? fps : 12));
}

/**
 * Which way something at pos(t) is heading at `frame` (radians on the canvas, 0 = right,
 * clockwise), taken over `span` frames either side; it only moves between frames `first` and
 * `last`. Null if it never moves.
 */
export function heading(pos: (t: number) => Point, frame: number, first: number, last: number, span: number): number | null {
  const way = (t: number): number | null => {
    const a = pos(t - span);
    const b = pos(t + span);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx, dy) > STILL ? Math.atan2(dy, dx) : null;
  };
  const here = way(frame);
  if (here !== null) return here;
  // Still: back to when it stopped, else on to when it starts (windows a frame apart cover every move).
  const lo = first - span;
  const hi = last + span;
  for (let t = Math.min(frame, hi) - 1; t >= lo; t--) {
    const d = way(t);
    if (d !== null) return d;
  }
  for (let t = Math.max(frame, lo) + 1; t <= hi; t++) {
    const d = way(t);
    if (d !== null) return d;
  }
  return null;
}

/**
 * Which way art drawn pointing at `angle` (in the piece's own pixels) points once the piece is
 * scaled by sx and sy, before it turns: a flip turns the way it points too.
 */
export function artDirection(angle: number, sx: number, sy: number): number {
  return Math.atan2(sy * Math.sin(angle), sx * Math.cos(angle));
}
