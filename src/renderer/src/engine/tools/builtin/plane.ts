import type { Point } from '../../core/geometry';
import { ROTATE_HANDLE_OFFSET } from '../../live/BoxGeom';
import type { Keyframe, PieceState } from '../../anim/interpolate';
import { cloneKeyframe, setKey, type Piece, type PieceLoop } from '../../anim/piece';
import { placeWithSpin } from '../../anim/spin';
import { piecesInDrawOrder } from '../../anim/pieceRaster';
import { insidePiece, moveState, pieceAt, rotateState } from '../../anim/pieceEdit';
import { depthDrag, movePivot3D, resizeDrag, tiltDrag, turnDrag } from '../../anim/planeEdit';
import { placementOf, project, unproject } from '../../anim/space';
import { foldHandle, foldToward, type EdgeSnap } from '../../anim/edgeSnap';
import { drawHingeSnap, hingeOnRelease, hingeSnap } from '../hingeSnap';
import { alongPath, drawTree, emitterHandles, keyedAngle, pieceLocal, selectionKeys, slideOnParent, topPivot, treeHandles, treePieces, treeTop, type TreeHandle } from '../treeEdit';
import { registerTool } from '../ToolRegistry';
import type { ToolContext, ToolPointerEvent } from '../Tool';

/**
 * Perspective plane: a piece is a sheet of paper in 3D. Drag it to move it across the picture
 * (Ctrl-drag pushes it away or pulls it closer), drag its top or bottom handle to tilt it back
 * or forward, a side handle to turn it like a door, the round handle to spin it, a corner to
 * resize it on its own plane (Shift keeps the proportions), or the pivot to change what it turns
 * about. Shift snaps tilt and turn to 15°. Dragged near another piece's edge, a piece's edge lights
 * up and letting go hinges it there (Alt: no snapping); a hinged piece has a fold handle instead.
 * Dragging any piece of a tree of linked pieces moves the whole tree, and handles round the tree's
 * pivot tilt, turn and spin it; Alt-dragging changes just that piece (folds a hinged one, slides
 * one that follows another). Every change keys the piece at the frame shown.
 */
type Hit =
  | { kind: 'body' }
  | { kind: 'tilt'; handle: 'n' | 's' }
  | { kind: 'turn'; handle: 'e' | 'w' }
  | { kind: 'spin' }
  | { kind: 'corner'; corner: Point }
  | { kind: 'pivot' }
  /** A hinged piece's fold handle (or the piece itself, Alt-dragged). */
  | { kind: 'fold' }
  /** The handles round a tree's pivot: they tilt, turn and spin the whole tree. */
  | { kind: 'tree'; handle: TreeHandle }
  /** Alt-dragging a piece that follows another: it slides on that piece. */
  | { kind: 'slide' }
  /** Where one of its trails comes from. */
  | { kind: 'emitter'; trail: string };

interface Drag {
  /** The piece the drag changes (the top of its tree, when the whole tree moves). */
  id: string;
  /** The piece that was grabbed. */
  face: string;
  hit: Hit;
  /** Where the pointer was, in document and screen pixels. */
  start: Point;
  startScreen: Point;
  /** From the pointer to the fold handle, when a hinged piece is folded by dragging it. */
  grab: Point;
  s0: PieceState;
  keys0: Keyframe[];
  pivot0: Point;
  /** Ctrl when a body drag began: it changes the depth. */
  depth: boolean;
  adding: boolean;
  /** The edge it hinges onto if it's let go now. */
  snap: EdgeSnap | null;
  /** Which way it was heading when the drag began, if it faces the way it goes. */
  heading: number | null;
  /** How its moves repeat (a key added on a repeat starts from what shows there). */
  loop: PieceLoop;
  /** How far its spin had turned it when the drag began (radians; it isn't keyed). */
  spun: { angle: number; tilt: number; turn: number } | null;
}

let drag: Drag | null = null;
let hovered: string | null = null;
/** Dragging the camera's vanishing point (from where the pointer and the point were). */
let camDrag: { start: Point; from: Point } | null = null;

/** The vanishing point on screen. */
function vanishing(ctx: ToolContext): Point {
  return ctx.view.toScreen(ctx.doc.camera.x, ctx.doc.camera.y);
}

