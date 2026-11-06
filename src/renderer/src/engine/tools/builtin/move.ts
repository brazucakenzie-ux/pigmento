import { type Point, type Rect } from '../../core/geometry';
import { matAround, matRotate } from '../../core/matrix';
import type { VectorLayer } from '../../doc/Document';
import { Selection } from '../../doc/Selection';
import { boxCorners, boxFromRect, handleCursor, handlePosition, hitHandle, resizeBox, rotateBox, RESIZE_HANDLES, type BoxGeom, type BoxHandle } from '../../live/BoxGeom';
import type { FloatObject } from '../../live/FloatObject';
import { ShapeObject, type FillMode } from '../../live/ShapeObject';
import { boundsOf, nodeBounds, rectToRect, transformNode, translateNode, type VectorNode } from '../../vector/model';
import type { RGBA } from '../../core/color';
import { beginShapeEdit, dragShapeEdit, endShapeEdit, FILL_MODE_OPTION, WIDTH_OPTION } from '../shapeTools';
import { registerTool } from '../ToolRegistry';
import type { OptionSpec, ToolContext, ToolPointerEvent } from '../Tool';

type Drag =
  | { kind: 'move'; layer: VectorLayer; before: readonly VectorNode[]; ids: Set<string>; at: Point; bounds: Rect }
  | { kind: 'resize'; layer: VectorLayer; before: readonly VectorNode[]; ids: Set<string>; handle: Exclude<BoxHandle, 'rotate'>; box: BoxGeom; single: boolean }
  | { kind: 'rotate'; layer: VectorLayer; before: readonly VectorNode[]; ids: Set<string>; box: BoxGeom; at: Point; single: boolean }
  | { kind: 'marquee'; start: Point; current: Point; base: string[] }
  | { kind: 'pixels'; at: Point; bounds: Rect; keepSelection: boolean };

let drag: Drag | null = null;
/** Colours last seen, so a palette click restyles only what changed (outline or fill). */
let lastColors: { primary: RGBA; secondary: RGBA } | null = null;

const screenOf = (ctx: ToolContext) => (q: Point) => ctx.view.toScreen(q.x, q.y);
const sameColor = (a: RGBA, b: RGBA) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * The handle box: a single rectangle, rounded rectangle or ellipse uses its own rotated box;
 * anything else the box around the selection.
 */
function selectionBox(ctx: ToolContext): { box: BoxGeom; single: boolean } | null {
  const nodes = ctx.selectedVectorNodes();
  if (nodes.length === 1 && nodes[0].type === 'shape' && nodes[0].box) {
    const b = nodes[0].box;
    return { box: { ...b, w: Math.abs(b.w), h: Math.abs(b.h) }, single: true };
  }
  const r = boundsOf(nodes);
  return r ? { box: boxFromRect(r), single: false } : null;
}

/** Map the selected nodes through a box change (start → next). */
function applyBox(d: Extract<Drag, { kind: 'resize' | 'rotate' }>, next: BoxGeom): VectorNode[] {
  return d.before.map((n) => {
    if (!d.ids.has(n.id)) return n;
    if (d.single && n.type === 'shape' && n.box) {
      // Keep the shape's own flip (negative sides) on top of the handle box.
      return { ...n, box: { ...next, w: next.w * (Math.sign(n.box.w) || 1), h: next.h * (Math.sign(n.box.h) || 1) } };
    }
    if (d.kind === 'rotate') return transformNode(n, matAround(matRotate(next.angle - d.box.angle), { x: d.box.cx, y: d.box.cy }));
    const from = { x: d.box.cx - d.box.w / 2, y: d.box.cy - d.box.h / 2, w: d.box.w, h: d.box.h };
    const to = { x: next.cx - next.w / 2, y: next.cy - next.h / 2, w: next.w, h: next.h };
    return transformNode(n, rectToRect(from, to));
  });
}

/** Pixel layers: drag the layer's content (or the selection) like a floating selection. */
function startPixelMove(ctx: ToolContext, e: ToolPointerEvent): void {
  if (!ctx.canPaint()) return;
  const p = { x: e.x, y: e.y };
  const keepSelection = ctx.doc.selection !== null || ctx.live?.kind === 'float';
  if (!keepSelection) ctx.setSelection(Selection.all(ctx.doc.width, ctx.doc.height));
  const f = ctx.liftSelection(false) as FloatObject | null;
  if (!f) {
    if (!keepSelection) ctx.setSelection(null);
    return;
  }
  if (!keepSelection) f.historyLabel = 'history.moveLayer';
  f.beginDrag({ type: 'body' }, p);
  drag = { kind: 'pixels', at: p, bounds: f.extent(), keepSelection };
}

