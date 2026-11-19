import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Point, type Rect } from '../core/geometry';
import { BrushStroke, strokeSeed, type StrokeSample } from '../brush/BrushStroke';
import { dabShapeOf, paintDabInto, type Dab, type DabShape } from '../brush/dab';
import { isFlatNib, nibAngleOf, nibEnds } from '../brush/nib';
import type { DabOp } from '../brush/retouch';
import { stabilize, symmetryAxes, symmetryCenter, symmetryCopies } from '../brush/symmetry';
import type { BrushSettings } from '../brush/types';
import { RasterLayer } from '../doc/Document';
import type { Piece } from '../anim/piece';
import { piecePaintMap, type PiecePaintMap } from '../anim/piecePaint';
import { applyImage, type MaskView, type PixelView } from '../raster/pixels';
import { Surface } from '../raster/Surface';
import type { Overlay } from '../render/Overlay';
import type { I18nKey } from '../../i18n';
import type { OptionSpec, Tool, ToolContext, ToolGroup, ToolOptions, ToolPointerEvent } from './Tool';
import { brushRegistry, type BrushDef } from '../brush/BrushRegistry';
import '../brush/library';

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

/**
 * Tools that change the layer's pixels dab by dab (smudge, blur, clone…) instead of laying a
 * stroke over them. `begin` gives the operation for one symmetry copy of a stroke (null to
 * refuse the stroke, e.g. a clone with no source yet).
 */
export interface DirectPaint {
  /**
   * `layer` holds the pixels painted (a stand-in holding a piece's own pixels when painting on a
   * piece), `start` is in those pixels, and `toTarget` carries a canvas point into them.
   */
  begin(ctx: ToolContext, s: { layer: RasterLayer; start: Point; shape: DabShape; clip: MaskView | null; copy: number; toTarget: (p: Point) => Point }): DabOp | null;
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
  /** Paint laid over the layer, or paint that removes it (ignored by direct tools). */
  op: 'over' | 'erase';
  options: OptionSpec[];
  cursor: (ctx: ToolContext) => string;
  brush: (ctx: ToolContext) => ToolBrush;
  overlay?: (ctx: ToolContext, ov: Overlay, hover: Point) => void;
  direct?: DirectPaint;
  /** Alt+click (the clone stamp picks its source); return true if handled. */
  altClick?: (ctx: ToolContext, e: ToolPointerEvent) => boolean;
}

/** The stabiliser slider: smooths strokes by trailing the pointer (0–100 %). */
export const SMOOTHING_OPTION: OptionSpec = { key: 'smoothing', advanced: true, type: 'slider', labelKey: 'opt.smoothing', min: 0, max: 100, step: 1, unit: '%', default: 0 };

/** Which brush a brush tool paints with. */
export const BRUSH_OPTION = (def: string): OptionSpec => ({ key: 'brushId', type: 'brush', labelKey: 'opt.brush', default: def });

/** The brush a tool's options name (or the fallback when it's gone, e.g. a deleted personal brush). */
export function brushOf(o: ToolOptions, fallback: string): BrushDef {
  return brushRegistry.get(String(o.brushId ?? '')) ?? brushRegistry.get(fallback)!;
}

/** Picking a brush loads its size, opacity, flow, hardness and (flat nibs) angle into the tool's sliders. */
export function brushOptionsFor(def: BrushDef): ToolOptions {
  const s = def.settings;
  const nib = isFlatNib(s) ? { nibAngle: nibAngleOf(s) } : {};
  return { brushId: def.id, size: Math.max(1, Math.round(s.size)), opacity: Math.round(s.opacity * 100), flow: Math.round(s.flow * 100), hardness: Math.round(s.hardness * 100), ...nib };
}

/**
 * The brush's outline under the pointer: a circle, or a line across a flat nib at its angle.
 * Painting on a piece, it's the brush as it lands on the piece, seen through its transform (a
 * stretched or skewed piece turns the circle into an ellipse).
 */
