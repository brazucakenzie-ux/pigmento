import { lerp, type Point } from '../core/geometry';
import { matChain, matRotate, matScale, matTranslate, matApply, type Mat } from '../core/matrix';

/** How a piece gets from one keyframe to the next. */
export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';
export const EASINGS: readonly Easing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'];

/** Where a piece is and how it looks at one moment. */
export interface PieceState {
  /** Position of the pivot, in document pixels. */
  x: number;
  y: number;
  /** Scale along the piece's own axes (1 = 100 %); negative flips. Different x and y stretch it. */
  sx: number;
  sy: number;
  /** Rotation in radians. Not wrapped: 2π is one whole turn, 4π two. */
  angle: number;
  /** Horizontal skew in radians. */
  skew: number;
  /** 0 (invisible) … 1. */
  opacity: number;
  /**
   * How far a repeating piece's tiles have slid along its own axes, in its own pixels (only the
   * axes it repeats on count). Not wrapped, so a long scroll keeps its speed between keyframes.
   */
  scrollX: number;
  scrollY: number;
  /** In 3D (see space.ts): how far behind the canvas the pivot is, in pixels (0 = on it). */
  depth: number;
  /** Radians, not wrapped: round its own horizontal axis (top edge back), then round the upright (like a door). */
  tilt: number;
  turn: number;
  /**
   * Radians, not wrapped: how far a hinged piece is folded round the edge it hangs from (0 = flat
   * beside it; positive folds it back, away from the viewer). Only hinged pieces use it.
   */
  fold: number;
  /**
   * How far along the path it follows (0 = the start, 1 = the end; a closed path goes round again
   * past 1). Only pieces that follow a path use it; their x and y come from the path instead.
   */
  progress: number;
}

export interface Keyframe extends PieceState {
  /** Frame number (an integer ≥ 0). */
  frame: number;
  /** Easing from this keyframe to the next one. */
  easing: Easing;
  /**
   * Motion-path handles, relative to this keyframe's position: `out` bends the path towards
   * the next keyframe, `in` the path arriving from the previous one. null = no bend there.
   */
  out: Point | null;
  in: Point | null;
}

export const STATE_KEYS = ['x', 'y', 'sx', 'sy', 'angle', 'skew', 'opacity', 'scrollX', 'scrollY', 'depth', 'tilt', 'turn', 'fold', 'progress'] as const;

export function identityState(x: number, y: number): PieceState {
  return { x, y, sx: 1, sy: 1, angle: 0, skew: 0, opacity: 1, scrollX: 0, scrollY: 0, depth: 0, tilt: 0, turn: 0, fold: 0, progress: 0 };
}

/** Eased progress (0 … 1) for linear progress u (0 … 1). */
export function ease(easing: Easing, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  switch (easing) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - (1 - t) ** 3;
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case 'hold':
      return t >= 1 ? 1 : 0;
  }
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const s = 1 - t;
  return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
}

const ARC_SAMPLES = 48;

/** The motion path between two keyframes, as Bézier control points (straight if neither bends). */
export function segmentControls(a: Keyframe, b: Keyframe): [Point, Point, Point, Point] | null {
  if (!a.out && !b.in) return null;
  const p0 = { x: a.x, y: a.y };
  const p3 = { x: b.x, y: b.y };
  const p1 = a.out ? { x: a.x + a.out.x, y: a.y + a.out.y } : p0;
  const p2 = b.in ? { x: b.x + b.in.x, y: b.y + b.in.y } : p3;
  return [p0, p1, p2, p3];
}

export function bezierPoint(c: readonly [Point, Point, Point, Point], t: number): Point {
  return { x: cubic(c[0].x, c[1].x, c[2].x, c[3].x, t), y: cubic(c[0].y, c[1].y, c[2].y, c[3].y, t) };
}

/**
 * The point at fraction `s` of the curve's length, so a piece moves along a bent path at the
 * speed its easing says (linear easing = an even speed), not bunched up where the curve is tight.
 */
