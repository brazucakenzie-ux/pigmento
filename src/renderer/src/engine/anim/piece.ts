import type { Point, Rect } from '../core/geometry';
import { Surface } from '../raster/Surface';
import { cloneTrail, type Trail } from './trail';
import type { ImageBuf } from '../raster/transform';
import type { Hinge } from './frames';
import { identityState, stateAt, STATE_KEYS, type Easing, type Keyframe, type PieceState } from './interpolate';

/**
 * Pixels with their own size, belonging to a pixel layer and animated with keyframes. It's
 * drawn just above its layer's pixels, inside the layer, and may sit partly or wholly outside
 * the canvas. `src` is only ever written inside a surface edit (so a tile is copied before it
 * changes), which lets undo snapshots and copies share its tiles.
 */
export interface Piece {
  readonly id: string;
  /**
   * A piece of pixels, or a group: an empty piece that's never drawn, whose state carries the
   * pieces linked under it (a box spins about its group's pivot, in its middle).
   */
  readonly kind: PieceKind;
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
  /** Shading by the picture's light in 3D: 0 (off) … 1 (a face turned away from the light can go black). */
  shade: number;
  /** Turned round in 3D: its pixels show mirrored, like paper, or it isn't drawn. */
  back: Back;
  /**
   * The piece it follows (on the same layer; null = none): its keyframes are then relative to that
   * piece's own pixels, or, hinged, it hangs off one of that piece's edges at its fold angle.
   */
  link: Link | null;
  /**
   * The path it follows (a shape on a shape layer; null = none): while it does, its keyframes'
   * progress places it along the path, and their x and y aren't used. Only a piece that follows
   * no other piece can follow a path.
   */
  follow: Follow | null;
  /**
   * Facing the way it goes: while on, a piece that follows no other piece turns so its art points
   * where it's heading on the canvas, its keyed angle added on top (not keyframed).
   */
  face: Face;
  /** What it leaves behind as it moves (up to MAX_TRAILS; see trail.ts). Not keyframed, but their emission is keyed. */
  trails: Trail[];
  /** After its last keyframe its moves start again from the first (loop) or run back and forth (pingpong). */
  loop: PieceLoop;
}

export type PieceLoop = 'off' | 'loop' | 'pingpong';
export const PIECE_LOOPS: readonly PieceLoop[] = ['off', 'loop', 'pingpong'];

/**
 * The frame of a piece's own keyframes that `frame` shows: itself up to its last keyframe (and
 * before its first, where it holds); after the last, its moves again from the first (loop), or
 * back and forth between the first and the last (pingpong).
 */
export function loopFrame(keys: readonly { frame: number }[], loop: PieceLoop, frame: number): number {
  if (loop === 'off' || keys.length < 2) return frame;
  const f0 = keys[0].frame;
  const f1 = keys[keys.length - 1].frame;
  const span = f1 - f0;
  if (span <= 0 || frame <= f1) return frame;
  const t = frame - f0;
  if (loop === 'loop') return f0 + (t % span);
  const m = t % (2 * span);
  return f0 + (m <= span ? m : 2 * span - m);
}

/** Facing the way it goes, and which way the art points as drawn (radians in its own pixels: 0 = right, clockwise). */
export interface Face {
  on: boolean;
  angle: number;
}

/** A shape a piece follows: on which shape layer, which object, and which of its outlines. */
export interface Follow {
  layerId: string;
  objectId: string;
  sub: number;
}

export type PieceKind = 'piece' | 'group';

export interface Link {
  parent: string;
  /** null: it follows the parent's pixels (keyframes relative to them), without a hinge. */
  hinge: Hinge | null;
}

export type Repeat = 'none' | 'x' | 'y' | 'both';
export const REPEATS: readonly Repeat[] = ['none', 'x', 'y', 'both'];

