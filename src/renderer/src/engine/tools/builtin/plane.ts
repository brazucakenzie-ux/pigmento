import type { Point } from '../../core/geometry';
import { walkLayers } from '../../doc/Document';
import { ROTATE_HANDLE_OFFSET } from '../../live/BoxGeom';
import type { Keyframe, PieceState } from '../../anim/interpolate';
import { cloneKeyframe, pieceCorners, pieceStateAt, setKey, type Piece } from '../../anim/piece';
import { insidePiece, moveState, pieceAt, rotateState } from '../../anim/pieceEdit';
import { depthDrag, movePivot3D, resizeDrag, tiltDrag, turnDrag } from '../../anim/planeEdit';
import { placementOf, project, unproject } from '../../anim/space';
import { registerTool } from '../ToolRegistry';
import type { ToolContext, ToolPointerEvent } from '../Tool';

/**
 * Perspective plane: a piece is a sheet of paper in 3D. Drag it to move it across the picture
 * (Ctrl-drag pushes it away or pulls it closer), drag its top or bottom handle to tilt it back
 * or forward, a side handle to turn it like a door, the round handle to spin it, a corner to
 * resize it on its own plane (Shift keeps the proportions), or the pivot to change what it turns
 * about. Shift snaps tilt and turn to 15°. Every change keys the piece at the frame shown.
 */
type Hit =
  | { kind: 'body' }
  | { kind: 'tilt'; handle: 'n' | 's' }
  | { kind: 'turn'; handle: 'e' | 'w' }
  | { kind: 'spin' }
  | { kind: 'corner'; corner: Point }
  | { kind: 'pivot' };

interface Drag {
  id: string;
  hit: Hit;
  /** Where the pointer was, in document and screen pixels. */
  start: Point;
  startScreen: Point;
  s0: PieceState;
  keys0: Keyframe[];
  pivot0: Point;
  /** Ctrl when a body drag began: it changes the depth. */
  depth: boolean;
  adding: boolean;
}

let drag: Drag | null = null;
let hovered: string | null = null;

const HIT_PX = 7;

function visiblePieces(ctx: ToolContext): Piece[] {
  const out: Piece[] = [];
  for (const layer of walkLayers(ctx.doc.layers)) {
    if (layer.kind !== 'raster' || !ctx.doc.isEffectivelyVisible(layer.id)) continue;
    for (const p of ctx.doc.pieces) if (p.layerId === layer.id) out.push(p);
  }
  return out;
}

interface ScreenGeom {
  corners: { at: Point; local: Point }[];
  edges: { at: Point; hit: Hit }[];
  spin: Point | null;
  top: Point | null;
  pivot: Point | null;
  outline: Point[];
}

/** Where the piece's handles show on screen at the frame shown (handles behind the camera are left out). */
function geometry(ctx: ToolContext, p: Piece): ScreenGeom {
  const s = pieceStateAt(p, ctx.anim.frame);
  const { width: w, height: h } = p.src;
  const pl = placementOf(s, p.pivot, w, h, ctx.doc.space);
  const at = (q: Point): Point | null => {
    const d = project(pl, q);
    return d && ctx.view.toScreen(d.x, d.y);
  };
  const corners: ScreenGeom['corners'] = [];
  for (const local of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]) {
    const sp = at(local);
    if (sp) corners.push({ at: sp, local });
  }
  const edges: ScreenGeom['edges'] = [];
  const add = (q: Point, hit: Hit) => {
    const sp = at(q);
    if (sp) edges.push({ at: sp, hit });
  };
  add({ x: w / 2, y: 0 }, { kind: 'tilt', handle: 'n' });
  add({ x: w / 2, y: h }, { kind: 'tilt', handle: 's' });
  add({ x: w, y: h / 2 }, { kind: 'turn', handle: 'e' });
  add({ x: 0, y: h / 2 }, { kind: 'turn', handle: 'w' });
  const top = at({ x: w / 2, y: 0 });
  const mid = at({ x: w / 2, y: h / 2 });
  let spin: Point | null = null;
  if (top && mid) {
    const len = Math.hypot(top.x - mid.x, top.y - mid.y) || 1;
    spin = { x: top.x + ((top.x - mid.x) / len) * ROTATE_HANDLE_OFFSET, y: top.y + ((top.y - mid.y) / len) * ROTATE_HANDLE_OFFSET };
  }
  const outline = pieceCorners(p, ctx.anim.frame, ctx.doc.space).map((q) => ctx.view.toScreen(q.x, q.y));
  return { corners, edges, spin, top, pivot: at(p.pivot), outline };
}

const near = (a: Point, b: Point, px = HIT_PX): boolean => Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px;

function hitSelected(ctx: ToolContext, p: Piece, e: ToolPointerEvent): Hit | null {
  const g = geometry(ctx, p);
  const sp = { x: e.sx, y: e.sy };
  if (g.spin && near(sp, g.spin)) return { kind: 'spin' };
  if (g.pivot && near(sp, g.pivot)) return { kind: 'pivot' };
  for (const c of g.corners) if (near(sp, c.at)) return { kind: 'corner', corner: c.local };
  for (const edge of g.edges) if (near(sp, edge.at)) return edge.hit;
  if (insidePiece(p, ctx.anim.frame, e, ctx.doc.space)) return { kind: 'body' };
  return null;
}

