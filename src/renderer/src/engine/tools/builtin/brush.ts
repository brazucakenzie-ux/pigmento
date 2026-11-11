import { defaultBrush, LINEAR } from '../../brush/types';
import { createBrushTool, SMOOTHING_OPTION } from '../brushTool';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createBrushTool({
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
      { key: 'flow', type: 'slider', labelKey: 'opt.flow', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'hardness', type: 'slider', labelKey: 'opt.hardness', min: 0, max: 100, step: 1, unit: '%', default: 80 },
      SMOOTHING_OPTION,
      { key: 'pressure', type: 'toggle', labelKey: 'opt.pressure', default: true },
    ],
    cursor: () => 'none',
    brush: (ctx) => {
      const o = ctx.options('brush');
      return {
        settings: defaultBrush({
          hardness: Number(o.hardness ?? 80) / 100,
          flow: Number(o.flow ?? 100) / 100,
          // Pen pressure sets the size (down to 8%).
          dynamics: { size: { source: 'pressure', curve: LINEAR, min: 0.08 } },
        }),
        size: Number(o.size ?? 8),
        opacity: Number(o.opacity ?? 100) / 100,
        pressure: o.pressure !== false,
        smoothing: Number(o.smoothing ?? 0) / 100,
      };
    },
    overlay: (ctx, ov, hover) => {
      const size = Number(ctx.options('brush').size ?? 8);
      ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
    },
  }),
);
