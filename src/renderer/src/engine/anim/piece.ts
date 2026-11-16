import { boundsOfPoints, type Point, type Rect } from '../core/geometry';
import { matApplyPoints, type Mat } from '../core/matrix';
import type { ImageBuf } from '../raster/transform';
import { identityState, stateAt, stateMatrix, STATE_KEYS, type Easing, type Keyframe, type PieceState } from './interpolate';

/**
 * Pixels lifted from a selection on a pixel layer and animated with keyframes. It's drawn just
 * above its layer's pixels, inside the layer. `src` never changes once the piece is made, so
 * undo snapshots share it.
 */
export interface Piece {
  readonly id: string;
  /** User content ('' = unnamed; the UI shows a localised default). */
  name: string;
  layerId: string;
  readonly src: ImageBuf;
  /** Where the pixels were lifted from, in document pixels. */
  readonly home: Rect;
  /** The point it turns and scales around, in source pixels. */
  pivot: Point;
  /** Sorted by frame, one per frame, never empty. */
  keyframes: Keyframe[];
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

export function makePiece(id: string, name: string, layerId: string, src: ImageBuf, home: Rect, frame: number): Piece {
  const pivot = { x: src.w / 2, y: src.h / 2 };
  return {
    id,
    name,
    layerId,
    src,
    home: { ...home },
    pivot,
    keyframes: [{ ...identityState(home.x + pivot.x, home.y + pivot.y), frame, easing: 'linear', in: null, out: null }],
  };
}

export function clonePiece(p: Piece): Piece {
  return { ...p, home: { ...p.home }, pivot: { ...p.pivot }, keyframes: p.keyframes.map(cloneKeyframe) };
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
  return matApplyPoints(pieceMatrixAt(p, frame), [
    { x: 0, y: 0 },
    { x: p.src.w, y: 0 },
    { x: p.src.w, y: p.src.h },
    { x: 0, y: p.src.h },
  ]);
}

/** Area the piece covers at `frame` (rounded out to whole pixels, plus one for smoothing). */
export function pieceBounds(p: Piece, frame: number): Rect {
  const b = boundsOfPoints(pieceCorners(p, frame)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.floor(b.x) - 1;
  const y = Math.floor(b.y) - 1;
  return { x, y, w: Math.ceil(b.x + b.w) + 1 - x, h: Math.ceil(b.y + b.h) + 1 - y };
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
