import { rectUnion, type Point } from '../../core/geometry';
import { ShapeObject } from '../../live/ShapeObject';
import { corner } from '../../vector/pathData';
import type { ToolContext } from '../Tool';
import {
  ANTIALIAS_OPTION,
  beginShapeEdit,
  dragShapeEdit,
  DRAW_AS_OPTION,
  endShapeEdit,
  FILL_MODE_OPTION,
  FILL_STYLE_OPTION,
  hoverCursor,
  liveShape,
  outlineStyleOption,
  pathKeys,
  restyleLive,
  SHAPE_COLORS_HINT,
  shapeStyle,
  WIDTH_OPTION,
} from '../shapeTools';
import { registerTool } from '../ToolRegistry';

let swapped = false;
/** Where the button went down for the point being placed (dragging pulls out its handles). */
let placing: { at: Point; screen: Point; dragged: boolean } | null = null;
/** Screen position of the point the last click placed (cleared when it's taken back). */
let lastPlaced: Point | null = null;

function livePath(ctx: ToolContext): ShapeObject | null {
  const s = liveShape(ctx);
  return s && s.shape === 'path' ? s : null;
}

function refresh(ctx: ToolContext, s: ShapeObject, mutate: () => void): void {
  const before = s.bounds();
  mutate();
  ctx.invalidate(rectUnion(before, s.bounds()));
  ctx.invalidateOverlay();
}

/** Done placing points: the path stays live for editing (fewer than two points discards it). */
function finish(ctx: ToolContext): void {
  const s = livePath(ctx);
  if (!s || !s.open) return;
  if (!s.close()) {
    ctx.cancelLive();
    return;
  }
  refresh(ctx, s, () => undefined);
  ctx.setHint('path.hint.edit');
}

const screenOf = (ctx: ToolContext) => (q: Point) => ctx.view.toScreen(q.x, q.y);

export default registerTool({
  id: 'pen',
  labelKey: 'tool.pen',
  hintKey: 'tool.pen.hint',
  icon: 'pen',
  shortcut: 'N',
  group: 'shapes',
  order: 155,
  // In the Shapes tab, with the Shape Editor's other commands.
  galleryOnly: true,
  paints: true,
  options: [DRAW_AS_OPTION, FILL_MODE_OPTION, WIDTH_OPTION, FILL_STYLE_OPTION, outlineStyleOption({ cap: 'butt', join: 'round' }), ANTIALIAS_OPTION, SHAPE_COLORS_HINT],
  cursor: () => 'crosshair',

  pointerDown(ctx, e) {
    const p = ctx.snapPoint({ x: e.x, y: e.y });
    const sp = { x: e.sx, y: e.sy };
    const s = livePath(ctx);
    if (s?.open) {
      // A double-click finishes; its second click would otherwise add a point on the first.
      if (e.detail === 2 && lastPlaced && Math.hypot(sp.x - lastPlaced.x, sp.y - lastPlaced.y) <= 6) {
        lastPlaced = null;
        refresh(ctx, s, () => s.penUndo());
        finish(ctx);
        return;
      }
      if (s.penNearStart(sp, screenOf(ctx))) {
        refresh(ctx, s, () => s.penClose());
        ctx.setHint('path.hint.edit');
        return;
      }
      refresh(ctx, s, () => s.penAdd(p));
      placing = { at: p, screen: sp, dragged: false };
      lastPlaced = sp;
      return;
    }
    if (s) {
      // Editing the finished path: points and handles, Alt+click to switch smooth/corner…
      if (beginShapeEdit(ctx, e)) return;
      // …or click on the outline to add a point there.
      let added = false;
      refresh(ctx, s, () => (added = s.insertAt({ x: e.x, y: e.y }, Math.max(s.style.width / 2, 0) + 5 / ctx.view.zoom)));
      if (added) return;
    }
    ctx.commitLive();
    if (!ctx.canPaint()) return;
    swapped = e.button === 2;
    const doc = ctx.doc;
    const path = new ShapeObject('path', shapeStyle(ctx, 'pen', swapped), doc.width, doc.height, { subpaths: [{ closed: false, anchors: [corner(p.x, p.y)] }] });
    path.open = true;
    path.selected = { sub: 0, index: 0 };
    ctx.setLive(path);
    placing = { at: p, screen: sp, dragged: false };
    lastPlaced = sp;
    ctx.setHint('tool.pen.hint');
  },

  pointerMove(ctx, e) {
    if (dragShapeEdit(ctx, e)) return;
    const s = livePath(ctx);
    if (!s) return;
    const p = { x: e.x, y: e.y };
    if (placing) {
      // A few pixels of drag before the point becomes a curve point.
      if (!placing.dragged && Math.hypot(e.sx - placing.screen.x, e.sy - placing.screen.y) < 3) return;
      placing.dragged = true;
      refresh(ctx, s, () => s.penDrag(p));
      return;
    }
    if (s.open) {
      refresh(ctx, s, () => {
        s.rubber = ctx.snapPoint(p);
        s.update();
      });
    }
  },

  pointerUp(ctx) {
    endShapeEdit(ctx);
    placing = null;
  },

  hover(ctx, e) {
    const s = livePath(ctx);
    if (s?.open) {
      ctx.setCursor(s.penNearStart({ x: e.sx, y: e.sy }, screenOf(ctx)) ? 'pointer' : 'crosshair');
      return;
    }
    hoverCursor(ctx, e);
  },

  keyDown(ctx, e) {
    const s = livePath(ctx);
    if (s?.open) {
      if (e.key === 'Enter') {
        finish(ctx);
        ctx.commitLive();
        return true;
      }
      if (e.key === 'Escape') {
        finish(ctx);
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        let left = false;
        lastPlaced = null;
        refresh(ctx, s, () => (left = s.penUndo()));
        if (!left) ctx.cancelLive();
        return true;
      }
      return false;
    }
    return pathKeys(ctx, e);
  },

  optionsChanged: (ctx) => restyleLive(ctx, 'pen', swapped),
  colorsChanged: (ctx) => restyleLive(ctx, 'pen', swapped),
  deactivate: () => {
    placing = null;
    lastPlaced = null;
  },
});
