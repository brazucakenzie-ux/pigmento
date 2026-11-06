import type { Point, Rect } from './core/geometry';

/**
 * Snapping: points and moving boxes are pulled onto nearby targets (grid, guides, the
 * canvas's edges and centre, other layers' edges and centres) within a screen-space distance.
 */
export type SnapKind = 'grid' | 'guide' | 'canvas' | 'object';

/** A line to snap to; `from`/`to` is its extent along the other axis (for alignment lines). */
export interface SnapLine {
  pos: number;
  kind: SnapKind;
  from: number;
  to: number;
}

export interface SnapTargets {
  /** Vertical lines (constant x) and horizontal lines (constant y). */
  xs: SnapLine[];
  ys: SnapLine[];
  /** Grid spacing, or null when not snapping to the grid. */
  grid: number | null;
}

/** An alignment that happened, for drawing a smart guide. */
export interface SnapMatch {
  axis: 'x' | 'y';
  pos: number;
  kind: SnapKind;
  from: number;
  to: number;
}

/** Edges and centre of a box as snap lines. */
export function boxLines(r: Rect, kind: SnapKind): { xs: SnapLine[]; ys: SnapLine[] } {
  const xs = [r.x, r.x + r.w / 2, r.x + r.w].map((pos) => ({ pos, kind, from: r.y, to: r.y + r.h }));
  const ys = [r.y, r.y + r.h / 2, r.y + r.h].map((pos) => ({ pos, kind, from: r.x, to: r.x + r.w }));
  return { xs, ys };
}

function nearest(v: number, lines: readonly SnapLine[], grid: number | null, threshold: number): { pos: number; line: SnapLine | null } | null {
  let best: { pos: number; line: SnapLine | null; d: number } | null = null;
  for (const l of lines) {
    const d = Math.abs(v - l.pos);
    // Ties go to the earlier target (guides and canvas before objects).
    if (d <= threshold && (!best || d < best.d)) best = { pos: l.pos, line: l, d };
  }
  if (grid && grid > 0) {
    const g = Math.round(v / grid) * grid;
    const d = Math.abs(v - g);
    if (d <= threshold && (!best || d < best.d)) best = { pos: g, line: null, d };
  }
  return best ? { pos: best.pos, line: best.line } : null;
}

/** Snap each coordinate of a point on its own. */
export function snapPoint(p: Point, t: SnapTargets, threshold: number): { point: Point; matches: SnapMatch[] } {
  const matches: SnapMatch[] = [];
  const sx = nearest(p.x, t.xs, t.grid, threshold);
  const sy = nearest(p.y, t.ys, t.grid, threshold);
  const point = { x: sx ? sx.pos : p.x, y: sy ? sy.pos : p.y };
  if (sx?.line) matches.push({ axis: 'x', pos: sx.pos, kind: sx.line.kind, from: Math.min(sx.line.from, point.y), to: Math.max(sx.line.to, point.y) });
  if (sy?.line) matches.push({ axis: 'y', pos: sy.pos, kind: sy.line.kind, from: Math.min(sy.line.from, point.x), to: Math.max(sy.line.to, point.x) });
  return { point, matches };
}

/**
 * The smallest shift (per axis) that puts one of the box's edges or its centre on a target.
 * Returns the shift and what it lined up with.
 */
export function snapBox(r: Rect, t: SnapTargets, threshold: number): { dx: number; dy: number; matches: SnapMatch[] } {
  const axis = (vals: number[], lines: SnapLine[]) => {
    let best: { d: number; line: SnapLine | null; pos: number } | null = null;
    for (const v of vals) {
      const n = nearest(v, lines, t.grid, threshold);
      if (n && (!best || Math.abs(n.pos - v) < Math.abs(best.d))) best = { d: n.pos - v, line: n.line, pos: n.pos };
    }
    return best;
  };
  const bx = axis([r.x, r.x + r.w / 2, r.x + r.w], t.xs);
  const by = axis([r.y, r.y + r.h / 2, r.y + r.h], t.ys);
  const dx = bx ? bx.d : 0;
  const dy = by ? by.d : 0;
  const matches: SnapMatch[] = [];
  if (bx?.line) matches.push({ axis: 'x', pos: bx.pos, kind: bx.line.kind, from: Math.min(bx.line.from, r.y + dy), to: Math.max(bx.line.to, r.y + dy + r.h) });
  if (by?.line) matches.push({ axis: 'y', pos: by.pos, kind: by.line.kind, from: Math.min(by.line.from, r.x + dx), to: Math.max(by.line.to, r.x + dx + r.w) });
  return { dx, dy, matches };
}
