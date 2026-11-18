import type { I18nKey } from '../../i18n';
import type { DabOp } from '../brush/retouch';
import { brushOf, BRUSH_OPTION, createBrushTool, drawBrushCursor, SMOOTHING_OPTION, type BrushToolConfig, type DirectPaint } from './brushTool';
import type { OptionSpec, Tool, ToolContext } from './Tool';

/** A strength slider (0–100 %) for retouching tools. */
export const STRENGTH = (def: number, labelKey: I18nKey = 'opt.strength'): OptionSpec => ({ key: 'strength', type: 'slider', labelKey, min: 1, max: 100, step: 1, unit: '%', default: def });

const SIZE: OptionSpec = { key: 'size', type: 'slider', labelKey: 'opt.size', min: 1, max: 400, step: 1, unit: 'px', default: 30, presets: [10, 30, 60, 120], log: true };
const PRESSURE: OptionSpec = { key: 'pressure', advanced: true, type: 'toggle', labelKey: 'opt.pressure', default: true };

interface RetouchConfig {
  id: string;
  labelKey: I18nKey;
  hintKey: I18nKey;
  icon: string;
  shortcut: string;
  order: number;
  historyLabel: I18nKey;
  defaultBrush?: string;
  /** Options between the size and the stabiliser. */
  options: OptionSpec[];
  /** The pixel operation for one stroke copy, from the tool's options. */
  op: (ctx: ToolContext, o: Record<string, unknown>, s: Parameters<DirectPaint['begin']>[1]) => DabOp | null;
  altClick?: BrushToolConfig['altClick'];
  overlay?: BrushToolConfig['overlay'];
}

/**
 * Smudge, Blur, Sharpen, Clone Stamp and Dodge/Burn: brush tools (any brush, its dynamics,
 * symmetry and stabiliser) whose dabs change the layer's pixels directly.
 */
export function createRetouchTool(cfg: RetouchConfig): Tool {
  const fallback = cfg.defaultBrush ?? 'round-soft';
  return createBrushTool({
    id: cfg.id,
    labelKey: cfg.labelKey,
    hintKey: cfg.hintKey,
    icon: cfg.icon,
    shortcut: cfg.shortcut,
    group: 'retouch',
    order: cfg.order,
    historyLabel: cfg.historyLabel,
    op: 'over',
    options: [BRUSH_OPTION(fallback), SIZE, ...cfg.options, SMOOTHING_OPTION, PRESSURE],
    cursor: () => 'none',
    brush: (ctx) => {
      const o = ctx.options(cfg.id);
      return { settings: brushOf(o, fallback).settings, size: Number(o.size ?? 30), opacity: 1, pressure: o.pressure !== false, smoothing: Number(o.smoothing ?? 0) / 100 };
    },
    direct: { begin: (ctx, s) => cfg.op(ctx, ctx.options(cfg.id), s) },
    altClick: cfg.altClick,
    overlay: (ctx, ov, hover) => {
      const o = ctx.options(cfg.id);
      const size = Number(o.size ?? 30);
      // On a piece the circle follows its transform; on a layer it's the plain circle.
      if (ctx.anim.paintTarget) drawBrushCursor(ctx, ov, hover, { ...brushOf(o, fallback).settings, roundness: 1, angle: 0 }, size);
      else ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
      cfg.overlay?.(ctx, ov, hover);
    },
  });
}
