import { defaultBrush } from '../../brush/types';
import { CURSOR_PENCIL } from '../cursors';
import { createBrushTool } from '../brushTool';
import { registerTool } from '../ToolRegistry';

/** Paint's pencil: hard square pixels, stepped pixel by pixel. */
const PENCIL = defaultBrush({ tip: { kind: 'square' }, pixel: true, hardness: 1 });

export default registerTool(
  createBrushTool({
    id: 'pencil',
    labelKey: 'tool.pencil',
    hintKey: 'tool.pencil.hint',
    icon: 'pencil',
    shortcut: 'P',
    group: 'tools',
    order: 10,
    historyLabel: 'history.pencil',
    op: 'over',
    options: [
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 32, step: 1, unit: 'px', default: 1, presets: [1, 2, 3, 4] },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
    ],
    cursor: () => CURSOR_PENCIL,
    brush: (ctx) => {
      const o = ctx.options('pencil');
      return { settings: PENCIL, size: Number(o.size ?? 1), opacity: Number(o.opacity ?? 100) / 100, pressure: false };
    },
    overlay: (ctx, ov, hover) => {
      if (ctx.view.zoom >= 4) ov.squareCursor(hover.x, hover.y, Number(ctx.options('pencil').size ?? 1));
    },
  }),
);
