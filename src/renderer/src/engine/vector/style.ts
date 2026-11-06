import type { RGBA } from '../core/color';
import type { Point } from '../core/geometry';

/**
 * Fill and outline styles beyond a plain colour. Every field is optional so older shapes (and
 * files) keep drawing exactly as before: a missing value means a solid colour, a solid line and
 * the shape kind's usual caps and corners.
 */
export const FILL_KINDS = ['solid', 'gradient', 'pattern', 'image'] as const;
export type FillKind = (typeof FILL_KINDS)[number];
export const OUTLINE_KINDS = ['solid', 'gradient'] as const;
export type OutlineKind = (typeof OUTLINE_KINDS)[number];
export const SHAPE_GRADIENT_TYPES = ['linear', 'radial', 'angular'] as const;
export type ShapeGradientType = (typeof SHAPE_GRADIENT_TYPES)[number];
export const DASH_STYLES = ['solid', 'dash', 'dot', 'dashDot'] as const;
export type DashStyle = (typeof DASH_STYLES)[number];
export const CAP_STYLES = ['butt', 'round', 'square'] as const;
export type CapStyle = (typeof CAP_STYLES)[number];
export const JOIN_STYLES = ['miter', 'round', 'bevel'] as const;
export type JoinStyle = (typeof JOIN_STYLES)[number];
export const ARROW_HEADS = ['none', 'triangle', 'open', 'circle', 'diamond'] as const;
export type ArrowHead = (typeof ARROW_HEADS)[number];

export interface PaintStop {
  pos: number;
  color: RGBA;
}

/** A gradient laid over the shape's box (it turns and flips with the shape). */
export interface ShapeGradient {
  type: ShapeGradientType;
  /** null: from the outline colour to the fill colour. */
  stops: PaintStop[] | null;
  /** Direction in degrees (0 = left to right); the start of an angular sweep. */
  angle: number;
}

export interface ShapePattern {
  /** Built-in or saved pattern id; built-in ones use the outline and fill colours. */
  id: string;
  /** Whole-number zoom of the tile, 1–8. */
  scale: number;
}

export interface ShapeStyleExtras {
  fillKind?: FillKind;
  fillGradient?: ShapeGradient;
  fillPattern?: ShapePattern;
  /** Image asset id (see vector/assets). */
  fillImage?: string;
  outlineKind?: OutlineKind;
  outlineGradient?: ShapeGradient;
  dash?: DashStyle;
  cap?: CapStyle;
  join?: JoinStyle;
  /** Lines and curves only. */
  arrowStart?: ArrowHead;
  arrowEnd?: ArrowHead;
}

/** Sharp corners stay sharp up to about 29° before they are bevelled. */
export const MITER_LIMIT = 4;

/** Caps and corners a shape kind uses when its style doesn't say. */
export function lineDefaults(kind: string, strokeOnly: boolean): { cap: CapStyle; join: JoinStyle } {
  return {
    cap: strokeOnly ? 'round' : 'butt',
    join: kind === 'rect' || (kind === 'parametric' && !strokeOnly) ? 'miter' : 'round',
  };
}

/** Dash lengths for an outline of this width (empty = solid). */
export function dashArray(dash: DashStyle | undefined, width: number, cap: CapStyle): number[] {
  const w = Math.max(1, width);
  // Round and square caps grow each dash by half a width at both ends; leave room for them.
  const capped = cap !== 'butt';
  switch (dash) {
    case 'dash':
      return capped ? [w * 2, w * 3] : [w * 3, w * 2];
    case 'dot':
      return capped ? [0.001, w * 2] : [w, w];
    case 'dashDot':
      return capped ? [w * 3, w * 2.5, 0.001, w * 2.5] : [w * 4, w * 2, w, w * 2];
    default:
      return [];
  }
}

/** Length of an arrowhead (along the line) for an outline width. */
export function arrowLength(width: number): number {
  return Math.max(6, width * 3 + 4);
}

export function hasArrows(s: ShapeStyleExtras): boolean {
  return (s.arrowStart ?? 'none') !== 'none' || (s.arrowEnd ?? 'none') !== 'none';
}

/**
 * How far an outline can reach past the shape's geometry: half its width, more for sharp
 * corners (miter tips) and arrowheads.
 */
export function outlineReach(width: number, join: JoinStyle, arrows: boolean): number {
  let r = width / 2;
  if (join === 'miter') r = (width / 2) * MITER_LIMIT;
  if (arrows) r = Math.max(r, arrowLength(width));
  return r;
}

/**
 * An arrowhead at `tip`, pointing along `dir` (unit vector), as a closed outline (filled) or
 * an open one (stroked); and how far to pull the line back so it ends inside the head.
 */
export function arrowHead(head: ArrowHead, tip: Point, dir: Point, width: number): { points: Point[]; closed: boolean; inset: number } | null {
  if (head === 'none') return null;
  const len = arrowLength(width);
  const half = len * 0.5;
  const back = (d: number, side: number): Point => ({ x: tip.x - dir.x * d - dir.y * side, y: tip.y - dir.y * d + dir.x * side });
  switch (head) {
    case 'triangle':
      return { points: [tip, back(len, half), back(len, -half)], closed: true, inset: len * 0.8 };
    case 'open':
      return { points: [back(len, half), tip, back(len, -half)], closed: false, inset: 0 };
    case 'diamond':
      return { points: [tip, back(len / 2, half * 0.8), back(len, 0), back(len / 2, -half * 0.8)], closed: true, inset: len * 0.9 };
    case 'circle': {
      const r = len * 0.38;
      const c = back(r, 0);
      const pts: Point[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
      }
      return { points: pts, closed: true, inset: r };
    }
  }
}

/** Gradient stops to use: the given ones, or outline colour → fill colour. */
export function gradientStops(g: ShapeGradient | undefined, outline: RGBA, fill: RGBA): PaintStop[] {
  if (g?.stops && g.stops.length >= 2) return [...g.stops].sort((a, b) => a.pos - b.pos);
  return [
    { pos: 0, color: outline },
    { pos: 1, color: fill },
  ];
}

/** End points of a linear gradient across a w×h box (centred on cx, cy) at an angle in degrees. */
export function linearEnds(cx: number, cy: number, w: number, h: number, angleDeg: number): [Point, Point] {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const e = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [
    { x: cx - dx * e, y: cy - dy * e },
    { x: cx + dx * e, y: cy + dy * e },
  ];
}
