import { boundsOfPoints, type Point, type Rect } from '../core/geometry';
import { matApplyPoints } from '../core/matrix';
import {
  frameApply,
  frameChain,
  frameNormal,
  hingeFrame,
  localFrame,
  placementFromFrame,
  rootFrame,
  type Frame,
} from './frames';
import type { PieceState } from './interpolate';
import { pieceStateAt, type Follow, type Piece } from './piece';
import type { PathMeasure } from './pathMeasure';
import {
  FLAT_SPACE,
  placementOf,
  placementOutline,
  shadeFor,
  shadeOf,
  type Light,
  type Placement,
  type Space,
  type Vec3,
} from './space';

/** Most pieces one tree of linked pieces can hold (its group included). */
export const MAX_TREE = 64;

/** Where a piece is at one moment, with what it follows taken into account. */
export interface Pose {
  readonly piece: Piece;
  /** Its own state at the frame (relative to the piece it follows, if it follows one). */
  readonly state: PieceState;
  /** Its own pixels in 3D. */
  readonly frame: Frame;
  readonly placement: Placement;
  /** Its opacity times its groups'. */
  readonly opacity: number;
  /** What it passes on to the pieces under it: its groups' opacity, and its own if it's a group. */
  readonly carried: number;
  /** It follows another piece. */
  readonly linked: boolean;
}

/**
 * The pieces at one frame, as one camera sees them: each piece's pose, worked out once (a
 * piece's parent first). Pieces change between frames and edits, so a scene is made for one
 * drawing, hit test or drag step and then dropped.
 */
export class Scene {
  private byId: Map<string, Piece> | null = null;
  private readonly poses = new Map<string, Pose>();

  constructor(
    readonly pieces: readonly Piece[],
    readonly frame: number,
    readonly space: Space = FLAT_SPACE,
    /** Finds the paths pieces follow (without it, they keep to their own x and y). */
    readonly paths: ((f: Follow) => PathMeasure | null) | null = null,
  ) {}

  piece(id: string): Piece | null {
    if (!this.byId) this.byId = new Map(this.pieces.map((p) => [p.id, p]));
    return this.byId.get(id) ?? null;
  }

  /** The piece p follows, or null (none, or a link that doesn't hold: missing, on another layer, or itself; groups follow nothing). */
  parentOf(p: Piece): Piece | null {
    if (!p.link || p.kind === 'group') return null;
    const q = this.piece(p.link.parent);
    return q && q !== p && q.layerId === p.layerId ? q : null;
  }

  pose(p: Piece): Pose {
    const hit = this.poses.get(p.id);
    if (hit) return hit;
    // Up to the nearest piece already placed, or the top; a loop, or a chain longer than any tree, is cut there.
    const chain: Piece[] = [p];
    const seen = new Set<string>([p.id]);
    let top: Pose | null = null;
    for (let q = this.parentOf(p); q; q = this.parentOf(q)) {
      const known = this.poses.get(q.id);
      if (known) {
        top = known;
        break;
      }
      if (seen.has(q.id) || chain.length >= MAX_TREE) break;
      seen.add(q.id);
      chain.push(q);
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const parent = i === chain.length - 1 ? top : this.poses.get(chain[i + 1].id)!;
      this.poses.set(chain[i].id, this.compute(chain[i], parent));
    }
    return this.poses.get(p.id)!;
  }

  /**
   * A piece's own state at `frame`. One following a path (and nothing else) is placed along it by
   * its progress.
   */
  stateAt(p: Piece, frame: number): PieceState {
    const s = pieceStateAt(p, frame);
    if (!p.follow || p.link || !this.paths) return s;
    const path = this.paths(p.follow);
    if (!path) return s;
    const at = path.at(s.progress);
    return { ...s, x: at.x, y: at.y };
  }

  private compute(p: Piece, parent: Pose | null): Pose {
    const state = this.stateAt(p, this.frame);
    const { width: w, height: h } = p.src;
    if (!parent) {
      const opacity = state.opacity;
      return {
        piece: p,
        state,
        frame: rootFrame(state, p.pivot, this.space),
        placement: placementOf(state, p.pivot, w, h, this.space),
        opacity,
        carried: p.kind === 'group' ? opacity : 1,
        linked: false,
      };
    }
    const hinge = p.link?.hinge;
    const local =
      hinge && parent.piece.kind === 'piece'
        ? hingeFrame(parent.piece.src.width, parent.piece.src.height, w, h, hinge, state.fold)
        : localFrame(state, p.pivot);
    const frame = frameChain(parent.frame, local);
    const opacity = state.opacity * parent.carried;
    return {
      piece: p,
      state,
      frame,
      placement: placementFromFrame(frame, w, h, this.space),
      opacity,
      carried: p.kind === 'group' ? opacity : parent.carried,
      linked: true,
    };
  }

