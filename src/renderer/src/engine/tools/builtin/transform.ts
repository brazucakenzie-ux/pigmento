import { TransformObject, type TransformHit } from '../../live/TransformObject';
import { quadBounds } from '../../raster/warp';
import type { TransformMode } from '../../live/quadEdit';
import { registerTool } from '../ToolRegistry';
import type { ToolContext } from '../Tool';

const MODES: TransformMode[] = ['free', 'skew', 'distort', 'perspective'];

function transformOf(ctx: ToolContext): TransformObject | null {
  return ctx.live instanceof TransformObject ? ctx.live : null;
}

/** The drag in progress: what was grabbed, where, and the transform's bounds then. */
let drag: { hit: TransformHit; at: { x: number; y: number }; bounds: { x: number; y: number; w: number; h: number } } | null = null;

const screenOf = (ctx: ToolContext) => (q: { x: number; y: number }) => ctx.view.toScreen(q.x, q.y);

/**
 * The free transform mode (entered with Ctrl+T, not picked from the ribbon). Handles scale,
 * the round handle or dragging outside rotates, Ctrl+drag distorts a corner or skews a side.
 */
export default registerTool({
  id: 'transform',
  labelKey: 'tool.transform',
  hintKey: 'tool.transform.hint',
  icon: 'transform',
  group: 'selection',
  order: 99,
  hidden: true,
  options: [
    {
      key: 'mode',
      type: 'segmented',
      labelKey: 'opt.transformMode',
      default: 'free',
      iconsOnly: true,
      choices: [
        { value: 'free', labelKey: 'opt.transformMode.free', icon: 'resize' },
        { value: 'skew', labelKey: 'opt.transformMode.skew', icon: 'tf-skew' },
        { value: 'distort', labelKey: 'opt.transformMode.distort', icon: 'tf-distort' },
        { value: 'perspective', labelKey: 'opt.transformMode.perspective', icon: 'tf-perspective' },
      ],
    },
  ],
  cursor: () => 'default',

  pointerDown(ctx, e) {
    const t = transformOf(ctx);
    if (!t) return ctx.restorePreviousTool();
    const hit = t.hit({ x: e.x, y: e.y }, { x: e.sx, y: e.sy }, screenOf(ctx));
    // Double-click inside applies, like pressing Enter.
    if (e.detail >= 2 && hit.type === 'body') return ctx.commitLive(true);
    const opt = String(ctx.options('transform').mode ?? 'free');
    const mode = (MODES as string[]).includes(opt) ? (opt as TransformMode) : 'free';
    t.beginDrag(hit, { x: e.x, y: e.y }, mode);
    drag = { hit, at: { x: e.x, y: e.y }, bounds: quadBounds(t.corners) };
  },

  pointerMove(ctx, e) {
    const t = transformOf(ctx);
    if (!t) return;
    let p = { x: e.x, y: e.y };
    if (drag?.hit.type === 'body') {
      const b = drag.bounds;
      const c = ctx.snapMove({ ...b, x: b.x + p.x - drag.at.x, y: b.y + p.y - drag.at.y });
      p = { x: p.x + c.x, y: p.y + c.y };
    } else if (drag?.hit.type === 'handle') p = ctx.snapPoint(p);
    t.dragTo(p, { shift: e.shift, alt: e.alt, ctrl: e.ctrl });
  },

  pointerUp(ctx) {
    drag = null;
    transformOf(ctx)?.endDrag();
    ctx.invalidateOverlay();
  },

  hover(ctx, e) {
    const t = transformOf(ctx);
    if (!t) return;
    const hit: TransformHit = t.hit({ x: e.x, y: e.y }, { x: e.sx, y: e.sy }, screenOf(ctx));
    ctx.setCursor(t.cursorFor(hit, e.ctrl));
  },

  keyDown(ctx, e) {
    if (!transformOf(ctx)) return false;
    if (e.key === 'Enter') {
      ctx.commitLive(true);
      return true;
    }
    if (e.key === 'Escape') {
      ctx.cancelLive();
      return true;
    }
    return false;
  },
});
