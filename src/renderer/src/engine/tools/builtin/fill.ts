import { CURSOR_FILL } from '../cursors';
import { registerTool } from '../ToolRegistry';

export default registerTool({
  id: 'fill',
  labelKey: 'tool.fill',
  hintKey: 'tool.fill.hint',
  icon: 'fill',
  shortcut: 'F',
  group: 'tools',
  order: 40,
  paints: true,
  options: [
    { key: 'tolerance', type: 'slider', labelKey: 'opt.tolerance', min: 0, max: 100, step: 1, unit: '%', default: 15 },
    { key: 'contiguous', type: 'toggle', labelKey: 'opt.contiguous', default: true },
  ],
  cursor: () => CURSOR_FILL,
  pointerDown(ctx, e) {
    ctx.commitLive();
    const o = ctx.options('fill');
    const color = e.button === 2 ? ctx.secondary : ctx.primary;
    void ctx.floodFill(e.x, e.y, color, Number(o.tolerance ?? 15), o.contiguous !== false);
  },
  pointerMove() {},
  pointerUp() {},
});
