import { dragBox, rectUnion, type Point } from '../core/geometry';
import { boxFromRect } from '../live/BoxGeom';
import { ShapeObject, type FillMode, type ShapeKind, type ShapeStyle } from '../live/ShapeObject';
import type { I18nKey } from '../../i18n';
import type { OptionSpec, Tool, ToolContext, ToolPointerEvent } from './Tool';

/** Draw shapes into the layer's pixels, or as editable objects on a shape layer. */
export const DRAW_AS_OPTION: OptionSpec = {
  key: 'drawAs',
  type: 'segmented',
  labelKey: 'opt.drawAs',
  default: 'pixels',
  iconsOnly: true,
  choices: [
    { value: 'pixels', labelKey: 'opt.drawAs.pixels', icon: 'pixel-grid' },
    { value: 'shape', labelKey: 'opt.drawAs.shape', icon: 'shapes' },
  ],
};

export const FILL_MODE_OPTION: OptionSpec = {
  key: 'mode',
  type: 'segmented',
  labelKey: 'opt.fillMode',
  default: 'outline',
  iconsOnly: false,
  choices: [
    { value: 'outline', labelKey: 'opt.fillMode.outline', icon: 'fill-outline' },
    { value: 'fill', labelKey: 'opt.fillMode.fill', icon: 'fill-solid' },
    { value: 'both', labelKey: 'opt.fillMode.both', icon: 'fill-both' },
  ],
};

export const WIDTH_OPTION: OptionSpec = {
  key: 'width',
  type: 'slider',
  labelKey: 'opt.width',
  min: 1,
  max: 100,
  step: 1,
  unit: 'px',
  default: 3,
  presets: [1, 3, 5, 8],
};

export const ANTIALIAS_OPTION: OptionSpec = {
  key: 'antialias',
  type: 'toggle',
  labelKey: 'opt.antialias',
  default: true,
};

export const SHAPE_COLORS_HINT: OptionSpec = { key: 'colorsHint', type: 'hint', labelKey: 'opt.shapeColors' };

/** Current style from tool options and colours (right-button drawing swaps the colours). */
export function shapeStyle(ctx: ToolContext, toolId: string, swapped: boolean): ShapeStyle {
  const o = ctx.options(toolId);
  const a = swapped ? ctx.secondary : ctx.primary;
  const b = swapped ? ctx.primary : ctx.secondary;
  return {
    mode: (o.mode as FillMode | undefined) ?? 'outline',
    width: Number(o.width ?? 3),
    outline: a,
    fill: b,
    radius: Number(o.radius ?? 0),
    antialias: o.antialias !== false,
  };
}

export function liveShape(ctx: ToolContext): ShapeObject | null {
  const l = ctx.live;
  return l && l.kind === 'shape' ? (l as ShapeObject) : null;
}

/** Pixel-centre snapping keeps odd-width outlines crisp. */
export function snapCenter(e: { x: number; y: number }): Point {
  return { x: Math.floor(e.x) + 0.5, y: Math.floor(e.y) + 0.5 };
}

export function snapCorner(e: { x: number; y: number }): Point {
  return { x: Math.round(e.x), y: Math.round(e.y) };
}

/** Shared editing behaviour: drag handles of the live shape. Returns true if handled. */
export function beginShapeEdit(ctx: ToolContext, e: ToolPointerEvent): boolean {
  const live = liveShape(ctx);
  if (!live) return false;
  const hit = live.hit({ x: e.x, y: e.y }, { x: e.sx, y: e.sy }, (q) => ctx.view.toScreen(q.x, q.y), ctx.view.zoom);
  if (!hit) return false;
  live.beginDrag(hit, { x: e.x, y: e.y }, ctx.view.zoom);
  return true;
}

export function dragShapeEdit(ctx: ToolContext, e: ToolPointerEvent): boolean {
  const live = liveShape(ctx);
  if (!live || !live.dragging) return false;
  const before = live.bounds();
  const info = live.dragInfo;
  let p = { x: e.x, y: e.y };
  if (info?.body && info.bounds) {
    // Moving: line the shape's edges or centre up with the snap targets.
    const c = ctx.snapMove({ ...info.bounds, x: info.bounds.x + p.x - info.at.x, y: info.bounds.y + p.y - info.at.y });
    p = { x: p.x + c.x, y: p.y + c.y };
  } else if (info && !info.rotate) p = ctx.snapPoint(p);
  live.drag(p, { shift: e.shift, alt: e.alt });
  ctx.invalidate(rectUnion(before, live.bounds()));
  return true;
}

