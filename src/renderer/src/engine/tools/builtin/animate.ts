import type { Point } from '../../core/geometry';
import { walkLayers } from '../../doc/Document';
import { handleCursor, ROTATE_HANDLE_OFFSET } from '../../live/BoxGeom';
import { movePivot, type Keyframe, type PieceState } from '../../anim/interpolate';
import { cloneKeyframe, pieceStateAt, setKey, type Piece } from '../../anim/piece';
import {
  docToLocal,
  handleLocal,
  insidePiece,
  localToDoc,
  moveState,
  pieceAt,
  PIECE_HANDLES,
  rotateState,
  scaleState,
  skewState,
  type PieceHandle,
} from '../../anim/pieceEdit';
import type { Overlay } from '../../render/Overlay';
import { registerTool } from '../ToolRegistry';
import type { ToolContext, ToolPointerEvent } from '../Tool';

/**
 * Animate: click a piece to select it, then drag it to move it, its box handles to scale or
 * stretch it (Ctrl on the top or bottom edge skews), the round handle to turn it, or the pivot
 * to change what it turns around. Every change keys the piece at the frame shown.
 */
type Hit = { kind: 'handle'; handle: PieceHandle } | { kind: 'rotate' } | { kind: 'pivot' } | { kind: 'body' };

interface Drag {
  id: string;
  hit: Hit;
  start: Point;
  /** Pointer to grabbed point, so the handle doesn't jump to the pointer. */
  grab: Point;
  s0: PieceState;
  keys0: Keyframe[];
  pivot0: Point;
  adding: boolean;
}

let drag: Drag | null = null;
let hovered: string | null = null;

const HIT_PX = 7;
const PIVOT_SNAP_PX = 8;

/** Pieces in drawing order (bottom to top) on layers that are showing. */
function visiblePieces(ctx: ToolContext): Piece[] {
  const out: Piece[] = [];
  for (const layer of walkLayers(ctx.doc.layers)) {
    if (layer.kind !== 'raster' || !ctx.doc.isEffectivelyVisible(layer.id)) continue;
    for (const p of ctx.doc.pieces) if (p.layerId === layer.id) out.push(p);
  }
  return out;
}

interface ScreenGeom {
  handles: Record<PieceHandle, Point>;
  rotate: Point;
  topMid: Point;
  pivot: Point;
  corners: Point[];
  angle: number;
}

function geometry(ctx: ToolContext, p: Piece): ScreenGeom {
  const s = pieceStateAt(p, ctx.anim.frame);
  const toScreen = (q: Point): Point => {
    const d = localToDoc(s, p.pivot, q);
    return ctx.view.toScreen(d.x, d.y);
  };
  const handles = {} as Record<PieceHandle, Point>;
  for (const h of PIECE_HANDLES) handles[h] = toScreen(handleLocal(p, h));
  const centre = toScreen({ x: p.src.w / 2, y: p.src.h / 2 });
  const topMid = handles.n;
  const len = Math.hypot(topMid.x - centre.x, topMid.y - centre.y) || 1;
  const rotate = { x: topMid.x + ((topMid.x - centre.x) / len) * ROTATE_HANDLE_OFFSET, y: topMid.y + ((topMid.y - centre.y) / len) * ROTATE_HANDLE_OFFSET };
  return {
    handles,
    rotate,
    topMid,
    pivot: toScreen(p.pivot),
    corners: [handles.nw, handles.ne, handles.se, handles.sw],
    angle: Math.atan2(handles.e.y - centre.y, handles.e.x - centre.x),
  };
}

const near = (a: Point, b: Point, px = HIT_PX): boolean => Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px;

function hitSelected(ctx: ToolContext, p: Piece, e: ToolPointerEvent): Hit | null {
  const g = geometry(ctx, p);
  const sp = { x: e.sx, y: e.sy };
  if (near(sp, g.pivot)) return { kind: 'pivot' };
  for (const h of PIECE_HANDLES) if (near(sp, g.handles[h])) return { kind: 'handle', handle: h };
  if (near(sp, g.rotate)) return { kind: 'rotate' };
  if (insidePiece(p, ctx.anim.frame, e)) return { kind: 'body' };
  return null;
}

function cursorFor(hit: Hit | null, g: ScreenGeom | null): string {
  if (!hit) return 'default';
  if (hit.kind === 'body') return 'move';
  if (hit.kind === 'pivot') return 'crosshair';
  if (hit.kind === 'rotate') return 'grab';
  return handleCursor(hit.handle, g?.angle ?? 0);
}

function stateChange(s: PieceState): Partial<PieceState> {
  return { x: s.x, y: s.y, sx: s.sx, sy: s.sy, angle: s.angle, skew: s.skew };
}

function drawPath(ctx: ToolContext, ov: Overlay, p: Piece): void {
  if (p.keyframes.length < 2) return;
  const first = p.keyframes[0].frame;
  const last = p.keyframes[p.keyframes.length - 1].frame;
  const pts: Point[] = [];
  // A point per frame, plus in-between ones on long jumps so curves stay smooth.
  const steps = Math.min(2000, Math.max(last - first, 1) * 2);
  for (let i = 0; i <= steps; i++) {
    const s = pieceStateAt(p, first + ((last - first) * i) / steps);
    pts.push(ctx.view.toScreen(s.x, s.y));
  }
  ov.outlineScreen(pts, false, true);
  for (const k of p.keyframes) ov.handle(ctx.view.toScreen(k.x, k.y), 'circle', k.frame === ctx.anim.frame);
}

