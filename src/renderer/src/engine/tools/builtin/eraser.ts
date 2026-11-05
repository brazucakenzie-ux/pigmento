import { createStrokeTool } from '../strokeTool';
import { registerTool } from '../ToolRegistry';

export default registerTool(
  createStrokeTool({
    id: 'eraser',
    labelKey: 'tool.eraser',
    hintKey: 'tool.eraser.hint',
    icon: 'eraser',
    shortcut: 'E',
    group: 'tools',
    order: 30,
    historyLabel: 'history.eraser',
    op: 'erase',
    options: [
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 10, presets: [4, 10, 20, 40], log: true },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'antialias', type: 'toggle', labelKey: 'opt.antialias', default: false },
    ],
    cursor: () => 'none',
    params: (o) => ({
      size: Number(o.size ?? 10),
      opacity: Number(o.opacity ?? 100) / 100,
      square: o.antialias !== true,
      hardness: 0.7,
      pressureSize: true,
    }),
    overlay: (ctx, ov, hover) => {
      if (!hover) return;
      const o = ctx.options('eraser');
      const size = Number(o.size ?? 10);
      if (o.antialias === true) ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
      else ov.squareCursor(hover.x, hover.y, size);
    },
  }),
);
