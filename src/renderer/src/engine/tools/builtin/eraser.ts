import { brushOf, BRUSH_OPTION, createBrushTool, drawBrushCursor, SMOOTHING_OPTION } from '../brushTool';
import { registerTool } from '../ToolRegistry';

/** Paint's eraser by default (hard square pixels); any brush can erase. */
const DEFAULT = 'eraser-pixel';

export default registerTool(
  createBrushTool({
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
      BRUSH_OPTION(DEFAULT),
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 10, presets: [4, 10, 20, 40], log: true },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      SMOOTHING_OPTION,
    ],
    cursor: () => 'none',
    brush: (ctx) => {
      const o = ctx.options('eraser');
      return { settings: brushOf(o, DEFAULT).settings, size: Number(o.size ?? 10), opacity: Number(o.opacity ?? 100) / 100, pressure: true, smoothing: Number(o.smoothing ?? 0) / 100 };
    },
    overlay: (ctx, ov, hover) => {
      const o = ctx.options('eraser');
      const size = Number(o.size ?? 10);
      const s = brushOf(o, DEFAULT).settings;
      if (s.pixel) ov.squareCursor(hover.x, hover.y, size);
      else drawBrushCursor(ctx, ov, hover, s, size);
    },
  }),
);
