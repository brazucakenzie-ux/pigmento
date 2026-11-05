import { rectFromPoints, type Point } from '../../core/geometry';
import { CURSOR_ZOOM_IN, CURSOR_ZOOM_OUT } from '../cursors';
import { registerTool } from '../ToolRegistry';

let start: { sp: Point; p: Point; button: 0 | 2 } | null = null;
let current: Point | null = null;
let altHeld = false;

export default registerTool({
  id: 'zoom',
  labelKey: 'tool.zoom',
  hintKey: 'tool.zoom.hint',
  icon: 'zoom',
  shortcut: 'Z',
  group: 'tools',
  order: 60,
  options: [],
  cursor: () => (altHeld ? CURSOR_ZOOM_OUT : CURSOR_ZOOM_IN),
  pointerDown(_ctx, e) {
    start = { sp: { x: e.sx, y: e.sy }, p: { x: e.x, y: e.y }, button: e.button };
    current = { x: e.sx, y: e.sy };
  },
  pointerMove(ctx, e) {
    current = { x: e.sx, y: e.sy };
    ctx.invalidateOverlay();
  },
  pointerUp(ctx, e) {
    const s = start;
    start = null;
    current = null;
    if (!s) return;
    const dragged = Math.hypot(e.sx - s.sp.x, e.sy - s.sp.y) > 6;
    if (dragged && s.button === 0) {
      ctx.zoomToRect(rectFromPoints(s.p, { x: e.x, y: e.y }));
      return;
    }
    const out = s.button === 2 || e.alt;
    const z = out ? ctx.view.nextZoom(-1) : ctx.view.nextZoom(1);
    ctx.zoomAt(z, e.sx, e.sy);
  },
  hover(ctx, e) {
    if (e.alt !== altHeld) {
      altHeld = e.alt;
      ctx.setCursor(altHeld ? CURSOR_ZOOM_OUT : CURSOR_ZOOM_IN);
    }
  },
  drawOverlay(_ctx, ov) {
    if (!start || !current) return;
    const a = start.sp;
    const b = current;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= 6) return;
    ov.outlineScreen(
      [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
      ],
      true,
      true,
    );
  },
});
