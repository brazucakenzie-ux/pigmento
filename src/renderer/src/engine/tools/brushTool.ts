import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Point, type Rect } from '../core/geometry';
import { BrushStroke, strokeSeed, type StrokeSample } from '../brush/BrushStroke';
import { paintDabInto, type DabShape } from '../brush/dab';
import { textureStore, tipStore } from '../brush/tips';
import type { BrushSettings } from '../brush/types';
import { applyImage, type PixelView } from '../raster/pixels';
import { Surface } from '../raster/Surface';
import type { Overlay } from '../render/Overlay';
import type { I18nKey } from '../../i18n';
import type { OptionSpec, Tool, ToolContext, ToolGroup, ToolPointerEvent } from './Tool';

/** What a brush tool paints with right now (from its options and the picked brush). */
export interface ToolBrush {
  settings: BrushSettings;
  /** Diameter in px. */
  size: number;
  /** The stroke's opacity, 0–1 (the brush's own opacity times the tool's). */
  opacity: number;
  /** Pressure dynamics are ignored when this is off. */
  pressure: boolean;
}

export interface BrushToolConfig {
  id: string;
  labelKey: I18nKey;
  hintKey: I18nKey;
  icon: string;
  shortcut: string;
  group: ToolGroup;
  order: number;
  historyLabel: I18nKey;
  /** Paint laid over the layer, or paint that removes it. */
  op: 'over' | 'erase';
  options: OptionSpec[];
  cursor: (ctx: ToolContext) => string;
  brush: (ctx: ToolContext) => ToolBrush;
  overlay?: (ctx: ToolContext, ov: Overlay, hover: Point) => void;
}

/** The tip and grain a brush's dabs use (image tips and textures come from their stores). */
export function dabShapeOf(s: BrushSettings): DabShape {
  const tip = s.tip.kind === 'image' ? (tipStore.get(s.tip.id) ?? 'round') : s.tip.kind;
  const tex = s.texture ? textureStore.get(s.texture.id) : undefined;
  return {
    tip,
    pixel: s.pixel,
    texture: tex && s.texture ? { mask: tex, scale: Math.max(0.25, s.texture.scale), depth: Math.min(1, Math.max(0, s.texture.depth)), mode: s.texture.mode } : null,
  };
}

/** Composite a stroke surface onto a pixel view (the live preview, and the final commit). */
export function compositeStroke(dst: PixelView, r: Rect, stroke: Surface, op: 'over' | 'erase', opacity: number, clip: Parameters<typeof applyImage>[5]): void {
  stroke.forEachTile(r, (sv, sub) => applyImage(dst, sub, sv, op, opacity, clip), false, true);
}

interface StrokeState {
  surface: Surface;
  stroke: BrushStroke;
  bounds: Rect | null;
  start: StrokeSample;
  last: ToolPointerEvent;
  speed: number;
  moved: boolean;
  color: RGBA;
  brush: ToolBrush;
  filter: (view: PixelView, r: Rect) => void;
  straight: boolean;
  timer: number | null;
}

/**
 * Brush, Pencil and Eraser: dabs from the brush engine go into a stroke layer of their own,
 * shown live over the active layer through a display filter, then composited into the layer
 * as one undo step (so flow builds up within the stroke, under the stroke's opacity).
 */
