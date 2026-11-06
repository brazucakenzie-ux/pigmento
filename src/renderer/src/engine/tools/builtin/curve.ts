import { rectUnion, snapAngle45, type Point } from '../../core/geometry';
import { ShapeObject } from '../../live/ShapeObject';
import type { ToolContext } from '../Tool';
import {
  ANTIALIAS_OPTION,
  WIDTH_OPTION,
  beginShapeEdit,
  dragShapeEdit,
  endShapeEdit,
  hoverCursor,
  liveShape,
  restyleLive,
  shapeKeys,
  shapeStyle,
  snapCenter,
} from '../shapeTools';
import { registerTool } from '../ToolRegistry';

/**
 * Paint-style curve: drag a straight line, then drag twice to bend it (first bend moves both
 * control points, second refines the second). Afterwards all four points have handles.
 */
type Stage = 'idle' | 'line' | 'bend1' | 'bend2' | 'edit';
let stage: Stage = 'idle';
let dragging = false;
let start: Point | null = null;
let swapped = false;

function setPoints(ctx: ToolContext, pts: Point[]): void {
  const live = liveShape(ctx);
  if (!live) return;
  const before = live.bounds();
  live.points = pts;
  live.update();
  ctx.invalidate(rectUnion(before, live.bounds()));
}

export default registerTool({
  id: 'curve',
  labelKey: 'tool.curve',
  hintKey: 'tool.curve.hint',
  icon: 'curve',
  shortcut: 'C',
  group: 'shapes',
  order: 110,
  paints: true,
  options: [WIDTH_OPTION, ANTIALIAS_OPTION],
  cursor: () => 'crosshair',

  activate() {
    stage = 'idle';
  },

  pointerDown(ctx, e) {
    const live = liveShape(ctx);
    if (!live) stage = 'idle';
    if (live && (stage === 'bend1' || stage === 'bend2')) {
      dragging = true;
      this.pointerMove(ctx, e);
      return;
    }
    if (stage === 'edit' && beginShapeEdit(ctx, e)) {
      dragging = true;
      return;
    }
    ctx.commitLive();
    if (!ctx.canPaint()) return;
    swapped = e.button === 2;
    start = ctx.snapPoint(snapCenter(e));
    stage = 'line';
    dragging = true;
  },

  pointerMove(ctx, e) {
    if (!dragging) return;
    const live = liveShape(ctx);
    const p = ctx.snapPoint(snapCenter(e));
    if (stage === 'edit') {
      dragShapeEdit(ctx, e);
      return;
    }
    if (stage === 'line' && start) {
      const end = e.shift ? snapAngle45(start, p) : p;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
      const c1 = { x: start.x + (end.x - start.x) / 3, y: start.y + (end.y - start.y) / 3 };
      const c2 = { x: start.x + ((end.x - start.x) * 2) / 3, y: start.y + ((end.y - start.y) * 2) / 3 };
      if (!live) {
        ctx.setLive(new ShapeObject('curve', shapeStyle(ctx, 'curve', swapped), ctx.doc.width, ctx.doc.height, { points: [start, c1, c2, end] }));
      } else setPoints(ctx, [start, c1, c2, end]);
      return;
    }
    if (!live) return;
    const [a, c1, , b] = live.points;
    if (stage === 'bend1') setPoints(ctx, [a, p, p, b]);
    else if (stage === 'bend2') setPoints(ctx, [a, c1, p, b]);
  },

  pointerUp(ctx) {
    dragging = false;
    if (stage === 'edit') {
      endShapeEdit(ctx);
      return;
    }
    if (!liveShape(ctx)) {
      stage = 'idle';
      return;
    }
    if (stage === 'line') stage = 'bend1';
    else if (stage === 'bend1') stage = 'bend2';
    else if (stage === 'bend2') {
      stage = 'edit';
      ctx.setHint('opt.liveHint');
    }
  },

  hover(ctx, e) {
    if (stage === 'edit') hoverCursor(ctx, e);
    else ctx.setCursor('crosshair');
  },

  keyDown(ctx, e) {
    const handled = shapeKeys(ctx, e);
    if (handled) stage = 'idle';
    return handled;
  },
  optionsChanged: (ctx) => restyleLive(ctx, 'curve', swapped),
  colorsChanged: (ctx) => restyleLive(ctx, 'curve', swapped),
  deactivate: () => {
    stage = 'idle';
    dragging = false;
  },
});
