import { toCss, type RGBA } from '../../core/color';
import { CURSOR_PICKER } from '../cursors';
import { registerTool } from '../ToolRegistry';

let sample: RGBA | null = null;
let button: 0 | 2 = 0;

export default registerTool({
  id: 'picker',
  labelKey: 'tool.picker',
  hintKey: 'tool.picker.hint',
  icon: 'picker',
  shortcut: 'I',
  group: 'tools',
  order: 50,
  options: [],
  cursor: () => CURSOR_PICKER,
  pointerDown(ctx, e) {
    button = e.button;
    sample = ctx.sampleColor(e.x, e.y);
    ctx.invalidateOverlay();
  },
  pointerMove(ctx, e) {
    sample = ctx.sampleColor(e.x, e.y);
    ctx.invalidateOverlay();
  },
  pointerUp(ctx) {
    if (sample) {
      if (button === 2) ctx.setSecondary(sample);
      else ctx.setPrimary(sample);
    }
    sample = null;
    // Like Paint: go back to the tool you were using.
    ctx.restorePreviousTool();
  },
  drawOverlay(ctx, ov, hover) {
    if (!sample || !hover) return;
    const sp = ov.toScreen(hover);
    const c = ov.ctx;
    c.save();
    c.beginPath();
    c.arc(sp.x + 22, sp.y - 22, 14, 0, Math.PI * 2);
    c.fillStyle = toCss(sample);
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#ffffff';
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.stroke();
    c.restore();
  },
});