export function endShapeEdit(ctx: ToolContext): boolean {
  const live = liveShape(ctx);
  if (!live || !live.dragging) return false;
  live.endDrag();
  return true;
}

export function restyleLive(ctx: ToolContext, toolId: string, swapped: boolean): void {
  const live = liveShape(ctx);
  if (!live) return;
  const before = live.bounds();
  live.setStyle(shapeStyle(ctx, toolId, swapped));
  ctx.invalidate(rectUnion(before, live.bounds()));
}

export function hoverCursor(ctx: ToolContext, e: ToolPointerEvent): void {
  const live = liveShape(ctx);
  const hit = live?.hit({ x: e.x, y: e.y }, { x: e.sx, y: e.sy }, (q) => ctx.view.toScreen(q.x, q.y), ctx.view.zoom) ?? null;
  ctx.setCursor(live?.cursorFor(hit) ?? 'crosshair');
}

export function shapeKeys(ctx: ToolContext, e: KeyboardEvent): boolean {
  if (!liveShape(ctx)) return false;
  if (e.key === 'Enter') {
    ctx.commitLive();
    return true;
  }
  if (e.key === 'Escape') {
    ctx.cancelLive();
    return true;
  }
  return false;
}

interface BoxShapeConfig {
  id: string;
  kind: Extract<ShapeKind, 'rect' | 'roundRect' | 'ellipse' | 'parametric'>;
  labelKey: I18nKey;
  hintKey: I18nKey;
  icon: string;
  shortcut: string;
  order: number;
  extraOptions?: OptionSpec[];
  /** Options shown before the drawing options (the library shape picker). */
  leadOptions?: OptionSpec[];
  /** Library shape to draw (parametric tools). */
  library?: (ctx: ToolContext) => { shapeId: string; params: Record<string, number> };
}

/** Rectangle, rounded rectangle and ellipse: drag a box, then adjust with handles. */
export function createBoxShapeTool(cfg: BoxShapeConfig): Tool {
  let creating: { start: Point } | null = null;
  let swapped = false;

  return {
    id: cfg.id,
    labelKey: cfg.labelKey,
    hintKey: cfg.hintKey,
    icon: cfg.icon,
    shortcut: cfg.shortcut,
    group: 'shapes',
    order: cfg.order,
    paints: true,
    options: [...(cfg.leadOptions ?? []), DRAW_AS_OPTION, FILL_MODE_OPTION, WIDTH_OPTION, ...(cfg.extraOptions ?? []), ANTIALIAS_OPTION, SHAPE_COLORS_HINT],
    cursor: () => 'crosshair',

    pointerDown(ctx, e) {
      if (beginShapeEdit(ctx, e)) return;
      ctx.commitLive();
      if (!ctx.canPaint()) return;
      swapped = e.button === 2;
      creating = { start: ctx.snapPoint(snapCorner(e)) };
    },

    pointerMove(ctx, e) {
      if (dragShapeEdit(ctx, e)) return;
      if (!creating) return;
      const r = dragBox(creating.start, ctx.snapPoint(snapCorner(e)), e.shift, e.alt);
      if (r.w < 1 && r.h < 1) return;
      const live = liveShape(ctx);
      if (!live) {
        const doc = ctx.doc;
        ctx.setLive(new ShapeObject(cfg.kind, shapeStyle(ctx, cfg.id, swapped), doc.width, doc.height, { box: boxFromRect(r), ...cfg.library?.(ctx) }));
        ctx.setHint('opt.liveHint');
        return;
      }
      const before = live.bounds();
      live.box = boxFromRect(r);
      live.update();
      ctx.invalidate(rectUnion(before, live.bounds()));
    },

    pointerUp(ctx) {
      endShapeEdit(ctx);
      creating = null;
    },

    hover: hoverCursor,
    keyDown: shapeKeys,
    optionsChanged: (ctx) => {
      restyleLive(ctx, cfg.id, swapped);
      // A shape still being placed follows the gallery and the sliders.
      const live = liveShape(ctx);
      if (live && cfg.library && live.shape === 'parametric' && !live.vectorEdit) {
        const before = live.bounds();
        const { shapeId, params } = cfg.library(ctx);
        live.setShape(shapeId, params);
        ctx.invalidate(rectUnion(before, live.bounds()));
      }
    },
    colorsChanged: (ctx) => restyleLive(ctx, cfg.id, swapped),
    deactivate: () => {
      creating = null;
    },
  };
}