export function pointAlongCurve(c: readonly [Point, Point, Point, Point], s: number): Point {
  if (s <= 0) return c[0];
  if (s >= 1) return c[3];
  const lengths = [0];
  let prev = c[0];
  for (let i = 1; i <= ARC_SAMPLES; i++) {
    const p = bezierPoint(c, i / ARC_SAMPLES);
    lengths.push(lengths[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  const total = lengths[ARC_SAMPLES];
  if (total < 1e-9) return c[0];
  const want = s * total;
  let i = 1;
  while (i < ARC_SAMPLES && lengths[i] < want) i++;
  const span = lengths[i] - lengths[i - 1];
  const f = span > 0 ? (want - lengths[i - 1]) / span : 0;
  return bezierPoint(c, (i - 1 + f) / ARC_SAMPLES);
}

/** Blend two keyframes; e is the eased progress from a (0) to b (1). */
export function blendStates(a: Keyframe, b: Keyframe, e: number): PieceState {
  const c = segmentControls(a, b);
  const pos = c ? pointAlongCurve(c, e) : { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) };
  return {
    x: pos.x,
    y: pos.y,
    sx: lerp(a.sx, b.sx, e),
    sy: lerp(a.sy, b.sy, e),
    angle: lerp(a.angle, b.angle, e),
    skew: lerp(a.skew, b.skew, e),
    opacity: Math.min(1, Math.max(0, lerp(a.opacity, b.opacity, e))),
    scrollX: lerp(a.scrollX, b.scrollX, e),
    scrollY: lerp(a.scrollY, b.scrollY, e),
    depth: lerp(a.depth, b.depth, e),
    tilt: lerp(a.tilt, b.tilt, e),
    turn: lerp(a.turn, b.turn, e),
    fold: lerp(a.fold, b.fold, e),
    progress: lerp(a.progress, b.progress, e),
  };
}

function stateOf(k: Keyframe): PieceState {
  return { x: k.x, y: k.y, sx: k.sx, sy: k.sy, angle: k.angle, skew: k.skew, opacity: k.opacity, scrollX: k.scrollX, scrollY: k.scrollY, depth: k.depth, tilt: k.tilt, turn: k.turn, fold: k.fold, progress: k.progress };
}

/**
 * A piece's state at `frame` (fractional frames are fine). Keyframes are sorted by frame.
 * Before the first keyframe the piece holds the first one; after the last, the last.
 */
export function stateAt(keyframes: readonly Keyframe[], frame: number): PieceState | null {
  if (!keyframes.length) return null;
  const first = keyframes[0];
  if (frame <= first.frame) return stateOf(first);
  const last = keyframes[keyframes.length - 1];
  if (frame >= last.frame) return stateOf(last);
  // Binary search for the segment [a, b] containing frame.
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].frame <= frame) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo];
  const b = keyframes[hi];
  const u = (frame - a.frame) / (b.frame - a.frame);
  return blendStates(a, b, ease(a.easing, u));
}

/**
 * Source pixels → document pixels: about the pivot (in source pixels), scale, then skew,
 * then rotate, then put the pivot at the state's position.
 */
export function stateMatrix(s: PieceState, pivot: Point): Mat {
  const shear: Mat = [1, 0, Math.tan(s.skew), 1, 0, 0];
  return matChain(matTranslate(-pivot.x, -pivot.y), matScale(s.sx, s.sy), shear, matRotate(s.angle), matTranslate(s.x, s.y));
}

/**
 * Keyframes after moving the pivot to `next` (source pixels), so the piece stays exactly where
 * it was on every keyframe: each keyframe's position becomes where the new pivot already was.
 */
export function movePivot(keyframes: readonly Keyframe[], pivot: Point, next: Point): Keyframe[] {
  return keyframes.map((k) => {
    const p = matApply(stateMatrix(k, pivot), next.x, next.y);
    return { ...k, x: p.x, y: p.y };
  });
}
