import { registerTool } from '../ToolRegistry';

/** Rotate view: drag around the middle of the canvas to turn the view (Shift: 15° steps). */
let drag: { from: number; base: number } | null = null;

const angleAt = (cx: number, cy: number, sx: number, sy: number) => (Math.atan2(sy - cy, sx - cx) * 180) / Math.PI;

export default registerTool({
  id: 'rotateView',
  labelKey: 'tool.rotateView',
  hintKey: 'tool.rotateView.hint',
  icon: 'rotate-view',
  group: 'tools',
  order: 66,
  galleryOnly: true,
  options: [],
  cursor: () => (drag ? 'grabbing' : 'grab'),
  pointerDown(ctx, e) {
    // A double-click puts the view upright again.
    if (e.detail >= 2) {
      ctx.setViewRotation(0);
      drag = null;
      return;
    }
    drag = { from: angleAt(ctx.view.width / 2, ctx.view.height / 2, e.sx, e.sy), base: ctx.view.rotation };
    ctx.setCursor('grabbing');
  },
  pointerMove(ctx, e) {
    if (!drag) return;
    let deg = drag.base + angleAt(ctx.view.width / 2, ctx.view.height / 2, e.sx, e.sy) - drag.from;
    if (e.shift) deg = Math.round(deg / 15) * 15;
    ctx.setViewRotation(deg);
  },
  pointerUp(ctx) {
    drag = null;
    ctx.setCursor('grab');
  },
  drawOverlay(ctx, ov) {
    // A compass needle from the middle, pointing to the image's top.
    const cx = ctx.view.width / 2;
    const cy = ctx.view.height / 2;
    const a = ((ctx.view.rotation - 90) * Math.PI) / 180;
    const r = Math.min(60, Math.min(ctx.view.width, ctx.view.height) / 4);
    ov.line({ x: cx, y: cy }, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    ov.handle({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }, 'circle', drag !== null);
    ov.handle({ x: cx, y: cy }, 'square');
  },
});
