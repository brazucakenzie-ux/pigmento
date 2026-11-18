import type { Point } from '../core/geometry';
import { matApply, matChain, matInvert, matRotate, type Mat } from '../core/matrix';
import { stateMatrix, type PieceState } from './interpolate';
import { pieceStateAt, repeatAxes, type Piece } from './piece';
import { FLAT_SPACE, placementOf, unproject, type Space } from './space';

/** The eight box handles of a piece, in its own (source pixel) frame. */
export type PieceHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const PIECE_HANDLES: readonly PieceHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const FRACTION: Record<PieceHandle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const OPPOSITE: Record<PieceHandle, PieceHandle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

/** Smallest scale a drag can reach (a piece never collapses to nothing). */
const MIN_SCALE = 0.01;
/** Skew stops short of vertical. */
const MAX_SKEW = (85 * Math.PI) / 180;
const SNAP_ANGLE = Math.PI / 12;

export function isCornerHandle(h: PieceHandle): boolean {
  return h.length === 2;
}

export function handleLocal(p: Pick<Piece, 'src'>, h: PieceHandle): Point {
  const [fx, fy] = FRACTION[h];
  return { x: fx * p.src.width, y: fy * p.src.height };
}

/** Skew then rotate: the part of the piece's transform after scaling (no translation). */
function linear(s: PieceState): Mat {
  return matChain([1, 0, Math.tan(s.skew), 1, 0, 0], matRotate(s.angle));
}