export function drawBrushCursor(ctx: ToolContext, ov: Overlay, hover: Point, settings: BrushSettings, size: number): void {
  const piece = ctx.anim.paintTarget;
  const map = piece ? piecePaintMap(piece, ctx.anim.scene(), hover) : null;
  const c = map?.toPiece(hover);
  if (map && c) {
    const s = forPiece({ settings, size, opacity: 1, pressure: false, smoothing: 0 }, map);
    const toScreen = (p: Point): Point | null => {
      const d = map.toDoc(p);
      return d && ov.toScreen(d);
    };
    if (isFlatNib(s.settings)) {
      const [a, b] = nibEnds(c, s.size, s.settings.angle).map(toScreen);
      if (a && b) ov.nibCursor(a, b);
      return;
    }
    const r = Math.max(0.5, s.size / 2);
    const pts: Point[] = [];
    for (let i = 0; i < 48; i++) {
      const p = toScreen({ x: c.x + r * Math.cos((i / 48) * Math.PI * 2), y: c.y + r * Math.sin((i / 48) * Math.PI * 2) });
      if (p) pts.push(p);
    }
    ov.shapeCursor(pts);
    return;
  }
  if (isFlatNib(settings)) {
    const [a, b] = nibEnds(hover, size, settings.angle);
    ov.nibCursor(ov.toScreen(a), ov.toScreen(b));
  } else ov.brushCursor(ov.toScreen(hover), (size / 2) * ctx.view.zoom);
}

/**
 * A brush as it paints on a piece: as wide on the canvas as it is set to be (so smaller in a
 * piece that's scaled up), and a fixed nib angle kept as it looks on the canvas.
 */
export function forPiece(b: ToolBrush, map: PiecePaintMap): ToolBrush {
  const DEG = 180 / Math.PI;
  const settings = b.settings.followStroke ? b.settings : { ...b.settings, angle: map.angle(b.settings.angle / DEG) * DEG };
  return { ...b, size: b.size / map.scale, settings };
}

/** The longest the stabiliser's string gets, in screen px. */
const MAX_STRING = 80;

/** Composite a stroke surface onto a pixel view (the live preview). */
export function compositeStroke(dst: PixelView, r: Rect, stroke: Surface, op: 'over' | 'erase', opacity: number, clip: MaskView | null): void {
  stroke.forEachTile(r, (sv, sub) => applyImage(dst, sub, sv, op, opacity, clip), false, true);
}

/** Symmetry centre handles are this close (screen px) to be grabbed. */
const CENTER_GRAB = 9;

interface StrokeState {
  /** Stroke-layer tools paint here; direct tools paint straight into the layer. */
  surface: Surface | null;
  layer: RasterLayer;
  /** Painting on a piece (Paint on piece): `layer` stands in for its own pixels, mapped by `map`. */
  piece: Piece | null;
  map: PiecePaintMap | null;
  /** A stroke-layer stroke on a piece: its pixels as they were, to show the stroke over them live. */
  orig: Surface | null;
  /** One stroke per symmetry copy. */
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
  clip: MaskView | null;
  filter: ((view: PixelView, r: Rect) => void) | null;
  straight: boolean;
  timer: number | null;
}