function cursorFor(hit: Hit | null, ctrl: boolean): string {
  if (!hit) return 'default';
  switch (hit.kind) {
    case 'body':
      return ctrl ? 'ns-resize' : 'move';
    case 'tilt':
      return 'ns-resize';
    case 'turn':
      return 'ew-resize';
    case 'spin':
      return 'grab';
    case 'corner':
      return 'nwse-resize';
    case 'pivot':
      return 'crosshair';
  }
}

function stateChange(s: PieceState): Partial<PieceState> {
  return { x: s.x, y: s.y, sx: s.sx, sy: s.sy, angle: s.angle, depth: s.depth, tilt: s.tilt, turn: s.turn };
}

export default registerTool({
  id: 'plane',
  labelKey: 'tool.plane',
  hintKey: 'tool.plane.hint',
  icon: 'plane',
  shortcut: 'M',
  group: 'tools',
  order: 91,
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
    // A repeating piece's copies reach everywhere: a piece showing on top of them is picked instead.
    if (piece && hit?.kind === 'body' && piece.repeat !== 'none') {
      const top = pieceAt(visiblePieces(ctx), ctx.anim.frame, e, ctx.doc.space);
      if (top && top.id !== piece.id) hit = null;
    }
    if (!hit) {
      piece = pieceAt(visiblePieces(ctx), ctx.anim.frame, e, ctx.doc.space);
      ctx.anim.select(piece?.id ?? null);
      if (!piece) return;
      hit = { kind: 'body' };
    }
    if (!piece) return;
    const frame = ctx.anim.frame;
    drag = {
      id: piece.id,
      hit,
      start: { x: e.x, y: e.y },
      startScreen: { x: e.sx, y: e.sy },
      s0: pieceStateAt(piece, frame),
      keys0: piece.keyframes.map(cloneKeyframe),
      pivot0: { ...piece.pivot },
      depth: e.ctrl,
      adding: !piece.keyframes.some((k) => k.frame === frame),
    };
    ctx.anim.beginDrag();
  },
  pointerMove(ctx, e) {
    const d = drag;
    if (!d) return;
    const piece = ctx.anim.piece(d.id);
    if (!piece) return;
    const space = ctx.doc.space;
    const frame = ctx.anim.frame;
    // Screen distances (so handles feel the same at any zoom), in canvas pixels at 100 %.
    const zoom = ctx.view.zoom;
    const dxs = (e.sx - d.startScreen.x) / zoom;
    const dys = (e.sy - d.startScreen.y) / zoom;
    const hit = d.hit;
    if (hit.kind === 'pivot') {
      const pl = placementOf(d.s0, d.pivot0, piece.src.width, piece.src.height, space);
      const q = pl.affine ? null : unproject(pl, e);
      const next = q ?? (() => {
        const m = pl.affine!;
        const det = m[0] * m[3] - m[1] * m[2];
        const x = e.x - m[4];
        const y = e.y - m[5];
        return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det };
      })();
      ctx.anim.preview(d.id, (p) => {
        p.keyframes = movePivot3D(d.keys0, d.pivot0, next, space);
        p.pivot = { ...next };
      });
      return;
    }
    let s: PieceState;
    if (hit.kind === 'body') s = d.depth ? depthDrag(d.s0, dys, space) : moveState(d.s0, e.x - d.start.x, e.y - d.start.y, e.shift);
    else if (hit.kind === 'tilt') s = tiltDrag(d.s0, hit.handle, dys, e.shift);
    else if (hit.kind === 'turn') s = turnDrag(d.s0, hit.handle, dxs, e.shift);
    else if (hit.kind === 'spin') s = rotateState(d.s0, d.start, { x: e.x, y: e.y }, e.shift);
    else s = resizeDrag(d.s0, { pivot: d.pivot0, w: piece.src.width, h: piece.src.height }, hit.corner, { x: e.x, y: e.y }, space, e.shift);
    const change = stateChange(s);
    ctx.anim.preview(d.id, (p) => (p.keyframes = setKey(d.keys0, frame, change)));
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
    const over = hit ? null : pieceAt(visiblePieces(ctx), ctx.anim.frame, e, ctx.doc.space);
    const id = over?.id ?? null;
    if (id !== hovered) {
      hovered = id;
      ctx.invalidateOverlay();
    }
    ctx.setCursor(hit ? cursorFor(hit, e.ctrl) : over ? 'pointer' : 'default');
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
      const g = geometry(ctx, p);
      ov.outlineScreen(g.outline, true, p.id !== hovered);
    }
    if (!sel || !ctx.doc.isEffectivelyVisible(sel.layerId)) return;
    const g = geometry(ctx, sel);
    const active = drag?.hit;
    ov.outlineScreen(g.outline, true, false);
    for (const c of g.corners) ov.handle(c.at, 'square', active?.kind === 'corner' && active.corner.x === c.local.x && active.corner.y === c.local.y);
    for (const edge of g.edges) {
      const on = active && active.kind === edge.hit.kind && 'handle' in active && 'handle' in edge.hit && active.handle === edge.hit.handle;
      ov.handle(edge.at, 'circle', on === true);
    }
    if (g.top && g.spin) {
      ov.line(g.top, g.spin);
      ov.handle(g.spin, 'circle', active?.kind === 'spin');
    }
    if (g.pivot) ov.pivot(g.pivot, active?.kind === 'pivot');
  },
});