  placement(p: Piece): Placement {
    return this.pose(p).placement;
  }

  opacity(p: Piece): number {
    return this.pose(p).opacity;
  }

  /** It's drawn: a piece of pixels (not a group), not see-through, and not a back that's hidden. */
  shows(p: Piece): boolean {
    if (p.kind === 'group') return false;
    const ps = this.pose(p);
    return ps.opacity > 0 && (ps.placement.front || p.back !== 'hide');
  }

  /** Piece point q (its own pixels) in 3D. */
  worldOf(p: Piece, q: Point): Vec3 {
    return frameApply(this.pose(p).frame, q.x, q.y);
  }

  /** How bright its side facing the camera is in the light (see shadeOf). */
  shade(p: Piece, light: Light): number {
    if (p.shade <= 0) return 1;
    const ps = this.pose(p);
    if (!ps.linked) return shadeOf(ps.state, ps.placement.front, light, p.shade);
    return ps.placement.affine
      ? 1
      : shadeFor(frameNormal(ps.frame), ps.placement.front, light, p.shade);
  }

  /**
   * The piece's box on the canvas, in document pixels: its four corners, or in 3D the outline of
   * the part in front of the camera.
   */
  corners(p: Piece): Point[] {
    const { width: w, height: h } = p.src;
    const pl = this.placement(p);
    if (!pl.affine) return placementOutline(pl, w, h, this.space);
    return matApplyPoints(pl.affine, [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ]);
  }

  /**
   * Area the piece's own box covers (rounded out to whole pixels, plus one for smoothing). A
   * repeating piece draws beyond it: see `touches`.
   */
  bounds(p: Piece): Rect {
    const b = boundsOfPoints(this.corners(p)) ?? { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.floor(b.x) - 1;
    const y = Math.floor(b.y) - 1;
    return { x, y, w: Math.ceil(b.x + b.w) + 1 - x, h: Math.ceil(b.y + b.h) + 1 - y };
  }

  /** The piece may draw something inside r (a repeating one reaches everywhere). */
  touches(p: Piece, r: Rect): boolean {
    if (p.repeat !== 'none') return true;
    const b = this.bounds(p);
    return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
  }

  /** Pieces back to front: the furthest away first (by their middles), ties in list order. */
  backToFront(list: readonly Piece[]): Piece[] {
    const keyed = list.map((p, i) => ({ p, i, d: this.placement(p).depth }));
    if (keyed.every((k) => k.d === keyed[0]?.d)) return [...list];
    return keyed.sort((a, b) => b.d - a.d || a.i - b.i).map((k) => k.p);
  }
}

/** Where a piece on its own (following nothing) is at `frame`, in 3D as `space` sees it. */
export function piecePlacementAt(p: Piece, frame: number, space: Space = FLAT_SPACE): Placement {
  return new Scene([p], frame, space).placement(p);
}

/** A piece's corners on its own at `frame` (see Scene.corners). */
export function pieceCorners(p: Piece, frame: number, space: Space = FLAT_SPACE): Point[] {
  return new Scene([p], frame, space).corners(p);
}

/** A piece's bounds on its own at `frame` (see Scene.bounds). */
export function pieceBounds(p: Piece, frame: number, space: Space = FLAT_SPACE): Rect {
  return new Scene([p], frame, space).bounds(p);
}

/** A piece on its own may draw inside r at `frame` (see Scene.touches). */
export function pieceTouches(p: Piece, frame: number, r: Rect, space: Space = FLAT_SPACE): boolean {
  return new Scene([p], frame, space).touches(p, r);
}

/** Pieces back to front at `frame` (see Scene.backToFront). */
export function backToFront(
  pieces: readonly Piece[],
  frame: number,
  space: Space = FLAT_SPACE,
): Piece[] {
  return new Scene(pieces, frame, space).backToFront(pieces);
}
