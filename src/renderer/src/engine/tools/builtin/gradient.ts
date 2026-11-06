import { parseHex } from '../../core/color';
import type { Point } from '../../core/geometry';
import { GRADIENT_TYPES, type GradientRepeat, type GradientSpec, type GradientStop, type GradientType } from '../../raster/gradient';
import { GradientObject, type GradientEnd } from '../../live/GradientObject';
import { registerTool } from '../ToolRegistry';
import type { GradientStopValue, ToolContext } from '../Tool';

function gradientOf(ctx: ToolContext): GradientObject | null {
  return ctx.live instanceof GradientObject ? ctx.live : null;
}

/** Stops from the options, or primary → secondary when none are set. */
export function stopsFromOptions(value: unknown, primary: GradientStop['color'], secondary: GradientStop['color']): GradientStop[] {
  if (Array.isArray(value)) {
    const stops = (value as GradientStopValue[])
      .map((s) => ({ pos: s.pos, color: parseHex(s.color) }))
      .filter((s): s is GradientStop => s.color !== null);
    if (stops.length >= 2) return stops;
  }
  return [
    { pos: 0, color: { ...primary } },
    { pos: 1, color: { ...secondary } },
  ];
}

function specOf(ctx: ToolContext, swap: boolean): { spec: Omit<GradientSpec, 'start' | 'end'>; opacity: number } {
  const o = ctx.options('gradient');
  const type = (GRADIENT_TYPES as readonly string[]).includes(String(o.type)) ? (o.type as GradientType) : 'linear';
  const repeat: GradientRepeat = o.repeat === 'repeat' || o.repeat === 'reflect' ? o.repeat : 'none';
  const [a, b] = swap ? [ctx.secondary, ctx.primary] : [ctx.primary, ctx.secondary];
  return {
    spec: { type, stops: stopsFromOptions(o.stops, a, b), reverse: o.reverse === true, repeat },
    opacity: Math.max(0.01, Math.min(1, Number(o.opacity ?? 100) / 100)),
  };
}

/** Snap the dragged end to 15° steps around the other end. */
function snapAngle(from: Point, p: Point): Point {
  const a = Math.atan2(p.y - from.y, p.x - from.x);
  const step = Math.PI / 12;
  const q = Math.round(a / step) * step;
  const len = Math.hypot(p.x - from.x, p.y - from.y);
  return { x: from.x + Math.cos(q) * len, y: from.y + Math.sin(q) * len };
}

let dragging: GradientEnd | null = null;
let fresh = false;
/** Right-button drags swap the colours of a primary → secondary gradient. */
let swapped = false;

/**
 * Gradient: drag from where it starts to where it ends. Both ends stay draggable until the
 * gradient is applied (Enter, or switching tools); options and colours update it live.
 */
export default registerTool({
  id: 'gradient',
  labelKey: 'tool.gradient',
  hintKey: 'tool.gradient.hint',
  icon: 'gradient',
  shortcut: 'G',
  group: 'tools',
  order: 45,
  paints: true,
  options: [
    {
      key: 'type',
      type: 'segmented',
      labelKey: 'opt.gradientType',
      default: 'linear',
      iconsOnly: true,
      choices: [
        { value: 'linear', labelKey: 'opt.gradientType.linear', icon: 'grad-linear' },
        { value: 'radial', labelKey: 'opt.gradientType.radial', icon: 'grad-radial' },
        { value: 'angular', labelKey: 'opt.gradientType.angular', icon: 'grad-angular' },
        { value: 'diamond', labelKey: 'opt.gradientType.diamond', icon: 'grad-diamond' },
      ],
    },
    { key: 'stops', type: 'gradient', labelKey: 'opt.gradientColors', default: null },
    { key: 'reverse', type: 'toggle', labelKey: 'opt.reverse', icon: 'swap', default: false },
    {
      key: 'repeat',
      type: 'segmented',
      labelKey: 'opt.repeat',
      default: 'none',
      choices: [
        { value: 'none', labelKey: 'opt.repeat.none' },
        { value: 'repeat', labelKey: 'opt.repeat.repeat' },
        { value: 'reflect', labelKey: 'opt.repeat.reflect' },
      ],
    },
    { key: 'opacity', type: 'slider', labelKey: 'opt.opacity', min: 1, max: 100, step: 1, unit: '%', default: 100 },
  ],
  cursor: () => 'crosshair',

  pointerDown(ctx, e) {
    const p = { x: e.x, y: e.y };
    const g = gradientOf(ctx);
    if (g) {
      const hit = g.hit({ x: e.sx, y: e.sy }, (q) => ctx.view.toScreen(q.x, q.y));
      if (hit) {
        dragging = hit;
        fresh = false;
        return;
      }
      ctx.commitLive();
    }
    if (!ctx.canPaint()) return;
    swapped = e.button === 2;
    const { spec, opacity } = specOf(ctx, swapped);
    const obj = new GradientObject({ ...spec, start: p, end: p }, opacity, ctx.doc.selection, ctx.doc.width, ctx.doc.height);
    ctx.setLive(obj);
    dragging = 'end';
    fresh = true;
  },

  pointerMove(ctx, e) {
    const g = gradientOf(ctx);
    if (!g || !dragging) return;
    const other = dragging === 'end' ? g.start : g.end;
    const p = e.shift ? snapAngle(other, { x: e.x, y: e.y }) : { x: e.x, y: e.y };
    g.setPoint(dragging, p);
    ctx.invalidate(g.bounds());
  },

  pointerUp(ctx) {
    const g = gradientOf(ctx);
    if (g && fresh) {
      const a = ctx.view.toScreen(g.start.x, g.start.y);
      const b = ctx.view.toScreen(g.end.x, g.end.y);
      // A click without a drag places nothing.
      if (Math.hypot(a.x - b.x, a.y - b.y) < 3) ctx.cancelLive();
    }
    dragging = null;
    fresh = false;
  },

  hover(ctx, e) {
    const g = gradientOf(ctx);
    const hit = g?.hit({ x: e.sx, y: e.sy }, (q) => ctx.view.toScreen(q.x, q.y));
    ctx.setCursor(hit ? 'move' : 'crosshair');
  },

  keyDown(ctx, e) {
    if (!gradientOf(ctx)) return false;
    if (e.key === 'Enter') {
      ctx.commitLive();
      return true;
    }
    if (e.key === 'Escape') {
      ctx.cancelLive();
      return true;
    }
    return false;
  },

  optionsChanged(ctx) {
    const g = gradientOf(ctx);
    if (!g) return;
    const { spec, opacity } = specOf(ctx, swapped);
    g.update(spec, opacity);
    ctx.invalidate(g.bounds());
  },

  colorsChanged(ctx) {
    this.optionsChanged?.(ctx);
  },

  deactivate() {
    dragging = null;
    fresh = false;
  },
});