export default registerTool({
  id: 'animate',
  labelKey: 'tool.animate',
  hintKey: 'tool.animate.hint',
  icon: 'animate',
  shortcut: 'A',
  group: 'tools',
  order: 90,
  galleryOnly: true,
  options: [],
  cursor: () => 'default',
  deactivate(ctx) {
    if (drag) ctx.anim.cancelDrag();
    drag = null;
    hovered = null;
  },
  pointerDown(ctx, e) {
    if (e.button !== 0) return;
    let piece = ctx.anim.selected;
    let hit = piece ? hitSelected(ctx, piece, e) : null;
    if (!hit) {
      piece = pieceAt(visiblePieces(ctx), ctx.anim.frame, e);
      ctx.anim.select(piece?.id ?? null);
      if (!piece) return;
      hit = { kind: 'body' };
    }
    if (!piece) return;
    const frame = ctx.anim.frame;
    const s0 = pieceStateAt(piece, frame);
    let grab = { x: 0, y: 0 };
    if (hit.kind === 'handle') {
      const d = localToDoc(s0, piece.pivot, handleLocal(piece, hit.handle));
      grab = { x: d.x - e.x, y: d.y - e.y };
    }
    drag = {
      id: piece.id,
      hit,
      start: { x: e.x, y: e.y },
      grab,
      s0,
      keys0: piece.keyframes.map(cloneKeyframe),
      pivot0: { ...piece.pivot },
      adding: !piece.keyframes.some((k) => k.frame === frame),
    };
    ctx.anim.beginDrag();
  },
  pointerMove(ctx, e) {
    const d = drag;
    if (!d) return;
    const frame = ctx.anim.frame;
    const p = { x: e.x + d.grab.x, y: e.y + d.grab.y };
    if (d.hit.kind === 'pivot') {
      const piece = ctx.anim.piece(d.id);
      if (!piece) return;
      let next = docToLocal(d.s0, d.pivot0, p);
      if (!next) return;
      // Snap to the middle, where most pivots go back to.
      const mid = { x: piece.src.w / 2, y: piece.src.h / 2 };
      const midScreen = ctx.view.toScreen(localToDoc(d.s0, d.pivot0, mid).x, localToDoc(d.s0, d.pivot0, mid).y);
      if (near({ x: e.sx, y: e.sy }, midScreen, PIVOT_SNAP_PX)) next = mid;
      const pivot = next;
      ctx.anim.preview(d.id, (q) => {
        q.keyframes = movePivot(d.keys0, d.pivot0, pivot);
        q.pivot = { ...pivot };
      });
      return;
    }
    let s: PieceState;
    const piece = ctx.anim.piece(d.id);
    if (!piece) return;
    const geom = { src: piece.src, pivot: d.pivot0 };
    if (d.hit.kind === 'body') s = moveState(d.s0, e.x - d.start.x, e.y - d.start.y, e.shift);
    else if (d.hit.kind === 'rotate') s = rotateState(d.s0, d.start, { x: e.x, y: e.y }, e.shift);
    else if (e.ctrl && (d.hit.handle === 'n' || d.hit.handle === 's')) s = skewState(d.s0, geom, d.hit.handle, p);
    else s = scaleState(d.s0, geom, d.hit.handle, p, { shift: e.shift, alt: e.alt });
    const change = stateChange(s);
    ctx.anim.preview(d.id, (q) => (q.keyframes = setKey(d.keys0, frame, change)));
  },
  pointerUp(ctx) {
    const d = drag;
    drag = null;
    if (!d) return;
    ctx.anim.endDrag(d.hit.kind === 'pivot' ? 'history.pivot' : d.adding ? 'history.keyframeAdd' : 'history.keyframe');
  },
  hover(ctx, e) {
    const sel = ctx.anim.selected;
    const hit = sel ? hitSelected(ctx, sel, e) : null;
    const over = hit ? null : pieceAt(visiblePieces(ctx), ctx.anim.frame, e);
    const id = over?.id ?? null;
    if (id !== hovered) {
      hovered = id;
      ctx.invalidateOverlay();
    }
    ctx.setCursor(hit ? cursorFor(hit, sel ? geometry(ctx, sel) : null) : over ? 'pointer' : 'default');
  },
  keyDown(ctx, e) {
    const p = ctx.anim.selected;
    if (e.key === 'Escape') {
      if (drag) {
        ctx.anim.cancelDrag();
        drag = null;
        return true;
      }
      if (p) {
        ctx.anim.select(null);
        return true;
      }
      return false;
    }
    if (!p || drag || e.ctrlKey || e.altKey || e.metaKey) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      ctx.anim.remove(p.id);
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = move[e.key];
    if (!m) return false;
    const s = pieceStateAt(p, ctx.anim.frame);
    ctx.anim.setKey(p.id, ctx.anim.frame, { x: s.x + m[0], y: s.y + m[1] });
    return true;
  },
  drawOverlay(ctx, ov) {
    const sel = ctx.anim.selected;
    for (const p of visiblePieces(ctx)) {
      if (p === sel) continue;
      // Unselected pieces show a faint outline, so they can be found and clicked.
      const g = geometry(ctx, p);
      if (p.id === hovered) ov.outlineScreen(g.corners, true, false);
      else ov.outlineScreen(g.corners, true, true);
    }
    if (!sel || !ctx.doc.isEffectivelyVisible(sel.layerId)) return;
    drawPath(ctx, ov, sel);
    const g = geometry(ctx, sel);
    ov.outlineScreen(g.corners, true, false);
    const active = drag?.hit;
    for (const h of PIECE_HANDLES) ov.handle(g.handles[h], 'square', active?.kind === 'handle' && active.handle === h);
    ov.line(g.topMid, g.rotate);
    ov.handle(g.rotate, 'circle', active?.kind === 'rotate');
    ov.pivot(g.pivot, active?.kind === 'pivot');
  },
});