function lin(m: Mat, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

function keepSize(v: number): number {
  return Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v;
}

/** Where a point of the piece (source pixels) is in the document, for state s. */
export function localToDoc(s: PieceState, pivot: Point, q: Point): Point {
  return matApply(stateMatrix(s, pivot), q.x, q.y);
}

/** The document point p in the piece's source pixels (null if the piece has no area). */
export function docToLocal(s: PieceState, pivot: Point, p: Point): Point | null {
  const inv = matInvert(stateMatrix(s, pivot));
  return inv ? matApply(inv, p.x, p.y) : null;
}

/** Drag the whole piece by (dx, dy); with Shift, only along the larger of the two. */
export function moveState(s0: PieceState, dx: number, dy: number, shift: boolean): PieceState {
  if (shift) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { ...s0, x: s0.x + dx, y: s0.y + dy };
}

/** Turn about the pivot by the angle the pointer swept from `from` to `to`; Shift snaps to 15°. */
export function rotateState(s0: PieceState, from: Point, to: Point, shift: boolean): PieceState {
  const delta = Math.atan2(to.y - s0.y, to.x - s0.x) - Math.atan2(from.y - s0.y, from.x - s0.x);
  // The sweep is the short way round, so dragging across ±180° doesn't jump a whole turn.
  const sweep = Math.atan2(Math.sin(delta), Math.cos(delta));
  let angle = s0.angle + sweep;
  if (shift) angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
  return { ...s0, angle };
}

/**
 * Drag a box handle to p: the opposite side stays where it is (Alt: the pivot does), corners
 * scale both ways (Shift keeps the proportions), edges only their own direction. Dragging past
 * the other side flips the piece.
 */
export function scaleState(
  s0: PieceState,
  piece: Pick<Piece, 'src' | 'pivot'>,
  h: PieceHandle,
  p: Point,
  mods: { shift: boolean; alt: boolean },
): PieceState {
  const g = linear(s0);
  const gi = matInvert(g);
  if (!gi) return s0;
  const pivot = piece.pivot;
  const handle = handleLocal(piece, h);
  const anchor = mods.alt ? pivot : handleLocal(piece, OPPOSITE[h]);
  // The anchor's place in the document stays fixed.
  const a = lin(g, { x: (anchor.x - pivot.x) * s0.sx, y: (anchor.y - pivot.y) * s0.sy });
  const fixed = { x: a.x + s0.x, y: a.y + s0.y };
  const v = lin(gi, { x: p.x - fixed.x, y: p.y - fixed.y });
  const dx = handle.x - anchor.x;
  const dy = handle.y - anchor.y;
  let sx = Math.abs(dx) > 1e-9 ? v.x / dx : s0.sx;
  let sy = Math.abs(dy) > 1e-9 ? v.y / dy : s0.sy;
  if (mods.shift && isCornerHandle(h)) {
    const t = (sx * s0.sx + sy * s0.sy) / (s0.sx * s0.sx + s0.sy * s0.sy);
    sx = t * s0.sx;
    sy = t * s0.sy;
  }
  sx = keepSize(sx);
  sy = keepSize(sy);
  const b = lin(g, { x: (anchor.x - pivot.x) * sx, y: (anchor.y - pivot.y) * sy });
  return { ...s0, sx, sy, x: fixed.x - b.x, y: fixed.y - b.y };
}

/** Ctrl-drag the top or bottom edge sideways to skew; the opposite edge stays where it is. */
export function skewState(s0: PieceState, piece: Pick<Piece, 'src' | 'pivot'>, h: 'n' | 's', p: Point): PieceState {
  const pivot = piece.pivot;
  const anchor = handleLocal(piece, OPPOSITE[h]);
  const handle = handleLocal(piece, h);
  const g0 = linear(s0);
  const a = lin(g0, { x: (anchor.x - pivot.x) * s0.sx, y: (anchor.y - pivot.y) * s0.sy });
  const fixed = { x: a.x + s0.x, y: a.y + s0.y };
  // The pointer in the piece's turned (but not skewed) frame, from the fixed edge.
  const u = lin(matRotate(-s0.angle), { x: p.x - fixed.x, y: p.y - fixed.y });
  const height = (handle.y - anchor.y) * s0.sy;
  if (Math.abs(height) < 1e-9) return s0;
  const skew = Math.max(-MAX_SKEW, Math.min(MAX_SKEW, Math.atan((u.x - (handle.x - anchor.x) * s0.sx) / height)));
  const next = { ...s0, skew };
  const b = lin(linear(next), { x: (anchor.x - pivot.x) * s0.sx, y: (anchor.y - pivot.y) * s0.sy });
  return { ...next, x: fixed.x - b.x, y: fixed.y - b.y };
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/**
 * Document point p in the piece's own pixels at state s, with a repeating piece's copies (and its
 * scroll) folded back onto the original tile. Null if the piece has no area.
 */
export function docToPixel(piece: Piece, s: PieceState, p: Point, space: Space = FLAT_SPACE): Point | null {
  const pl = placementOf(s, piece.pivot, piece.src.width, piece.src.height, space);
  let q: Point | null;
  if (pl.affine) {
    const inv = matInvert(pl.affine);
    q = inv ? matApply(inv, p.x, p.y) : null;
  } else q = unproject(pl, p);
  if (!q) return null;
  const ax = repeatAxes(piece.repeat);
  return {
    x: ax.x ? mod(q.x - s.scrollX, piece.src.width) : q.x,
    y: ax.y ? mod(q.y - s.scrollY, piece.src.height) : q.y,
  };
}

/** The piece on top at document point p at `frame` (only where it isn't see-through; any copy of a repeating one). */
export function pieceAt(pieces: readonly Piece[], frame: number, p: Point, space: Space = FLAT_SPACE): Piece | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const piece = pieces[i];
    const s = pieceStateAt(piece, frame);
    if (s.opacity <= 0) continue;
    if (piece.back === 'hide' && !placementOf(s, piece.pivot, piece.src.width, piece.src.height, space).front) continue;
    const q = docToPixel(piece, s, p, space);
    if (!q) continue;
    const x = Math.floor(q.x);
    const y = Math.floor(q.y);
    if (x < 0 || y < 0 || x >= piece.src.width || y >= piece.src.height) continue;
    if (piece.src.getPixel(x, y).a > 16) return piece;
  }
  return null;
}

/** True if p is inside the piece's box at `frame` (transparent parts included; any copy of a repeating one). */
export function insidePiece(piece: Piece, frame: number, p: Point, space: Space = FLAT_SPACE): boolean {
  const q = docToPixel(piece, pieceStateAt(piece, frame), p, space);
  return !!q && q.x >= 0 && q.y >= 0 && q.x <= piece.src.width && q.y <= piece.src.height;
}