const HIT_PX = 7;

function visiblePieces(ctx: ToolContext): Piece[] {
  return piecesInDrawOrder(ctx.doc, ctx.anim.scene());
}

interface ScreenGeom {
  corners: { at: Point; local: Point }[];
  edges: { at: Point; hit: Hit }[];
  spin: Point | null;
  top: Point | null;
  pivot: Point | null;
  /** A hinged piece's only handle. */
  fold: Point | null;
  outline: Point[];
}

/** Where the piece's handles show on screen at the frame shown (handles behind the camera are left out). */
function geometry(ctx: ToolContext, p: Piece): ScreenGeom {
  const scene = ctx.anim.scene();
  const { width: w, height: h } = p.src;
  const pl = scene.placement(p);
  const at = (q: Point): Point | null => {
    const d = project(pl, q);
    return d && ctx.view.toScreen(d.x, d.y);
  };
  // A group has no pixels: its handles are the tree's, round its pivot.
  if (p.kind === 'group') return { corners: [], edges: [], spin: null, top: null, pivot: null, fold: null, outline: [] };
  const outline = scene.corners(p).map((q) => ctx.view.toScreen(q.x, q.y));
  // A hinged piece is placed by its hinge: it only folds.
  const fold = foldHandle(p);
  if (fold) return { corners: [], edges: [], spin: null, top: null, pivot: null, fold: at(fold), outline };
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
  // A piece following another turns about its own pivot in that piece's space (moving it there is for later).
  return { corners, edges, spin, top, pivot: p.link ? null : at(p.pivot), fold: null, outline };
}

const near = (a: Point, b: Point, px = HIT_PX): boolean => Math.abs(a.x - b.x) <= px && Math.abs(a.y - b.y) <= px;

function hitSelected(ctx: ToolContext, p: Piece, e: ToolPointerEvent): Hit | null {
  const g = geometry(ctx, p);
  const sp = { x: e.sx, y: e.sy };
  // Trail emitters sit on top of everything else.
  for (const h of emitterHandles(ctx, ctx.anim.scene(), p)) if (near(sp, h.at)) return { kind: 'emitter', trail: h.id };
  // The tree's handles round its pivot come first (they sit apart from the pieces' own).
  const top = treeTop(ctx, p);
  const c = top && topPivot(ctx, ctx.anim.scene(), top);
  if (c) for (const h of treeHandles(c)) if (near(sp, h.at)) return { kind: 'tree', handle: h.hit };
  // A group is grabbed by any of its pieces.
  if (p.kind === 'group') {
    const over = pieceAt(visiblePieces(ctx), ctx.anim.scene(), e);
    return over && treePieces(ctx, p).includes(over) ? { kind: 'body' } : null;
  }
  if (g.fold && near(sp, g.fold)) return { kind: 'fold' };
  if (g.spin && near(sp, g.spin)) return { kind: 'spin' };
  if (g.pivot && near(sp, g.pivot)) return { kind: 'pivot' };
  for (const c of g.corners) if (near(sp, c.at)) return { kind: 'corner', corner: c.local };
  for (const edge of g.edges) if (near(sp, edge.at)) return edge.hit;
  if (insidePiece(p, ctx.anim.scene(), e)) return { kind: 'body' };
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
    case 'fold':
      return 'grab';
    case 'corner':
      return 'nwse-resize';
    case 'pivot':
      return 'crosshair';
    case 'slide':
    case 'emitter':
      return 'move';
    case 'tree':
      return hit.handle.kind === 'tilt' ? 'ns-resize' : hit.handle.kind === 'turn' ? 'ew-resize' : 'grab';
  }
}