export type Back = 'mirror' | 'hide';
export const BACKS: readonly Back[] = ['mirror', 'hide'];

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
/** Most a piece's progress along a path can be either way, in whole paths (far more turns than any loop needs). */
export const MAX_PROGRESS = 1e6;

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
    back: 'mirror',
    shade: 0,
    kind: 'piece',
    link: null,
    follow: null,
    face: { on: false, angle: 0 },
    trails: [],
    loop: 'off',
  };
}

/** A group whose pivot is at `pivot` (document pixels while it's untouched), keyed from `keyframes`. */
export function makeGroup(id: string, name: string, layerId: string, home: Rect, pivot: Point, keyframes: readonly Keyframe[]): Piece {
  return {
    id,
    name,
    layerId,
    src: new Surface(1, 1),
    home: { ...home },
    pivot: { ...pivot },
    keyframes: keyframes.map(cloneKeyframe),
    repeat: 'none',
    back: 'mirror',
    shade: 0,
    kind: 'group',
    link: null,
    follow: null,
    face: { on: false, angle: 0 },
    trails: [],
    loop: 'off',
  };
}

export function cloneLink(l: Link | null): Link | null {
  return l && { parent: l.parent, hinge: l.hinge && { ...l.hinge } };
}

/** The same piece (for undo snapshots: the pixels are shared, not copied). */
export function clonePiece(p: Piece): Piece {
  return { ...p, home: { ...p.home }, pivot: { ...p.pivot }, keyframes: p.keyframes.map(cloneKeyframe), link: cloneLink(p.link), follow: p.follow && { ...p.follow }, face: { ...p.face }, trails: p.trails.map(cloneTrail) };
}

/**
 * A separate copy with its own id: its pixels share tiles until either is painted on. Its link
 * still names the old parent; copyPieces renames links within the copies.
 */
export function copyPiece(p: Piece, id: string, layerId: string): Piece {
  return { ...clonePiece(p), id, layerId, src: p.src.snapshot() };
}

/**
 * Copies of `pieces` with new ids (from `newId`) on the layers `layerOf` gives, linked to each
 * other as the originals were; a link to a piece that isn't copied is dropped (the copy stays where
 * it is relative to nothing, so callers copy whole trees).
 */
export function copyPieces(pieces: readonly Piece[], newId: () => string, layerOf: (p: Piece) => string): Piece[] {
  const ids = new Map(pieces.map((p) => [p.id, newId()]));
  return pieces.map((p) => {
    const c = copyPiece(p, ids.get(p.id)!, layerOf(p));
    const parent = p.link && ids.get(p.link.parent);
    c.link = parent && p.link ? { parent, hinge: p.link.hinge && { ...p.link.hinge } } : null;
    return c;
  });
}

export function cloneKeyframe(k: Keyframe): Keyframe {
  return { ...k, in: k.in && { ...k.in }, out: k.out && { ...k.out } };
}

export function pieceStateAt(p: Piece, frame: number): PieceState {
  // Never empty, so stateAt always has an answer.
  return stateAt(p.keyframes, loopFrame(p.keyframes, p.loop, frame)) ?? identityState(p.home.x + p.pivot.x, p.home.y + p.pivot.y);
}


export function keyframeIndex(keys: readonly Keyframe[], frame: number): number {
  return keys.findIndex((k) => k.frame === frame);
}

/**
 * Set values at `frame` (auto-key): change that keyframe, or add one there that starts from
 * what the piece shows at that frame. A new keyframe keeps the easing of the segment it splits.
 */
export function setKey(keys: readonly Keyframe[], frame: number, change: KeyChange, loop: PieceLoop = 'off'): Keyframe[] {
  const at = keyframeIndex(keys, frame);
  const out = keys.map(cloneKeyframe);
  if (at >= 0) {
    out[at] = { ...out[at], ...change };
    return out;
  }
  // A new key starts from what shows there (on a repeat of a loop, the moves it repeats).
  const state = stateAt(keys, loopFrame(keys, loop, frame)) ?? identityState(0, 0);
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
