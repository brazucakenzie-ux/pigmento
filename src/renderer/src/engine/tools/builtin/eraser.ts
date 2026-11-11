import { defaultBrush, LINEAR } from '../../brush/types';
import { createBrushTool } from '../brushTool';
import { registerTool } from '../ToolRegistry';

/** Paint's eraser: hard square pixels. With smooth edges on, a soft round tip. */
const SQUARE = defaultBrush({ tip: { kind: 'square' }, pixel: true, hardness: 1 });
const SMOOTH = defaultBrush({ hardness: 0.7, dynamics: { size: { source: 'pressure', curve: LINEAR, min: 0.08 } } });

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
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 10, presets: [4, 10, 20, 40], log: true },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'antialias', type: 'toggle', labelKey: 'opt.antialias', default: false },
    ],
    cursor: () => 'none',
    brush: (ctx) => {
      const o = ctx.options('eraser');
      return { settings: o.antialias === true ? SMOOTH : SQUARE, size: Number(o.size ?? 10), opacity: Number(o.opacity ?? 100) / 100, pressure: true };
    },
    overlay: (ctx, ov, hover) => {
      const o = ctx.options('eraser');
      const size = Number(o.size ?? 10);
      if (o.antialias === true) ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
      else ov.squareCursor(hover.x, hover.y, size);
    },
  }),
);
