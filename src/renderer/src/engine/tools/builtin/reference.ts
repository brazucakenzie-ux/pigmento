import type { Point } from '../../core/geometry';
import { registerTool } from '../ToolRegistry';
import type { ToolContext } from '../Tool';

/**
 * Reference image: drag it to move it, drag its corner handle to scale it. It floats over the
 * canvas for looking at only; it is never part of the picture.
 */
let drag: { mode: 'move' | 'scale'; start: Point; x: number; y: number; scale: number } | null = null;

const HANDLE = 8;

function corner(ctx: ToolContext): Point | null {
  const r = ctx.reference;
  return r ? ctx.view.toScreen(r.x + r.w * r.scale, r.y + r.h * r.scale) : null;
}

function inside(ctx: ToolContext, p: Point): boolean {
  const r = ctx.reference;
  return !!r && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w * r.scale && p.y <= r.y + r.h * r.scale;
}

export default registerTool({
  id: 'reference',
  labelKey: 'tool.reference',
  hintKey: 'tool.reference.hint',
  icon: 'reference',
  group: 'tools',
  order: 67,
  galleryOnly: true,
  options: [
    { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 5, max: 100, step: 1, unit: '%', default: 50 },
    { key: 'visible', type: 'toggle', labelKey: 'opt.referenceVisible', default: true },
  ],
  cursor: () => 'move',
  activate(ctx) {
    const o = ctx.options('reference');
    ctx.updateReference({ opacity: Number(o.opacity ?? 50) / 100, visible: o.visible !== false });
  },
  optionsChanged(ctx) {
    const o = ctx.options('reference');
    ctx.updateReference({ opacity: Number(o.opacity ?? 50) / 100, visible: o.visible !== false });
  },
  pointerDown(ctx, e) {
    const r = ctx.reference;
    if (!r) {
      ctx.notify('info', 'notice.referenceNone');
      return;
    }
    const c = corner(ctx);
    const onCorner = c !== null && Math.abs(e.sx - c.x) <= HANDLE && Math.abs(e.sy - c.y) <= HANDLE;
    if (!onCorner && !inside(ctx, e)) return;
    drag = { mode: onCorner ? 'scale' : 'move', start: { x: e.x, y: e.y }, x: r.x, y: r.y, scale: r.scale };
  },
  pointerMove(ctx, e) {
    const r = ctx.reference;
    if (!drag || !r) return;
    if (drag.mode === 'move') {
      ctx.updateReference({ x: drag.x + e.x - drag.start.x, y: drag.y + e.y - drag.start.y });
      return;
    }
    // Scale from the top-left corner, keeping the picture's proportions.
    const w = Math.max(8, e.x - drag.x);
    const h = Math.max(8, e.y - drag.y);
    ctx.updateReference({ scale: Math.max(0.02, Math.min(50, Math.max(w / r.w, h / r.h))) });
  },
  pointerUp() {
    drag = null;
  },
  hover(ctx, e) {
    const c = corner(ctx);
    ctx.setCursor(c && Math.abs(e.sx - c.x) <= HANDLE && Math.abs(e.sy - c.y) <= HANDLE ? 'nwse-resize' : inside(ctx, e) ? 'move' : 'default');
  },
  drawOverlay(ctx, ov) {
    const r = ctx.reference;
    if (!r || !r.visible) return;
    const pts = [
      ov.toScreen({ x: r.x, y: r.y }),
      ov.toScreen({ x: r.x + r.w * r.scale, y: r.y }),
      ov.toScreen({ x: r.x + r.w * r.scale, y: r.y + r.h * r.scale }),
      ov.toScreen({ x: r.x, y: r.y + r.h * r.scale }),
    ];
    ov.outlineScreen(pts, true, true);
    ov.handle(pts[2], 'square', drag?.mode === 'scale');
  },
});
