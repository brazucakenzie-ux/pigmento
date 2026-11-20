import type { Point } from '../core/geometry';
import { rootOf, subtree } from '../anim/links';
import { pieceStateAt, type Piece } from '../anim/piece';
import type { PieceState } from '../anim/interpolate';
import type { Scene } from '../anim/scene';
import { project, unproject } from '../anim/space';
import type { Overlay } from '../render/Overlay';
import type { ToolContext } from './Tool';

/**
 * Editing linked pieces with the Animate and Perspective plane tools: dragging any piece of a
 * tree moves, turns or tilts the whole tree (its top: a group, or the piece the others follow);
 * Alt-dragging changes just that piece (a hinged one folds, one that follows another moves on
 * that piece's plane).
 */

/** The top of the tree `p` is in, if it's in one (it follows a piece, is a group, or has pieces following it). */
export function treeTop(ctx: ToolContext, p: Piece): Piece | null {
  if (p.link || p.kind === 'group' || ctx.doc.pieces.some((q) => q.link?.parent === p.id)) return rootOf(ctx.doc.pieces, p);
  return null;
}

/** The pieces of pixels in the tree with `top` at its top. */
export function treePieces(ctx: ToolContext, top: Piece): Piece[] {
  return subtree(ctx.doc.pieces, top.id).filter((p) => p.kind === 'piece');
}

/** Where the top of a tree turns about, on screen (null behind the camera). */
export function topPivot(ctx: ToolContext, scene: Scene, top: Piece): Point | null {
  const d = project(scene.placement(top), top.pivot);
  return d && ctx.view.toScreen(d.x, d.y);
}

/** Screen pixels from a tree's pivot to its tilt and turn handles, and to its spin handle. */
const ARM = 56;
const SPIN = 84;

export type TreeHandle = { kind: 'tilt'; handle: 'n' | 's' } | { kind: 'turn'; handle: 'e' | 'w' } | { kind: 'spin' };

/** A tree's own handles round its pivot (on screen): tilt above and below, turn either side, spin further up. */
export function treeHandles(centre: Point): { at: Point; hit: TreeHandle }[] {
  return [
    { at: { x: centre.x, y: centre.y - ARM }, hit: { kind: 'tilt', handle: 'n' } },
    { at: { x: centre.x, y: centre.y + ARM }, hit: { kind: 'tilt', handle: 's' } },
    { at: { x: centre.x + ARM, y: centre.y }, hit: { kind: 'turn', handle: 'e' } },
    { at: { x: centre.x - ARM, y: centre.y }, hit: { kind: 'turn', handle: 'w' } },
    { at: { x: centre.x, y: centre.y - SPIN }, hit: { kind: 'spin' } },
  ];
}

/** Draw a tree's handles round its pivot, and outline its pieces. */
export function drawTree(ctx: ToolContext, ov: Overlay, scene: Scene, top: Piece, active: TreeHandle | null): void {
  for (const p of treePieces(ctx, top)) ov.outlineScreen(scene.corners(p).map((q) => ctx.view.toScreen(q.x, q.y)), true, true);
  const c = topPivot(ctx, scene, top);
  if (!c) return;
  for (const h of treeHandles(c)) {
    ov.line(c, h.at, true);
    const on = active !== null && active.kind === h.hit.kind && (!('handle' in active) || ('handle' in h.hit && active.handle === h.hit.handle));
    ov.handle(h.at, 'circle', on);
  }
  ov.pivot(c, false);
}

/**
 * Alt-dragging a piece that follows another: it slides on that piece's plane, following the
 * pointer from `start` to `now` (canvas points); Shift keeps it level or upright there.
 */
export function slideOnParent(scene: Scene, piece: Piece, s0: PieceState, start: Point, now: Point, shift: boolean): Partial<PieceState> | null {
  const parent = scene.parentOf(piece);
  if (!parent) return null;
  const pl = scene.placement(parent);
  const read = (p: Point): Point | null => {
    if (!pl.affine) return unproject(pl, p);
    const m = pl.affine;
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return null;
    const x = p.x - m[4];
    const y = p.y - m[5];
    return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
  };
  const a = read(start);
  const b = read(now);
  if (!a || !b) return null;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (shift) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { x: s0.x + dx, y: s0.y + dy };
}

/**
 * Keys for what the Animate and Perspective plane tools have selected, keyed at the frame shown:
 * Delete removes the piece; the arrows nudge it (Shift: 10 px), fold a hinged one (Up folds it
 * back, Down forward; Shift: 15°), or slide the camera while its timeline row is selected. False
 * when the key isn't one of these.
 */
export function selectionKeys(ctx: ToolContext, e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  const p = ctx.anim.selected;
  const step = e.shiftKey ? 10 : 1;
  const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const m = move[e.key];
  if (!p) {
    if (!ctx.anim.cameraSelected || !m) return false;
    const c = ctx.anim.cameraFields();
    ctx.anim.setCameraKey(ctx.anim.frame, { panX: c.panX + m[0], panY: c.panY + m[1] });
    return true;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    ctx.anim.remove(p.id);
    return true;
  }
  if (p.link?.hinge) {
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (!dir) return false;
    const fold = pieceStateAt(p, ctx.anim.frame).fold + (dir * (e.shiftKey ? 15 : 1) * Math.PI) / 180;
    ctx.anim.setKey(p.id, ctx.anim.frame, { fold });
    return true;
  }
  if (!m) return false;
  const s = pieceStateAt(p, ctx.anim.frame);
  ctx.anim.setKey(p.id, ctx.anim.frame, { x: s.x + m[0], y: s.y + m[1] });
  return true;
}
