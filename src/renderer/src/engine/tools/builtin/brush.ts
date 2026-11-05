import { createStrokeTool } from '../strokeTool';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createStrokeTool({
    id: 'brush',
    labelKey: 'tool.brush',
    hintKey: 'tool.brush.hint',
    icon: 'brush',
    shortcut: 'B',
    group: 'brushes',
    order: 20,
    historyLabel: 'history.brush',
    op: 'over',
    options: [
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 8, presets: [3, 8, 16, 32], log: true },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'hardness', type: 'slider', labelKey: 'opt.hardness', min: 0, max: 100, step: 1, unit: '%', default: 80 },
      { key: 'pressure', type: 'toggle', labelKey: 'opt.pressure', default: true },
    ],
    cursor: () => 'none',
    params: (o) => ({
      size: Number(o.size ?? 8),
      opacity: Number(o.opacity ?? 100) / 100,
      square: false,
      hardness: Number(o.hardness ?? 80) / 100,
      pressureSize: o.pressure !== false,
    }),
    overlay: (ctx, ov, hover) => {
      if (!hover) return;
      const size = Number(ctx.options('brush').size ?? 8);
      ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
    },
  }),
);
