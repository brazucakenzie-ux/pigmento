import { CURSOR_PENCIL } from '../cursors';
import { createStrokeTool } from '../strokeTool';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createStrokeTool({
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
    params: (o) => ({
      size: Number(o.size ?? 1),
      opacity: Number(o.opacity ?? 100) / 100,
      square: true,
      hardness: 1,
      pressureSize: false,
    }),
    overlay: (ctx, ov, hover) => {
      if (ctx.view.zoom >= 4 && hover) ov.squareCursor(hover.x, hover.y, Number(ctx.options('pencil').size ?? 1));
    },
  }),
);