function stateChange(p: Piece, s: PieceState, heading: number | null, spun: Drag['spun']): Partial<PieceState> {
  return { x: s.x, y: s.y, sx: s.sx, sy: s.sy, angle: keyedAngle(p, s, heading) - (spun?.angle ?? 0), depth: s.depth, tilt: s.tilt - (spun?.tilt ?? 0), turn: s.turn - (spun?.turn ?? 0) };
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
    if (drag || camDrag) ctx.anim.cancelDrag();
    drag = null;
    camDrag = null;
    hovered = null;
  },
  pointerDown(ctx, e) {
    if (e.button !== 0) return;
    // The vanishing point can be dragged, whatever is selected (Shift keeps it level or upright).
    if (near({ x: e.sx, y: e.sy }, vanishing(ctx))) {
      camDrag = { start: { x: e.x, y: e.y }, from: { x: ctx.doc.camera.x, y: ctx.doc.camera.y } };
      ctx.anim.beginDrag();
      return;
    }
    let piece = ctx.anim.selected;
    let hit = piece ? hitSelected(ctx, piece, e) : null;
    // A repeating piece's copies reach everywhere: a piece showing on top of them is picked instead.
    if (piece && hit?.kind === 'body' && piece.repeat !== 'none') {
      const top = pieceAt(visiblePieces(ctx), ctx.anim.scene(), e);
      if (top && top.id !== piece.id) hit = null;
    }
    if (!hit) {
      piece = pieceAt(visiblePieces(ctx), ctx.anim.scene(), e);
      ctx.anim.select(piece?.id ?? null);
      if (!piece) return;
      hit = { kind: 'body' };
    }
    if (!piece) return;
    const frame = ctx.anim.frame;
    // What the drag changes: grabbing a linked piece moves its whole tree (Alt: just that piece).
    let target = piece;
    let grab = { x: 0, y: 0 };
    if (hit.kind === 'tree') target = treeTop(ctx, piece) ?? piece;
    else if (hit.kind === 'body' && piece.link) {
      if (!e.alt) target = treeTop(ctx, piece) ?? piece;
      else if (piece.link.hinge) {
        hit = { kind: 'fold' };
        const handle = foldHandle(piece);
        const at = handle && project(ctx.anim.scene().placement(piece), handle);
        if (at) grab = { x: at.x - e.x, y: at.y - e.y };
      } else hit = { kind: 'slide' };
    }
    drag = {
      id: target.id,
      face: piece.id,
      hit,
      start: { x: e.x, y: e.y },
      startScreen: { x: e.sx, y: e.sy },
      grab,
      s0: ctx.anim.scene().stateAt(target, frame),
      keys0: target.keyframes.map(cloneKeyframe),
      pivot0: { ...target.pivot },
      depth: e.ctrl,
      adding: !target.keyframes.some((k) => k.frame === frame),
      snap: null,
      heading: ctx.anim.scene().headingOf(target, frame),
      loop: target.loop,
      spun: ctx.anim.scene().spinOf(target, frame),
    };
    ctx.anim.beginDrag();
  },
  pointerMove(ctx, e) {
    if (camDrag) {
      let dx = e.x - camDrag.start.x;
      let dy = e.y - camDrag.start.y;
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      ctx.anim.previewCamera({ x: camDrag.from.x + dx, y: camDrag.from.y + dy });
      return;
    }
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
    if (hit.kind === 'emitter') {
      const local = pieceLocal(ctx.anim.scene(), piece, { x: e.x, y: e.y });
      if (local) ctx.anim.preview(d.id, (p) => (p.trails = p.trails.map((t) => (t.id === hit.trail ? { ...t, emitter: local } : t))));
      return;
    }
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
      const scene = ctx.anim.scene();
      ctx.anim.preview(d.id, (p) => {
        p.keyframes = placeWithSpin(d.keys0, (f) => scene.spinOf(p, f), (k) => movePivot3D(k, d.pivot0, next, space));
        p.pivot = { ...next };
      });
      return;
    }
    if (hit.kind === 'fold') {
      const fold = foldToward(ctx.anim.scene(), piece, { x: e.x + d.grab.x, y: e.y + d.grab.y }, d.s0.fold, e.shift);
      ctx.anim.preview(d.id, (p) => (p.keyframes = setKey(d.keys0, frame, { fold }, d.loop)));
      return;
    }
    if (hit.kind === 'slide') {
      const at = slideOnParent(ctx.anim.scene(), piece, d.s0, d.start, { x: e.x, y: e.y }, e.shift);
      if (at) ctx.anim.preview(d.id, (p) => (p.keyframes = setKey(d.keys0, frame, at, d.loop)));
      return;
    }
    const handle = hit.kind === 'tree' ? hit.handle : hit;
    // On a path, it's dragged along it (Ctrl still pushes it back or brings it forward).
    const path = handle.kind === 'body' && !d.depth ? ctx.anim.pathOf(piece) : null;
    if (path) {
      const progress = alongPath(path, d.s0, d.start, { x: e.x, y: e.y }, e.shift);
      ctx.anim.preview(d.id, (p) => (p.keyframes = setKey(d.keys0, frame, { progress }, d.loop)));
      return;
    }
    let s: PieceState;
    if (handle.kind === 'body') s = d.depth ? depthDrag(d.s0, dys, space) : moveState(d.s0, e.x - d.start.x, e.y - d.start.y, e.shift);
    else if (handle.kind === 'tilt') s = tiltDrag(d.s0, handle.handle, dys, e.shift);
    else if (handle.kind === 'turn') s = turnDrag(d.s0, handle.handle, dxs, e.shift);
    else if (handle.kind === 'spin') s = rotateState(d.s0, d.start, { x: e.x, y: e.y }, e.shift);
    else if (handle.kind === 'corner') s = resizeDrag(d.s0, { pivot: d.pivot0, w: piece.src.width, h: piece.src.height }, handle.corner, { x: e.x, y: e.y }, space, e.shift);
    else return;
    const change = stateChange(piece, s, d.heading, d.spun);
    ctx.anim.preview(d.id, (p) => (p.keyframes = setKey(d.keys0, frame, change, d.loop)));
    if (hit.kind === 'body' && !d.depth) {
      d.snap = hingeSnap(ctx, piece, e.alt);
      ctx.invalidateOverlay();
    }
  },
  pointerUp(ctx) {
    if (camDrag) {
      camDrag = null;
      ctx.anim.endDrag('history.camera');
      return;
    }
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.snap) {
      hingeOnRelease(ctx, d.id, d.snap);
      return;
    }
    ctx.anim.endDrag(d.hit.kind === 'emitter' ? 'history.trailEmitter' : d.hit.kind === 'pivot' ? 'history.pivot' : d.adding ? 'history.keyframeAdd' : 'history.keyframe');
  },
  hover(ctx, e) {
    if (near({ x: e.sx, y: e.sy }, vanishing(ctx))) {
      ctx.setCursor('move');
      return;
    }
    const sel = ctx.anim.selected;
    const hit = sel ? hitSelected(ctx, sel, e) : null;
    const over = hit ? null : pieceAt(visiblePieces(ctx), ctx.anim.scene(), e);
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
      if (p || ctx.anim.cameraSelected) {
        ctx.anim.select(null);
        ctx.anim.selectCamera(false);
        return true;
      }
      return false;
    }
    if (drag) return false;
    return selectionKeys(ctx, e);
  },
  drawOverlay(ctx, ov) {
    // The horizon (the vanishing point's height) across the view, and the point itself.
    const vp = vanishing(ctx);
    ov.line(ctx.view.toScreen(ctx.doc.camera.x - 1e5, ctx.doc.camera.y), ctx.view.toScreen(ctx.doc.camera.x + 1e5, ctx.doc.camera.y), true);
    ov.handle(vp, 'circle', camDrag !== null);
    ov.pivot(vp, camDrag !== null);
    const sel = ctx.anim.selected;
    for (const p of visiblePieces(ctx)) {
      if (p === sel) continue;
      const g = geometry(ctx, p);
      ov.outlineScreen(g.outline, true, p.id !== hovered);
    }
    if (!sel || !ctx.doc.isEffectivelyVisible(sel.layerId)) return;
    const g = geometry(ctx, sel);
    const active = drag?.hit;
    // A tree: its pieces outlined, and its own handles round its pivot.
    const top = treeTop(ctx, sel);
    if (top) drawTree(ctx, ov, ctx.anim.scene(), top, active?.kind === 'tree' ? active.handle : null);
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
    if (g.fold) ov.handle(g.fold, 'circle', active?.kind === 'fold');
    for (const h of emitterHandles(ctx, ctx.anim.scene(), sel)) ov.emitter(h.at, active?.kind === 'emitter' && active.trail === h.id);
    if (drag?.snap) drawHingeSnap(ctx, ov, drag.snap);
  },
});
