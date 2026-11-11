import type { Point } from '../../core/geometry';
import { cloneOp } from '../../brush/retouch';
import { createRetouchTool } from '../retouchTools';
import { registerTool } from '../ToolRegistry';
import type { ToolContext } from '../Tool';

/** Where to copy from (set with Alt+click), and the offset of an aligned clone. */
let source: Point | null = null;
let offset: Point | null = null;
/** Per stroke: the offset in use, for the overlay. */
let current: Point | null = null;

function offsetFor(ctx: ToolContext, start: Point): Point | null {
  if (!source) return null;
  const aligned = ctx.options('clone').aligned !== false;
  // Aligned: the first stroke fixes the offset. Not aligned: every stroke starts at the source.
  if (!aligned || !offset) offset = { x: source.x - start.x, y: source.y - start.y };
  return offset;
}

export default registerTool(
  createRetouchTool({
    id: 'clone',
    labelKey: 'tool.clone',
    hintKey: 'tool.clone.hint',
    icon: 'clone',
    shortcut: 'J',
    order: 40,
    historyLabel: 'history.clone',
    options: [
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'aligned', type: 'toggle', labelKey: 'opt.cloneAligned', default: true },
    ],
    op: (ctx, o, s) => {
      // Every symmetry copy uses the same offset (worked out for the first one).
      const off = s.copy === 0 ? offsetFor(ctx, s.start) : current;
      if (!off) {
        ctx.notify('info', 'notice.cloneNeedsSource');
        return null;
      }
      current = off;
      return cloneOp(s.layer.surface, s.layer.surface.snapshot(), s.shape, s.clip, off, Number(o.opacity ?? 100) / 100);
    },
    altClick: (ctx, e) => {
      source = { x: e.x, y: e.y };
      offset = null;
      ctx.invalidateOverlay();
      return true;
    },
    overlay: (_ctx, ov, hover) => {
      // Where the brush is copying from: the source, or the pointer plus the aligned offset.
      const at = offset ? { x: hover.x + offset.x, y: hover.y + offset.y } : source;
      if (!at) return;
      const p = ov.toScreen(at);
      ov.line({ x: p.x - 7, y: p.y }, { x: p.x + 7, y: p.y });
      ov.line({ x: p.x, y: p.y - 7 }, { x: p.x, y: p.y + 7 });
    },
  }),
);