export function createBrushTool(cfg: BrushToolConfig): Tool {
  let st: StrokeState | null = null;

  const sampleOf = (e: ToolPointerEvent, speed: number, pressure: boolean): StrokeSample => ({
    x: e.x,
    y: e.y,
    // Mice and touch have no pressure or tilt: full pressure, upright.
    pressure: pressure && e.pointerType === 'pen' ? Math.min(1, Math.max(0, e.pressure)) : 1,
    tilt: e.pointerType === 'pen' ? Math.min(1, Math.hypot(e.tiltX, e.tiltY) / 90) : 0,
    speed,
  });

  const newStroke = (ctx: ToolContext, surface: Surface, brush: ToolBrush, color: RGBA, seed: number): BrushStroke => {
    const shape = dabShapeOf(brush.settings);
    const layer = ctx.doc.activeRaster;
    const pressureFree = brush.pressure
      ? brush.settings
      : {
          ...brush.settings,
          dynamics: Object.fromEntries(Object.entries(brush.settings.dynamics).filter(([, d]) => d?.source !== 'pressure')),
        };
    return new BrushStroke({
      settings: pressureFree,
      size: brush.size,
      color,
      seed,
      pickColor: layer
        ? (x, y, r) => {
            // Average a few pixels around the dab (wet paint picks up what it touches).
            let n = 0;
            const acc = { r: 0, g: 0, b: 0, a: 0 };
            for (const [ox, oy] of [
              [0, 0],
              [-r, 0],
              [r, 0],
              [0, -r],
              [0, r],
            ]) {
              const c = layer.surface.getPixel(Math.floor(x + ox), Math.floor(y + oy));
              acc.r += c.r;
              acc.g += c.g;
              acc.b += c.b;
              acc.a += c.a;
              n++;
            }
            return { r: acc.r / n, g: acc.g / n, b: acc.b / n, a: acc.a / n };
          }
        : undefined,
      emit: (d) => {
        const touched = paintDabInto(surface, d, shape);
        if (touched && st) st.bounds = rectUnion(st.bounds, touched);
        return touched;
      },
    });
  };

  const stopTimer = () => {
    if (st?.timer != null) window.clearInterval(st.timer);
    if (st) st.timer = null;
  };

  return {
    id: cfg.id,
    labelKey: cfg.labelKey,
    hintKey: cfg.hintKey,
    icon: cfg.icon,
    shortcut: cfg.shortcut,
    group: cfg.group,
    order: cfg.order,
    options: cfg.options,
    paints: true,
    cursor: (ctx) => cfg.cursor(ctx),

    pointerDown(ctx, e) {
      ctx.commitLive();
      if (!ctx.canPaint()) return;
      const doc = ctx.doc;
      const brush = cfg.brush(ctx);
      const color = e.button === 2 ? ctx.secondary : ctx.primary;
      const clip = doc.selection?.maskView() ?? null;
      const surface = new Surface(doc.width, doc.height);
      const start = sampleOf(e, 0, brush.pressure);
      const filter = (view: PixelView, r: Rect) => {
        const s = st;
        const area = s?.bounds ? rectIntersect(r, s.bounds) : null;
        if (s && area) compositeStroke(view, area, s.surface, cfg.op, s.brush.opacity, clip);
      };
      // The stroke reports what it paints through st, so st is set before the first dab.
      const stroke = newStroke(ctx, surface, brush, color, strokeSeed(e.x, e.y));
      st = { surface, stroke, bounds: null, start, last: e, speed: 0, moved: false, color, brush, filter, straight: false, timer: null };
      ctx.addLayerFilter(filter);
      ctx.syncActiveLayer(stroke.begin(start));
      if (brush.settings.airbrush) {
        // Holding still keeps spraying (at most every 30 ms).
        st.timer = window.setInterval(() => {
          const s = st;
          if (!s || s.straight) return;
          if (s.moved) {
            s.moved = false;
            return;
          }
          const dirty = s.stroke.hold();
          if (dirty) ctx.syncActiveLayer(dirty);
        }, 30);
      }
    },

    pointerMove(ctx, e) {
      const s = st;
      if (!s) return;
      // Speed in screen px per ms, smoothed, as 0–1 (3 px/ms counts as fast).
      const dt = e.timeStamp - s.last.timeStamp;
      if (dt > 0) s.speed = s.speed * 0.7 + 0.3 * Math.min(1, Math.hypot(e.sx - s.last.sx, e.sy - s.last.sy) / dt / 3);
      s.moved = true;
      const sample = sampleOf(e, s.speed, s.brush.pressure);
      if (e.shift) {
        // Shift: a straight line from where the stroke started, redrawn as the pointer moves.
        const old = s.bounds;
        s.surface = new Surface(ctx.doc.width, ctx.doc.height);
        s.bounds = null;
        s.straight = true;
        s.stroke = newStroke(ctx, s.surface, s.brush, s.color, strokeSeed(s.start.x, s.start.y));
        s.stroke.begin(s.start);
        s.stroke.to(sample);
        ctx.syncActiveLayer(rectUnion(old, s.bounds));
        s.last = e;
        return;
      }
      if (s.straight) return;
      const dirty = s.stroke.to(sample);
      s.last = e;
      if (dirty) ctx.syncActiveLayer(dirty);
    },

    pointerUp(ctx) {
      stopTimer();
      const s = st;
      st = null;
      if (!s) return;
      ctx.removeLayerFilter(s.filter);
      const b = s.bounds;
      const layer = ctx.doc.activeRaster;
      if (!b || !layer) return;
      const surf = layer.surface;
      const clip = ctx.doc.selection?.maskView() ?? null;
      surf.beginEdit();
      // Only the layer tiles the stroke painted are touched.
      s.surface.forEachTile(b, (sv, sub) => surf.compositeImage(sub, sv, cfg.op, s.brush.opacity, clip), false, true);
      ctx.pushPixels(cfg.historyLabel, layer, surf.endEdit());
      ctx.syncActiveLayer(b);
    },

    deactivate() {
      stopTimer();
    },

    hover(ctx) {
      ctx.invalidateOverlay();
    },

    drawOverlay(ctx, ov, hover) {
      if (hover && cfg.overlay) cfg.overlay(ctx, ov, hover);
    },
  };
}
