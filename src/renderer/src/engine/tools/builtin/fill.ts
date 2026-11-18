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
  paintsPieces: true,
  options: [
    {
      key: 'fillWith',
      type: 'segmented',
      labelKey: 'opt.fillWith',
      default: 'color',
      choices: [
        { value: 'color', labelKey: 'opt.fillWith.color' },
        { value: 'pattern', labelKey: 'opt.fillWith.pattern' },
      ],
    },
    { key: 'pattern', type: 'pattern', labelKey: 'opt.pattern', default: 'checker', visibleIf: (v) => v.fillWith === 'pattern' },
    { key: 'patternScale', type: 'slider', labelKey: 'opt.patternScale', min: 1, max: 8, step: 1, unit: '×', default: 1, visibleIf: (v) => v.fillWith === 'pattern' },
    { key: 'patternClear', type: 'toggle', labelKey: 'opt.patternClear', default: false, visibleIf: (v) => v.fillWith === 'pattern' },
    { key: 'tolerance', type: 'slider', labelKey: 'opt.tolerance', min: 0, max: 100, step: 1, unit: '%', default: 15 },
    { key: 'contiguous', type: 'toggle', labelKey: 'opt.contiguous', default: true },
  ],
  cursor: () => CURSOR_FILL,
  pointerDown(ctx, e) {
    ctx.commitLive();
    const o = ctx.options('fill');
    // Right-click swaps the colours (for patterns: foreground and background).
    const [a, b] = e.button === 2 ? [ctx.secondary, ctx.primary] : [ctx.primary, ctx.secondary];
    const paint =
      o.fillWith === 'pattern'
        ? { pattern: String(o.pattern ?? 'checker'), fg: a, bg: o.patternClear === true ? null : b, scale: Number(o.patternScale ?? 1) }
        : a;
    void ctx.floodFill(e.x, e.y, paint, Number(o.tolerance ?? 15), o.contiguous !== false);
  },
  pointerMove() {},
  pointerUp() {},
});