/**
 * Brush, Pencil, Eraser and the retouching tools. Dabs from the brush engine either go into a
 * stroke layer of their own (shown live over the active layer through a display filter, then
 * composited as one undo step, so flow builds up under the stroke's opacity) or, for direct
 * tools, change the layer's pixels as they're placed (recorded as one undo step). Strokes are
 * repeated for symmetry and can be stabilised.
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

  const newStroke = (layer: RasterLayer, brush: ToolBrush, color: RGBA, seed: number, emit: (d: Dab) => Rect | null): BrushStroke => {
    const settings = brush.pressure
      ? brush.settings
      : { ...brush.settings, dynamics: Object.fromEntries(Object.entries(brush.settings.dynamics).filter(([, d]) => d?.source !== 'pressure')) };
    return new BrushStroke({
      settings,
      size: brush.size,
      color,
      seed,
      pickColor: (x, y, r) => {
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
      },
      emit: (d) => {
        const touched = emit(d);
        if (touched && st) st.bounds = rectUnion(st.bounds, touched);
        return touched;
      },
    });
  };

  /** Symmetry copies of a canvas point, carried into the pixels painted (a piece's own, when painting on one). */
  const copiesFor = (ctx: ToolContext, map: PiecePaintMap | null): ((p: Point) => Point)[] => {
    const copies = symmetryCopies(ctx.symmetry, ctx.doc.width, ctx.doc.height);
    if (!map) return copies;
    // Where the sheet isn't (past its horizon), a copy holds at the last place it was.
    return copies.map((f) => {
      let last: Point | null = null;
      return (p: Point): Point => {
        const q = map.toPiece(f(p));
        if (q) last = q;
        return q ?? last ?? { x: Number.NaN, y: Number.NaN };
      };
    });
  };

  /**
   * Strokes for every symmetry copy (same seed, so mirrored copies match). Null when a direct
   * tool refuses to start. On a repeating piece every dab is folded onto its tile.
   */
  const strokesFor = (ctx: ToolContext, s: Pick<StrokeState, 'surface' | 'layer' | 'brush' | 'color' | 'clip' | 'map'>, start: Point, seed: number): BrushStroke[] | null => {
    const copies = copiesFor(ctx, s.map);
    const shape = dabShapeOf(s.brush.settings);
    const map = s.map;
    const fold = (emit: (d: Dab) => Rect | null) =>
      map
        ? (d: Dab): Rect | null => {
            let r: Rect | null = null;
            for (const q of map.fold(d)) r = rectUnion(r, emit(q));
            return r;
          }
        : emit;
    if (cfg.direct) {
      const ops: DabOp[] = [];
      const toTarget = map ? (p: Point) => map.toPiece(p) ?? p : (p: Point) => p;
      for (let i = 0; i < copies.length; i++) {
        const op = cfg.direct.begin(ctx, { layer: s.layer, start: copies[i](start), shape, clip: s.clip, copy: i, toTarget });
        if (!op) return null;
        ops.push(op);
      }
      return ops.map((op) => newStroke(s.layer, s.brush, s.color, seed, fold(op)));
    }
    const surface = s.surface!;
    return copies.map(() => newStroke(s.layer, s.brush, s.color, seed, fold((d) => paintDabInto(surface, d, shape))));
  };

  /**
   * Show what a stroke changed inside r (in the pixels painted). On a layer, re-upload it (a
   * stroke-layer stroke shows through its display filter). On a piece, a stroke-layer stroke is
   * laid over the piece's pixels as they were, right there, so the piece shows it everywhere it's drawn.
   */
  const show = (ctx: ToolContext, s: StrokeState, r: Rect | null): void => {
    if (!r) return;
    if (!s.piece) {
      ctx.syncActiveLayer(r);
      return;
    }
    const src = s.piece.src;
    const area = rectIntersect(r, src.bounds);
    if (!area) return;
    if (s.orig && s.surface) {
      src.writeRect(area, { data: s.orig.readRect(area), stride: area.w, ox: area.x, oy: area.y });
      s.surface.forEachTile(area, (sv, sub) => src.compositeImage(sub, sv, cfg.op, s.brush.opacity, null), false, true);
    }
    ctx.pieceChanged(s.piece, area);
  };

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
    paintsPieces: true,
    symmetry: true,
    strokeBrush: cfg.direct
      ? undefined
      : (ctx) => {
          const b = cfg.brush(ctx);
          return { settings: b.settings, size: b.size, opacity: b.opacity, op: cfg.op };
        },
    cursor: (ctx) => cfg.cursor(ctx),

    pointerDown(ctx, e) {
      ctx.commitLive();
      if (nearCenter(ctx, e)) {
        // Dragging the symmetry centre, not painting.
        movingCenter = true;
        return;
      }
      if (e.alt && cfg.altClick?.(ctx, e)) return;
      const doc = ctx.doc;
      // Paint on piece: the selected piece's own pixels, through its transform at this frame.
      const piece = ctx.anim.paintTarget;
      let layer: RasterLayer;
      let map: PiecePaintMap | null = null;
      if (piece) {
        if (!ctx.anim.canPaint(piece)) return;
        // Nothing is painted where the sheet is seen edge-on, or where the pointer isn't on its plane.
        map = piecePaintMap(piece, ctx.anim.scene(), { x: e.x, y: e.y });
        if (!map || !map.toPiece({ x: e.x, y: e.y })) return;
        // Stands in for a layer, so strokes and retouching read and write the piece's pixels.
        layer = new RasterLayer('', piece.src);
      } else {
        if (!ctx.canPaint()) return;
        const active = doc.activeRaster;
        if (!active) return;
        layer = active;
      }
      const brush = map ? forPiece(cfg.brush(ctx), map) : cfg.brush(ctx);
      const color = e.button === 2 ? ctx.secondary : ctx.primary;
      // Painting on a piece ignores the selection (it's drawn on the canvas, not on the piece).
      const clip = piece ? null : (doc.selection?.maskView() ?? null);
      const start = sampleOf(e, 0, brush.pressure);
      const surface = cfg.direct ? null : new Surface(layer.surface.width, layer.surface.height);
      const orig = piece && !cfg.direct ? piece.src.snapshot() : null;
      const base = { surface, layer, brush, color, clip, map };
      // A piece shows the stroke in its own pixels as it goes, so they're edited from the start.
      if (cfg.direct || piece) layer.surface.beginEdit();
      const strokes = strokesFor(ctx, base, start, strokeSeed(e.x, e.y));
      if (!strokes) {
        layer.surface.abortEdit();
        return;
      }
      const filter =
        cfg.direct || piece
          ? null
          : (view: PixelView, r: Rect) => {
              const s = st;
              const area = s?.bounds ? rectIntersect(r, s.bounds) : null;
              if (s?.surface && area) compositeStroke(view, area, s.surface, cfg.op, s.brush.opacity, clip);
            };
      // The strokes report what they paint through st, so st is set before the first dab.
      st = {
        ...base,
        piece,
        orig,
        strokes,
        copies: copiesFor(ctx, map),
        bounds: null,
        start,
        last: e,
        pen: { x: e.x, y: e.y },
        latest: start,
        speed: 0,
        moved: false,
        filter,
        straight: false,
        timer: null,
      };
      if (filter) ctx.addLayerFilter(filter);
      show(ctx, st, begin(st, start));
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
          show(ctx, s, dirty);
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
        if (cfg.direct) {
          // Direct tools changed the layer: put it back before drawing the line again.
          s.layer.surface.abortEdit();
          s.layer.surface.beginEdit();
        } else s.surface = new Surface(s.layer.surface.width, s.layer.surface.height);
        s.bounds = null;
        s.straight = true;
        const strokes = strokesFor(ctx, s, s.start, strokeSeed(s.start.x, s.start.y));
        if (!strokes) return;
        s.strokes = strokes;
        begin(s, s.start);
        to(s, sample);
        show(ctx, s, rectUnion(old, s.bounds));
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
      show(ctx, s, dirty);
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
      if (s.brush.smoothing > 0 && !s.straight) show(ctx, s, to(s, s.latest));
      st = null;
      if (s.filter) ctx.removeLayerFilter(s.filter);
      ctx.invalidateOverlay();
      const b = s.bounds;
      const surf = s.layer.surface;
      if (s.piece) {
        // The piece already shows the stroke in its own pixels: record it.
        ctx.pushPiecePixels(cfg.historyLabel, s.piece, surf.endEdit());
        ctx.pieceChanged(s.piece, b);
        return;
      }
      if (cfg.direct) {
        // The layer already shows the stroke: record it.
        const delta = surf.endEdit();
        if (delta) ctx.pushPixels(cfg.historyLabel, s.layer, delta);
        if (b) ctx.syncActiveLayer(b);
        return;
      }
      if (!b || !s.surface) return;
      const stroke = s.surface;
      surf.beginEdit();
      // Only the layer tiles the stroke painted are touched.
      stroke.forEachTile(b, (sv, sub) => surf.compositeImage(sub, sv, cfg.op, s.brush.opacity, s.clip), false, true);
      ctx.pushPixels(cfg.historyLabel, s.layer, surf.endEdit());
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
