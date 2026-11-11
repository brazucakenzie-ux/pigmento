import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Point, type Rect } from '../core/geometry';
import { BrushStroke, strokeSeed, type StrokeSample } from '../brush/BrushStroke';
import { paintDabInto, type DabShape } from '../brush/dab';
import { stabilize, symmetryAxes, symmetryCenter, symmetryCopies } from '../brush/symmetry';
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
  /** Stabiliser strength, 0–1. */
  smoothing: number;
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

/** The stabiliser slider: smooths strokes by trailing the pointer (0–100 %). */
export const SMOOTHING_OPTION: OptionSpec = { key: 'smoothing', type: 'slider', labelKey: 'opt.smoothing', min: 0, max: 100, step: 1, unit: '%', default: 0 };

/** The longest the stabiliser's string gets, in screen px. */
const MAX_STRING = 80;

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

/** Composite a stroke surface onto a pixel view (the live preview). */
export function compositeStroke(dst: PixelView, r: Rect, stroke: Surface, op: 'over' | 'erase', opacity: number, clip: Parameters<typeof applyImage>[5]): void {
  stroke.forEachTile(r, (sv, sub) => applyImage(dst, sub, sv, op, opacity, clip), false, true);
}

/** Symmetry centre handles are this close (screen px) to be grabbed. */
const CENTER_GRAB = 9;

