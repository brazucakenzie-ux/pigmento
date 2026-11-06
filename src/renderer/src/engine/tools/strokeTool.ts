import type { RGBA } from '../core/color';
import { rectIntersect, rectUnion, type Point, type Rect } from '../core/geometry';
import { applyColorMask, type PixelOp, type PixelView } from '../raster/pixels';
import { DabSpacer, StrokeBuffer } from '../raster/stroke';
import type { Overlay } from '../render/Overlay';
import type { I18nKey } from '../../i18n';
import type { OptionSpec, Tool, ToolContext, ToolGroup, ToolPointerEvent } from './Tool';

let cached: StrokeBuffer | null = null;

/** One reusable document-sized coverage buffer (cleared region-by-region between strokes). */
export function sharedStrokeBuffer(w: number, h: number): StrokeBuffer {
  if (!cached || cached.w !== w || cached.h !== h) cached = new StrokeBuffer(w, h);
  return cached;
}

export interface StrokeToolConfig {
  id: string;
  labelKey: I18nKey;
  hintKey: I18nKey;
  icon: string;
  shortcut: string;
  group: ToolGroup;
  order: number;
  historyLabel: I18nKey;
  op: PixelOp;
  options: OptionSpec[];
  cursor: (ctx: ToolContext) => string;
  /** Read size/opacity/etc. from options. */
  params: (o: Record<string, unknown>) => {
    size: number;
    opacity: number;
    /** Square aliased stamps (pencil, classic eraser) vs round dabs. */
    square: boolean;
    hardness: number;
    pressureSize: boolean;
  };
  overlay?: (ctx: ToolContext, ov: Overlay, hover: Point | null) => void;
}

interface StrokeState {
  buffer: StrokeBuffer;
  color: RGBA;
  opacity: number;
  start: ToolPointerEvent;
  last: ToolPointerEvent;
  spacer: DabSpacer | null;
  filter: (view: PixelView, r: Rect) => void;
  straight: boolean;
}

/**
 * Pencil, brush and eraser share this: input is stamped into a coverage buffer that is
 * previewed through a layer display filter, then composited into the layer as one step.
 */
export function createStrokeTool(cfg: StrokeToolConfig): Tool {
  let st: StrokeState | null = null;

  const stamp = (ctx: ToolContext, a: ToolPointerEvent, b: ToolPointerEvent): Rect | null => {
    if (!st) return null;
    const p = cfg.params(ctx.options(cfg.id));
    if (p.square) return st.buffer.lineSquare(a.x, a.y, b.x, b.y, p.size);
    return st.spacer ? st.spacer.to({ x: b.x, y: b.y, pressure: b.pressure }) : null;
  };

  const beginSpacer = (ctx: ToolContext, buffer: StrokeBuffer): DabSpacer => {
    const p = cfg.params(ctx.options(cfg.id));
    const radiusFor = (pressure: number) => (p.size / 2) * (p.pressureSize ? Math.max(0.08, pressure) : 1);
    return new DabSpacer(
      (q) => Math.max(0.5, radiusFor(q.pressure) * 2 * 0.12),
      (q) => buffer.stampDab(q.x, q.y, radiusFor(q.pressure), p.hardness),
    );
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
      const buffer = sharedStrokeBuffer(doc.width, doc.height);
      buffer.reset();
      const p = cfg.params(ctx.options(cfg.id));
      const color = e.button === 2 ? ctx.secondary : ctx.primary;
      const clip = doc.selection?.maskView() ?? null;
      const filter = (view: PixelView, r: Rect) => {
        const b = buffer.bounds;
        const area = b ? rectIntersect(r, b) : null;
        if (area) applyColorMask(view, area, color, buffer.view(), cfg.op, p.opacity, clip);
      };
      st = { buffer, color, opacity: p.opacity, start: e, last: e, spacer: null, filter, straight: false };
      ctx.addLayerFilter(filter);
      let dirty: Rect | null;
      if (p.square) dirty = buffer.stampSquare(e.x, e.y, p.size);
      else {
        st.spacer = beginSpacer(ctx, buffer);
        dirty = st.spacer.begin({ x: e.x, y: e.y, pressure: e.pressure });
      }
      ctx.syncActiveLayer(dirty);
    },

    pointerMove(ctx, e) {
      if (!st) return;
      if (e.shift) {
        // Shift: straight line from where the stroke started.
        const old = st.buffer.bounds;
        st.buffer.reset();
        st.straight = true;
        let dirty: Rect | null;
        if (cfg.params(ctx.options(cfg.id)).square) {
          dirty = st.buffer.lineSquare(st.start.x, st.start.y, e.x, e.y, cfg.params(ctx.options(cfg.id)).size);
        } else {
          st.spacer = beginSpacer(ctx, st.buffer);
          st.spacer.begin({ x: st.start.x, y: st.start.y, pressure: st.start.pressure });
          dirty = st.spacer.to({ x: e.x, y: e.y, pressure: e.pressure });
          dirty = rectUnion(dirty, st.buffer.bounds);
        }
        ctx.syncActiveLayer(rectUnion(old, dirty));
        st.last = e;
        return;
      }
      if (st.straight) return;
      const dirty = stamp(ctx, st.last, e);
      st.last = e;
      if (dirty) ctx.syncActiveLayer(dirty);
    },

    pointerUp(ctx) {
      const s = st;
      st = null;
      if (!s) return;
      ctx.removeLayerFilter(s.filter);
      const b = s.buffer.bounds;
      const layer = ctx.doc.activeRaster;
      if (!b || !layer) {
        s.buffer.reset();
        return;
      }
      const surf = layer.surface;
      surf.beginEdit();
      surf.compositeColor(b, s.color, s.buffer.view(), cfg.op, s.opacity, ctx.doc.selection?.maskView() ?? null);
      ctx.pushPixels(cfg.historyLabel, layer, surf.endEdit());
      s.buffer.reset();
      ctx.syncActiveLayer(b);
    },

    hover(ctx) {
      ctx.invalidateOverlay();
    },

    drawOverlay(ctx, ov, hover) {
      if (hover && cfg.overlay) cfg.overlay(ctx, ov, hover);
    },
  };
}
