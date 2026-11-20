import { findSnap, type EdgeSnap } from '../anim/edgeSnap';
import { subtree } from '../anim/links';
import type { Piece } from '../anim/piece';
import { piecesInDrawOrder } from '../anim/pieceRaster';
import type { Overlay } from '../render/Overlay';
import type { ToolContext } from './Tool';

/** Screen pixels within which a dragged piece's edge meets another piece's edge. */
export const HINGE_SNAP_PX = 10;

/**
 * Where `piece`, being dragged, would hinge if it were let go now: onto an edge of another piece
 * showing on its layer (not one of its own). Null with Alt held, for a piece that already
 * follows another or a group, or when no edge is near.
 */
export function hingeSnap(ctx: ToolContext, piece: Piece, alt: boolean): EdgeSnap | null {
  if (alt || piece.kind !== 'piece' || piece.link) return null;
  const scene = ctx.anim.scene();
  const own = new Set(subtree(ctx.doc.pieces, piece.id).map((p) => p.id));
  const targets = piecesInDrawOrder(ctx.doc, scene).filter((p) => p.layerId === piece.layerId && !own.has(p.id));
  return findSnap(scene, piece, targets, HINGE_SNAP_PX / ctx.view.zoom);
}

/** Light up the edge it would hinge onto. */
export function drawHingeSnap(ctx: ToolContext, ov: Overlay, snap: EdgeSnap): void {
  const [a, b] = snap.line;
  ov.hingeEdge(ctx.view.toScreen(a.x, a.y), ctx.view.toScreen(b.x, b.y));
}

/** Let go of a drag that found an edge: it hinges there, one undo step in place of the move. */
export function hingeOnRelease(ctx: ToolContext, id: string, snap: EdgeSnap): void {
  ctx.anim.cancelDrag();
  ctx.anim.hinge(id, snap.parent.id, snap.hinge, snap.fold);
}
