import { rectUnion, snapAngle45, type Point } from '../../core/geometry';
import { ShapeObject } from '../../live/ShapeObject';
import type { ToolContext, ToolPointerEvent } from '../Tool';
import { ANTIALIAS_OPTION, FILL_MODE_OPTION, DRAW_AS_OPTION, SHAPE_COLORS_HINT, WIDTH_OPTION, beginShapeEdit, dragShapeEdit, endShapeEdit, hoverCursor, liveShape, restyleLive, shapeStyle, snapCenter, FILL_STYLE_OPTION, outlineStyleOption } from '../shapeTools';
import { registerTool } from '../ToolRegistry';

let swapped = false;
let firstDrag: Point | null = null;
let editing = false;

function next(ctx: ToolContext, e: ToolPointerEvent, last: Point | undefined): Point {
  const p = ctx.snapPoint(snapCenter(e));
  return e.shift && last ? snapAngle45(last, p) : p;
}

function refresh(ctx: ToolContext, shape: ShapeObject, mutate: () => void): void {
  const before = shape.bounds();
  mutate();
  shape.update();
  ctx.invalidate(rectUnion(before, shape.bounds()));
  ctx.invalidateOverlay();
}

/** Finish an open polygon; fewer than 3 points discards it. */
function close(ctx: ToolContext): void {
  const s = liveShape(ctx);
  if (!s || !s.open) return;
  if (s.points.length < 3) {
    ctx.cancelLive();
    return;
  }
  refresh(ctx, s, () => {
    s.open = false;
    s.rubber = null;
  });
  ctx.setHint('opt.liveHint');
}

export default registerTool({
  id: 'polygon',
  labelKey: 'tool.polygon',
  hintKey: 'tool.polygon.hint',
  icon: 'polygon',
  shortcut: 'Y',
  group: 'shapes',
  order: 150,
  paints: true,
  options: [DRAW_AS_OPTION, FILL_MODE_OPTION, WIDTH_OPTION, FILL_STYLE_OPTION, outlineStyleOption({ cap: 'butt', join: 'round' }), ANTIALIAS_OPTION, SHAPE_COLORS_HINT],
  cursor: () => 'crosshair',

  pointerDown(ctx, e) {
    const s = liveShape(ctx);
    if (s && s.open) {
      const pts = s.points;
      const sp0 = ctx.view.toScreen(pts[0].x, pts[0].y);
      const nearStart = Math.hypot(sp0.x - e.sx, sp0.y - e.sy) < 9;
      if ((nearStart || e.detail >= 2) && pts.length >= 3) {
        // Double-click: the first click of the pair already added this corner, so just close.
        close(ctx);
        return;
      }
      refresh(ctx, s, () => s.points.push(next(ctx, e, pts[pts.length - 1])));
      return;
    }
    if (s && beginShapeEdit(ctx, e)) {
      editing = true;
      return;
    }
    ctx.commitLive();
    if (!ctx.canPaint()) return;
    swapped = e.button === 2;
    const p = ctx.snapPoint(snapCenter(e));
    const shape = new ShapeObject('polygon', shapeStyle(ctx, 'polygon', swapped), ctx.doc.width, ctx.doc.height, { points: [p] });
    shape.open = true;
    shape.rubber = p;
    ctx.setLive(shape);
    firstDrag = p;
  },

  pointerMove(ctx, e) {
    if (editing) {
      dragShapeEdit(ctx, e);
      return;
    }
    const s = liveShape(ctx);
    if (s?.open) refresh(ctx, s, () => (s.rubber = next(ctx, e, s.points[s.points.length - 1])));
  },

  pointerUp(ctx, e) {
    if (editing) {
      endShapeEdit(ctx);
      editing = false;
      return;
    }
    const s = liveShape(ctx);
    if (s?.open && firstDrag && s.points.length === 1) {
      const p = next(ctx, e, firstDrag);
      if (Math.hypot(p.x - firstDrag.x, p.y - firstDrag.y) >= 2) refresh(ctx, s, () => s.points.push(p));
    }
    firstDrag = null;
  },

  hover(ctx, e) {
    const s = liveShape(ctx);
    if (s?.open) {
      refresh(ctx, s, () => (s.rubber = next(ctx, e, s.points[s.points.length - 1])));
      ctx.setCursor('crosshair');
      return;
    }
    hoverCursor(ctx, e);
  },

  keyDown(ctx, e) {
    const s = liveShape(ctx);
    if (!s) return false;
    if (e.key === 'Enter') {
      if (s.open) close(ctx);
      else ctx.commitLive();
      return true;
    }
    if (e.key === 'Escape') {
      ctx.cancelLive();
      return true;
    }
    if (e.key === 'Backspace' && s.open && s.points.length > 1) {
      refresh(ctx, s, () => s.points.pop());
      return true;
    }
    return false;
  },

  optionsChanged: (ctx) => restyleLive(ctx, 'polygon', swapped),
  colorsChanged: (ctx) => restyleLive(ctx, 'polygon', swapped),
  deactivate: () => {
    firstDrag = null;
    editing = false;
  },
});
