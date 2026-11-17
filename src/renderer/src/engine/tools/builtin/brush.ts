import { brushOf, BRUSH_OPTION, createBrushTool, drawBrushCursor, SMOOTHING_OPTION, type ToolBrush } from '../brushTool';
import { brushRegistry } from '../../brush/BrushRegistry';
import { isFlatNib, nibAngleOf, tipAngleForNib } from '../../brush/nib';
import type { ToolContext } from '../Tool';
import { registerTool } from '../ToolRegistry';

const DEFAULT = 'round';

/** The picked brush with the options bar's values. */
function current(ctx: ToolContext): ToolBrush {
  const o = ctx.options('brush');
  const s = brushOf(o, DEFAULT).settings;
  const angle = isFlatNib(s) ? tipAngleForNib(Number(o.nibAngle ?? nibAngleOf(s))) : s.angle;
  return {
    settings: { ...s, angle, flow: Number(o.flow ?? 100) / 100, hardness: Number(o.hardness ?? 80) / 100 },
    size: Number(o.size ?? 8),
    opacity: Number(o.opacity ?? 100) / 100,
    pressure: o.pressure !== false,
    smoothing: Number(o.smoothing ?? 0) / 100,
  };
}

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
      BRUSH_OPTION(DEFAULT),
      { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 8, presets: [3, 8, 16, 32], log: true },
      {
        key: 'nibAngle',
        type: 'slider',
        labelKey: 'opt.nibAngle',
        min: 0,
        max: 180,
        step: 1,
        unit: '°',
        default: 45,
        // Flat nibs (calligraphy) only: other tips are round or turn by themselves.
        visibleIf: (o) => isFlatNib(brushOf(o, DEFAULT).settings),
      },
      { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      { key: 'flow', advanced: true, type: 'slider', labelKey: 'opt.flow', min: 1, max: 100, step: 1, unit: '%', default: 100 },
      {
        key: 'hardness',
        type: 'slider',
        labelKey: 'opt.hardness',
        min: 0,
        max: 100,
        step: 1,
        unit: '%',
        default: 80,
        // Image tips have their own edges.
        visibleIf: (o) => brushRegistry.get(String(o.brushId ?? DEFAULT))?.settings.tip.kind !== 'image',
      },
      SMOOTHING_OPTION,
      { key: 'pressure', advanced: true, type: 'toggle', labelKey: 'opt.pressure', default: true },
    ],
    cursor: () => 'none',
    brush: current,
    overlay: (ctx, ov, hover) => {
      const b = current(ctx);
      drawBrushCursor(ctx, ov, hover, b.settings, b.size);
    },
  }),
);
