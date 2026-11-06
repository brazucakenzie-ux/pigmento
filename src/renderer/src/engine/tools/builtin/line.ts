import { rectUnion, snapAngle45, type Point } from '../../core/geometry';
import { ShapeObject } from '../../live/ShapeObject';
import { ANTIALIAS_OPTION, WIDTH_OPTION, DRAW_AS_OPTION, beginShapeEdit, dragShapeEdit, endShapeEdit, hoverCursor, liveShape, restyleLive, shapeKeys, shapeStyle, snapCenter, outlineStyleOption } from '../shapeTools';
import { registerTool } from '../ToolRegistry';

let start: Point | null = null;
let swapped = false;

export default registerTool({
  id: 'line',
  labelKey: 'tool.line',
  hintKey: 'tool.line.hint',
  icon: 'line',
  shortcut: 'L',
  group: 'shapes',
  order: 100,
  paints: true,
  options: [DRAW_AS_OPTION, WIDTH_OPTION, outlineStyleOption({ cap: 'round', join: 'round', arrows: true, corners: false }), ANTIALIAS_OPTION],
  cursor: () => 'crosshair',

  pointerDown(ctx, e) {
    if (beginShapeEdit(ctx, e)) return;
    ctx.commitLive();
    if (!ctx.canPaint()) return;
    swapped = e.button === 2;
    start = ctx.snapPoint(snapCenter(e));
  },

  pointerMove(ctx, e) {
    if (dragShapeEdit(ctx, e)) return;
    if (!start) return;
    let end = ctx.snapPoint(snapCenter(e));
    if (e.shift) end = snapAngle45(start, end);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
    const live = liveShape(ctx);
    if (!live) {
      ctx.setLive(new ShapeObject('line', shapeStyle(ctx, 'line', swapped), ctx.doc.width, ctx.doc.height, { points: [start, end] }));
      ctx.setHint('opt.liveHint');
      return;
    }
    const before = live.bounds();
    live.points = [start, end];
    live.update();
    ctx.invalidate(rectUnion(before, live.bounds()));
  },

  pointerUp(ctx) {
    endShapeEdit(ctx);
    start = null;
  },

  hover: hoverCursor,
  keyDown: shapeKeys,
  optionsChanged: (ctx) => restyleLive(ctx, 'line', swapped),
  colorsChanged: (ctx) => restyleLive(ctx, 'line', swapped),
  deactivate: () => {
    start = null;
  },
});
