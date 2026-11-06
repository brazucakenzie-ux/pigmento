import { SELECTION_MODE_OPTION, selectionModeFor } from '../selectTools';
import { registerTool } from '../ToolRegistry';

/** Magic wand: click to select an area of similar colour (Shift adds, Alt subtracts). */
export default registerTool({
  id: 'wand',
  labelKey: 'tool.wand',
  hintKey: 'tool.wand.hint',
  icon: 'wand',
  shortcut: 'W',
  group: 'selection',
  order: 5,
  options: [
    SELECTION_MODE_OPTION,
    { key: 'tolerance', type: 'slider', labelKey: 'opt.tolerance', min: 0, max: 100, step: 1, unit: '%', default: 25 },
    { key: 'contiguous', type: 'toggle', labelKey: 'opt.contiguous', default: true },
    { key: 'sampleAll', type: 'toggle', labelKey: 'opt.sampleAll', default: false },
  ],
  cursor: () => 'crosshair',
  pointerDown(ctx, e) {
    const o = ctx.options('wand');
    const { mode } = selectionModeFor(ctx, 'wand', e);
    // Floating pixels are put down first; combining modes keep their selection to build on.
    ctx.commitLive(mode !== 'replace');
    void ctx.magicWand(e.x, e.y, { tolerance: Number(o.tolerance ?? 25), contiguous: o.contiguous !== false, sampleAll: o.sampleAll === true }, mode);
  },
  pointerMove() {},
  pointerUp() {},
});
