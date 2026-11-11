import type { Point } from '../core/geometry';

/**
 * Symmetry for brush tools: every stroke is repeated mirrored or turned around a centre.
 * `leftRight` mirrors across a vertical line, `topBottom` across a horizontal one, `both` does
 * the two (four copies), `radial` turns copies evenly around the centre.
 */
export const SYMMETRY_MODES = ['off', 'leftRight', 'topBottom', 'both', 'radial'] as const;
export type SymmetryMode = (typeof SYMMETRY_MODES)[number];

export interface Symmetry {
  mode: SymmetryMode;
  /** Copies around the centre for radial symmetry, 2–32. */
  segments: number;
  /** Document point; null = the canvas centre. */
  center: Point | null;
}

export const MIN_SEGMENTS = 2;
export const MAX_SEGMENTS = 32;

export function symmetryCenter(s: Symmetry, w: number, h: number): Point {
  return s.center ?? { x: w / 2, y: h / 2 };
}

/** The copies a stroke is drawn as (the first is the stroke itself). */
export function symmetryCopies(s: Symmetry, w: number, h: number): ((p: Point) => Point)[] {
  const c = symmetryCenter(s, w, h);
  const id = (p: Point) => p;
  const mirrorX = (p: Point) => ({ x: 2 * c.x - p.x, y: p.y });
  const mirrorY = (p: Point) => ({ x: p.x, y: 2 * c.y - p.y });
  switch (s.mode) {
    case 'leftRight':
      return [id, mirrorX];
    case 'topBottom':
      return [id, mirrorY];
    case 'both':
      return [id, mirrorX, mirrorY, (p) => mirrorY(mirrorX(p))];
    case 'radial': {
      const n = Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.round(s.segments)));
      return Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        return k === 0 ? id : (p: Point) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos });
      });
    }
    default:
      return [id];
  }
}

/**
 * The lines to show on the canvas: mirror axes, or the spokes between radial segments, each
 * from the centre (or across) to the canvas edge.
 */
export function symmetryAxes(s: Symmetry, w: number, h: number): [Point, Point][] {
  const c = symmetryCenter(s, w, h);
  const far = Math.hypot(w, h) * 2;
  const across = (angle: number): [Point, Point] => [
    { x: c.x - Math.cos(angle) * far, y: c.y - Math.sin(angle) * far },
    { x: c.x + Math.cos(angle) * far, y: c.y + Math.sin(angle) * far },
  ];
  switch (s.mode) {
    case 'leftRight':
      return [across(Math.PI / 2)];
    case 'topBottom':
      return [across(0)];
    case 'both':
      return [across(0), across(Math.PI / 2)];
    case 'radial': {
      const n = Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.round(s.segments)));
      return Array.from({ length: n }, (_, k) => {
        const a = (k / n) * Math.PI * 2 - Math.PI / 2;
        return [c, { x: c.x + Math.cos(a) * far, y: c.y + Math.sin(a) * far }];
      });
    }
    default:
      return [];
  }
}

/**
 * Stroke stabiliser ("pulled string"): the brush trails the pointer by up to `length` and only
 * moves when the pointer pulls the string tight. Returns the brush's new position.
 */
export function stabilize(brush: Point, pointer: Point, length: number): Point {
  const dx = pointer.x - brush.x;
  const dy = pointer.y - brush.y;
  const d = Math.hypot(dx, dy);
  if (d <= length || d === 0) return brush;
  const k = (d - length) / d;
  return { x: brush.x + dx * k, y: brush.y + dy * k };
}