interface StrokeState {
  surface: Surface;
  /** One stroke per symmetry copy, all painting into `surface`. */
  strokes: BrushStroke[];
  copies: ((p: Point) => Point)[];
  bounds: Rect | null;
  start: StrokeSample;
  last: ToolPointerEvent;
  /** Where the brush is (it trails the pointer when stabilised). */
  pen: Point;
  /** The latest pointer sample (the stabiliser catches up to it at the end). */
  latest: StrokeSample;
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
 * as one undo step (so flow builds up within the stroke, under the stroke's opacity). Strokes
 * are repeated for symmetry and can be stabilised.
 */
export function createBrushTool(cfg: BrushToolConfig): Tool {
  let st: StrokeState | null = null;
  let movingCenter = false;

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
    const settings = brush.pressure
      ? brush.settings
      : { ...brush.settings, dynamics: Object.fromEntries(Object.entries(brush.settings.dynamics).filter(([, d]) => d?.source !== 'pressure')) };
    return new BrushStroke({
      settings,
      size: brush.size,
      color,
      seed,
      pickColor: layer
        ? (x, y, r) => {
            // Average a few pixels around the dab (wet paint picks up what it touches).
            const acc = { r: 0, g: 0, b: 0, a: 0 };
            const spots: [number, number][] = [
              [0, 0],
              [-r, 0],
              [r, 0],
              [0, -r],
              [0, r],
            ];
            for (const [ox, oy] of spots) {
              const c = layer.surface.getPixel(Math.floor(x + ox), Math.floor(y + oy));
              acc.r += c.r;
              acc.g += c.g;
              acc.b += c.b;
              acc.a += c.a;
            }
            return { r: acc.r / spots.length, g: acc.g / spots.length, b: acc.b / spots.length, a: acc.a / spots.length };
          }
        : undefined,
      emit: (d) => {
        const touched = paintDabInto(surface, d, shape);
        if (touched && st) st.bounds = rectUnion(st.bounds, touched);
        return touched;
      },
    });
  };

  /** Strokes for every symmetry copy (same seed, so mirrored copies match). */
  const strokesFor = (ctx: ToolContext, surface: Surface, brush: ToolBrush, color: RGBA, seed: number) =>
    symmetryCopies(ctx.symmetry, ctx.doc.width, ctx.doc.height).map(() => newStroke(ctx, surface, brush, color, seed));

  const at = (p: StrokeSample, f: (q: Point) => Point): StrokeSample => ({ ...p, ...f(p) });

  const begin = (s: StrokeState, p: StrokeSample): Rect | null => {
    let dirty: Rect | null = null;
    s.strokes.forEach((k, i) => (dirty = rectUnion(dirty, k.begin(at(p, s.copies[i])))));
    return dirty;
  };

  const to = (s: StrokeState, p: StrokeSample): Rect | null => {
    let dirty: Rect | null = null;
    s.strokes.forEach((k, i) => (dirty = rectUnion(dirty, k.to(at(p, s.copies[i])))));
    return dirty;
  };

  const stopTimer = () => {
    if (st?.timer != null) window.clearInterval(st.timer);
    if (st) st.timer = null;
  };

  const nearCenter = (ctx: ToolContext, e: ToolPointerEvent) => {
    if (ctx.symmetry.mode === 'off') return false;
    const c = symmetryCenter(ctx.symmetry, ctx.doc.width, ctx.doc.height);
    const sc = ctx.view.toScreen(c.x, c.y);
    return Math.hypot(sc.x - e.sx, sc.y - e.sy) <= CENTER_GRAB;
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
    symmetry: true,
    cursor: (ctx) => cfg.cursor(ctx),

    pointerDown(ctx, e) {
      ctx.commitLive();
      if (nearCenter(ctx, e)) {
        // Dragging the symmetry centre, not painting.
        movingCenter = true;
        return;
      }
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
      // The strokes report what they paint through st, so st is set before the first dab.
      const strokes = strokesFor(ctx, surface, brush, color, strokeSeed(e.x, e.y));
      st = {
        surface,
        strokes,
        copies: symmetryCopies(ctx.symmetry, doc.width, doc.height),
        bounds: null,
        start,
        last: e,
        pen: { x: e.x, y: e.y },
        latest: start,
        speed: 0,
        moved: false,
        color,
        brush,
        filter,
        straight: false,
        timer: null,
      };
      ctx.addLayerFilter(filter);
      ctx.syncActiveLayer(begin(st, start));
      if (brush.settings.airbrush) {
        // Holding still keeps spraying (at most every 30 ms).
        st.timer = window.setInterval(() => {
          const s = st;
          if (!s || s.straight) return;
          if (s.moved) {
            s.moved = false;
            return;
          }
          let dirty: Rect | null = null;
          for (const k of s.strokes) dirty = rectUnion(dirty, k.hold());
          if (dirty) ctx.syncActiveLayer(dirty);
        }, 30);
      }
    },

    pointerMove(ctx, e) {
      if (movingCenter) {
        ctx.setSymmetry({ center: { x: Math.min(ctx.doc.width, Math.max(0, e.x)), y: Math.min(ctx.doc.height, Math.max(0, e.y)) } });
        return;
      }
      const s = st;
      if (!s) return;
      // Speed in screen px per ms, smoothed, as 0–1 (3 px/ms counts as fast).
      const dt = e.timeStamp - s.last.timeStamp;
      if (dt > 0) s.speed = s.speed * 0.7 + 0.3 * Math.min(1, Math.hypot(e.sx - s.last.sx, e.sy - s.last.sy) / dt / 3);
      s.moved = true;
      s.last = e;
      const sample = sampleOf(e, s.speed, s.brush.pressure);
      s.latest = sample;
      if (e.shift) {
        // Shift: a straight line from where the stroke started, redrawn as the pointer moves.
        const old = s.bounds;
        s.surface = new Surface(ctx.doc.width, ctx.doc.height);
        s.bounds = null;
        s.straight = true;
        s.strokes = strokesFor(ctx, s.surface, s.brush, s.color, strokeSeed(s.start.x, s.start.y));
        begin(s, s.start);
        to(s, sample);
        ctx.syncActiveLayer(rectUnion(old, s.bounds));
        return;
      }
      if (s.straight) return;
      let p = sample;
      if (s.brush.smoothing > 0) {
        // The stabiliser: the brush only moves once the pointer pulls its string tight.
        const pen = stabilize(s.pen, sample, (s.brush.smoothing * MAX_STRING) / ctx.view.zoom);
        if (pen === s.pen) {
          ctx.invalidateOverlay();
          return;
        }
        s.pen = pen;
        p = { ...sample, x: pen.x, y: pen.y };
      }
      const dirty = to(s, p);
      ctx.invalidateOverlay();
      if (dirty) ctx.syncActiveLayer(dirty);
    },

    pointerUp(ctx) {
      if (movingCenter) {
        movingCenter = false;
        return;
      }
      stopTimer();
      const s = st;
      if (!s) return;
      // A stabilised stroke still ends where the pointer was let go.
      if (s.brush.smoothing > 0 && !s.straight) {
        const dirty = to(s, s.latest);
        if (dirty) ctx.syncActiveLayer(dirty);
      }
      st = null;
      ctx.removeLayerFilter(s.filter);
      ctx.invalidateOverlay();
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
      movingCenter = false;
    },

    hover(ctx, e) {
      ctx.setCursor(nearCenter(ctx, e) ? 'move' : cfg.cursor(ctx));
      ctx.invalidateOverlay();
    },

    drawOverlay(ctx, ov, hover) {
      const sym = ctx.symmetry;
      if (sym.mode !== 'off') {
        for (const [a, b] of symmetryAxes(sym, ctx.doc.width, ctx.doc.height)) ov.line(ov.toScreen(a), ov.toScreen(b), true);
        ov.handle(ov.toScreen(symmetryCenter(sym, ctx.doc.width, ctx.doc.height)), 'circle', movingCenter);
      }
      const s = st;
      if (s && s.brush.smoothing > 0 && !s.straight) ov.line(ov.toScreen(s.pen), ov.toScreen(s.latest), true);
      if (hover && cfg.overlay) cfg.overlay(ctx, ov, hover);
    },
  };
}
