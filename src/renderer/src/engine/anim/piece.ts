import { boundsOfPoints, type Point, type Rect } from '../core/geometry';
import { matApplyPoints, type Mat } from '../core/matrix';
import { Surface } from '../raster/Surface';
import type { ImageBuf } from '../raster/transform';
import { identityState, stateAt, stateMatrix, STATE_KEYS, type Easing, type Keyframe, type PieceState } from './interpolate';

/**
 * Pixels with their own size, belonging to a pixel layer and animated with keyframes. It's
 * drawn just above its layer's pixels, inside the layer, and may sit partly or wholly outside
 * the canvas. `src` is only ever written inside a surface edit (so a tile is copied before it
 * changes), which lets undo snapshots and copies share its tiles.
 */
export interface Piece {
  readonly id: string;
  /** User content ('' = unnamed; the UI shows a localised default). */
  name: string;
  layerId: string;
  readonly src: Surface;
  /** Where the pixels were lifted from, in document pixels. */
  readonly home: Rect;
  /** The point it turns and scales around, in source pixels. */
  pivot: Point;
  /** Sorted by frame, one per frame, never empty. */
  keyframes: Keyframe[];
  /** Copies of it tile on along its own axes: across, down, or both (an endless plane). */
  repeat: Repeat;
}

export type Repeat = 'none' | 'x' | 'y' | 'both';
export const REPEATS: readonly Repeat[] = ['none', 'x', 'y', 'both'];

/** Which of a piece's own axes it repeats along. */
export function repeatAxes(r: Repeat): { x: boolean; y: boolean } {
  return { x: r === 'x' || r === 'both', y: r === 'y' || r === 'both' };
}

/** What a keyframe change can set. */
export type KeyChange = Partial<PieceState & Pick<Keyframe, 'easing' | 'in' | 'out'>>;

let nextPieceId = 1;

/** A new, unique piece id. */
export function newPieceId(): string {
  return `piece-${nextPieceId++}-${Date.now().toString(36)}`;
}

export const MAX_PIECES = 500;
export const MAX_KEYFRAMES = 2000;
/** Longest side a piece can have (what graphics cards take as one texture). */
export const MAX_PIECE_SIDE = 16384;
/** Most a repeating piece's scroll can be either way (far more than any loop needs). */
export const MAX_SCROLL = 1e6;

/** The pixels as a piece's surface (an image is copied into a new one). */
export function pieceSurface(src: ImageBuf | Surface): Surface {
  return src instanceof Surface ? src : Surface.fromRGBA(Math.max(1, src.w), Math.max(1, src.h), src.data);
}

/** A piece's size in its own pixels. */
export function pieceSize(p: Pick<Piece, 'src'>): { w: number; h: number } {
  return { w: p.src.width, h: p.src.height };
}

export function makePiece(id: string, name: string, layerId: string, src: ImageBuf | Surface, home: Rect, frame: number): Piece {
  const surface = pieceSurface(src);
  const pivot = { x: surface.width / 2, y: surface.height / 2 };
  return {
    id,
    name,
    layerId,
    src: surface,
    home: { ...home },
    pivot,
    keyframes: [{ ...identityState(home.x + pivot.x, home.y + pivot.y), frame, easing: 'linear', in: null, out: null }],
    repeat: 'none',
  };
}

/** The same piece (for undo snapshots: the pixels are shared, not copied). */
export function clonePiece(p: Piece): Piece {
  return { ...p, home: { ...p.home }, pivot: { ...p.pivot }, keyframes: p.keyframes.map(cloneKeyframe) };
}

/** A separate copy with its own id: its pixels share tiles until either is painted on. */
export function copyPiece(p: Piece, id: string, layerId: string): Piece {
  return { ...clonePiece(p), id, layerId, src: p.src.snapshot() };
}

export function cloneKeyframe(k: Keyframe): Keyframe {
  return { ...k, in: k.in && { ...k.in }, out: k.out && { ...k.out } };
}

export function pieceStateAt(p: Piece, frame: number): PieceState {
  // Never empty, so stateAt always has an answer.
  return stateAt(p.keyframes, frame) ?? identityState(p.home.x + p.pivot.x, p.home.y + p.pivot.y);
}

export function pieceMatrixAt(p: Piece, frame: number): Mat {
  return stateMatrix(pieceStateAt(p, frame), p.pivot);
}

/** The piece's four corners at `frame`, in document pixels. */
export function pieceCorners(p: Piece, frame: number): Point[] {
  const { w, h } = pieceSize(p);
  return matApplyPoints(pieceMatrixAt(p, frame), [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

/**
 * Area the piece's own box covers at `frame` (rounded out to whole pixels, plus one for
 * smoothing). A repeating piece draws beyond it: see `pieceTouches`.
 */
export function pieceBounds(p: Piece, frame: number): Rect {
  const b = boundsOfPoints(pieceCorners(p, frame)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.floor(b.x) - 1;
  const y = Math.floor(b.y) - 1;
  return { x, y, w: Math.ceil(b.x + b.w) + 1 - x, h: Math.ceil(b.y + b.h) + 1 - y };
}

/** The piece may draw something inside r at `frame` (a repeating one reaches everywhere). */
export function pieceTouches(p: Piece, frame: number, r: Rect): boolean {
  if (p.repeat !== 'none') return true;
  const b = pieceBounds(p, frame);
  return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
}

export function keyframeIndex(keys: readonly Keyframe[], frame: number): number {
  return keys.findIndex((k) => k.frame === frame);
}

/**
 * Set values at `frame` (auto-key): change that keyframe, or add one there that starts from
 * what the piece shows at that frame. A new keyframe keeps the easing of the segment it splits.
 */
export function setKey(keys: readonly Keyframe[], frame: number, change: KeyChange): Keyframe[] {
  const at = keyframeIndex(keys, frame);
  const out = keys.map(cloneKeyframe);
  if (at >= 0) {
    out[at] = { ...out[at], ...change };
    return out;
  }
  const state = stateAt(keys, frame) ?? identityState(0, 0);
  const before = [...keys].reverse().find((k) => k.frame < frame);
  const easing: Easing = before?.easing ?? 'linear';
  const k: Keyframe = { ...state, frame, easing, in: null, out: null, ...change };
  for (const key of STATE_KEYS) if (!Number.isFinite(k[key])) k[key] = state[key];
  out.push(k);
  return out.sort((a, b) => a.frame - b.frame);
}

/** Without the keyframe at `frame`, or null when it's the only one (a piece always has one). */
export function removeKey(keys: readonly Keyframe[], frame: number): Keyframe[] | null {
  if (keys.length <= 1 || keyframeIndex(keys, frame) < 0) return null;
  return keys.filter((k) => k.frame !== frame).map(cloneKeyframe);
}

/** The keyframe at `from` moved to `to`, or null when there's none at `from` or `to` is taken. */
export function moveKey(keys: readonly Keyframe[], from: number, to: number): Keyframe[] | null {
  const at = keyframeIndex(keys, from);
  if (at < 0 || to < 0 || !Number.isInteger(to) || (to !== from && keyframeIndex(keys, to) >= 0)) return null;
  const out = keys.map(cloneKeyframe);
  out[at] = { ...out[at], frame: to };
  return out.sort((a, b) => a.frame - b.frame);
}

/** Bytes of history a list of pieces holds besides the shared source images. */
export function piecesBytes(pieces: readonly Piece[]): number {
  return pieces.reduce((n, p) => n + 200 + p.keyframes.length * 120, 0);
}