/**
 * Move (V): on a shape layer, click to select objects (Shift adds, drag on empty space to
 * select several), drag to move, handles to resize (Shift keeps proportions, Alt from the
 * centre) or rotate; double-click a shape to edit its corners. On a pixel layer, drag moves
 * the layer's content (or the selection).
 */
export default registerTool({
  id: 'move',
  labelKey: 'tool.move',
  hintKey: 'tool.move.hint',
  icon: 'move',
  shortcut: 'V',
  group: 'selection',
  order: 0,
  // Compact versions of the shape style options (they restyle the selected shapes).
  options: [
    { ...FILL_MODE_OPTION, iconsOnly: true } as OptionSpec,
    { ...WIDTH_OPTION, presets: undefined } as OptionSpec,
  ],
  cursor: () => 'default',

  activate(ctx) {
    lastColors = { primary: { ...ctx.primary }, secondary: { ...ctx.secondary } };
  },

  pointerDown(ctx, e) {
    const p = { x: e.x, y: e.y };
    const sp = { x: e.sx, y: e.sy };
    if (ctx.live instanceof ShapeObject) {
      // Editing a shape in place: its handles, or a click elsewhere puts it back.
      if (beginShapeEdit(ctx, e)) return;
      ctx.commitLive();
      return;
    }
    const layer = ctx.activeVector;
    if (!layer) return startPixelMove(ctx, e);
    if (!ctx.canPaint()) return;
    const sel = selectionBox(ctx);
    if (sel) {
      const h = hitHandle(sel.box, screenOf(ctx), sp, ctx.view.zoom, true);
      if (h) {
        const base = { layer, before: layer.objects, ids: new Set(ctx.vectorSelection), box: sel.box, single: sel.single };
        drag = h === 'rotate' ? { kind: 'rotate', ...base, at: p } : { kind: 'resize', ...base, handle: h };
        return;
      }
    }
    const hit = ctx.vectorHit(p);
    if (hit && e.detail >= 2) {
      ctx.editVectorShape(hit);
      return;
    }
    if (hit) {
      let ids = [...ctx.vectorSelection];
      if (e.shift) ids = ids.includes(hit) ? ids.filter((i) => i !== hit) : [...ids, hit];
      else if (!ids.includes(hit)) ids = [hit];
      ctx.setVectorSelection(ids);
      if (!ids.includes(hit)) return;
      const bounds = boundsOf(ctx.selectedVectorNodes());
      if (bounds) drag = { kind: 'move', layer, before: layer.objects, ids: new Set(ids), at: p, bounds };
      return;
    }
    const base = e.shift ? [...ctx.vectorSelection] : [];
    if (!e.shift) ctx.setVectorSelection([]);
    drag = { kind: 'marquee', start: p, current: p, base };
  },

  pointerMove(ctx, e) {
    if (dragShapeEdit(ctx, e)) return;
    const d = drag;
    if (!d) return;
    const p = { x: e.x, y: e.y };
    if (d.kind === 'pixels') {
      const f = ctx.live?.kind === 'float' ? (ctx.live as FloatObject) : null;
      if (!f) return;
      const c = ctx.snapMove({ ...d.bounds, x: d.bounds.x + p.x - d.at.x, y: d.bounds.y + p.y - d.at.y });
      f.drag({ x: p.x + c.x, y: p.y + c.y }, { shift: e.shift, alt: e.alt });
      ctx.invalidate(null);
      ctx.emitSelectionInfo();
      return;
    }
    if (d.kind === 'marquee') {
      d.current = p;
      const r = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
      ctx.setVectorSelection([...d.base, ...ctx.vectorIdsIn(r).filter((id) => !d.base.includes(id))]);
      ctx.invalidateOverlay();
      return;
    }
    if (d.kind === 'move') {
      let dx = p.x - d.at.x;
      let dy = p.y - d.at.y;
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const c = ctx.snapMove({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy });
      dx += c.x;
      dy += c.y;
      ctx.previewVector(d.layer, d.before.map((n) => (d.ids.has(n.id) ? translateNode(n, dx, dy) : n)));
      return;
    }
    if (d.kind === 'resize') {
      const next = resizeBox(d.box, d.handle, ctx.snapPoint(p), { keepAspect: e.shift, fromCenter: e.alt });
      ctx.previewVector(d.layer, applyBox(d, next));
      return;
    }
    const next = rotateBox(d.box, d.at, p, e.shift);
    ctx.previewVector(d.layer, applyBox(d, next));
  },

  pointerUp(ctx) {
    if (endShapeEdit(ctx)) return;
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.kind === 'pixels') {
      const f = ctx.live?.kind === 'float' ? (ctx.live as FloatObject) : null;
      f?.endDrag();
      ctx.commitLive(d.keepSelection);
      return;
    }
    if (d.kind === 'marquee') {
      ctx.invalidateOverlay();
      return;
    }
    const label = d.kind === 'move' ? 'history.moveShapes' : d.kind === 'resize' ? 'history.resizeShapes' : 'history.rotateShapes';
    ctx.recordVector(label, d.layer, d.before);
  },

  hover(ctx, e) {
    if (ctx.live instanceof ShapeObject) return;
    const sel = ctx.activeVector ? selectionBox(ctx) : null;
    if (sel) {
      const h = hitHandle(sel.box, screenOf(ctx), { x: e.sx, y: e.sy }, ctx.view.zoom, true);
      if (h) return ctx.setCursor(handleCursor(h, sel.box.angle));
    }
    if (!ctx.activeVector) return ctx.setCursor('move');
    ctx.setCursor(ctx.vectorHit({ x: e.x, y: e.y }) ? 'move' : 'default');
  },

  keyDown(ctx, e) {
    if (ctx.live instanceof ShapeObject) {
      if (e.key === 'Enter') {
        ctx.commitLive();
        return true;
      }
      if (e.key === 'Escape') {
        ctx.cancelLive();
        return true;
      }
      return false;
    }
    if (!ctx.vectorSelection.length) return false;
    if (e.key === 'Escape' || e.key === 'Enter') {
      ctx.setVectorSelection([]);
      return true;
    }
    if (e.key === 'Backspace') {
      ctx.deleteSelection();
      return true;
    }
    return false;
  },

  optionsChanged(ctx) {
    const st = ctx.selectedVectorStyle();
    if (!st) return;
    const o = ctx.options('move');
    const mode = String(o.mode ?? st.mode) as FillMode;
    const width = Number(o.width ?? st.width);
    if (mode !== st.mode || width !== st.width) ctx.restyleVector({ mode, width });
  },

  colorsChanged(ctx) {
    const prev = lastColors;
    lastColors = { primary: { ...ctx.primary }, secondary: { ...ctx.secondary } };
    if (!prev || !ctx.vectorSelection.length) return;
    const change: { outline?: RGBA; fill?: RGBA } = {};
    // Shape colours follow the shape tools: outline = primary, fill = secondary.
    if (!sameColor(prev.primary, ctx.primary)) change.outline = { ...ctx.primary };
    if (!sameColor(prev.secondary, ctx.secondary)) change.fill = { ...ctx.secondary };
    if (change.outline || change.fill) ctx.restyleVector(change);
  },

  drawOverlay(ctx, ov) {
    const d = drag;
    if (d?.kind === 'marquee') {
      const a = d.start;
      const b = d.current;
      ov.outlineScreen(
        [
          { x: a.x, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: b.y },
          { x: a.x, y: b.y },
        ].map((q) => ov.toScreen(q)),
        true,
        true,
      );
    }
    if (!ctx.activeVector || ctx.live) return;
    const nodes = ctx.selectedVectorNodes();
    if (!nodes.length) return;
    // Each selected object's outline, then the handles of the selection box.
    for (const n of nodes) {
      const corners = n.type === 'shape' && n.box ? boxCorners(n.box) : (() => {
        const b = nodeBounds(n);
        return b ? [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] : [];
      })();
      if (corners.length) ov.outlineScreen(corners.map((q) => ov.toScreen(q)), true, true);
    }
    const sel = selectionBox(ctx);
    if (!sel) return;
    const zoom = ctx.view.zoom;
    const top = ov.toScreen(handlePosition(sel.box, 'n', zoom));
    const rot = ov.toScreen(handlePosition(sel.box, 'rotate', zoom));
    ov.line(top, rot);
    for (const h of RESIZE_HANDLES) ov.handle(ov.toScreen(handlePosition(sel.box, h, zoom)));
    ov.handle(rot, 'circle');
  },

  deactivate(ctx) {
    drag = null;
    ctx.setVectorSelection([]);
  },
});
