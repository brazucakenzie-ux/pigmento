import { dragBox, rectUnion, type Point } from '../core/geometry';
import { boxFromRect } from '../live/BoxGeom';
import { ShapeObject, type FillMode, type ShapeKind, type ShapeStyle } from '../live/ShapeObject';
import type { I18nKey } from '../../i18n';
import type { SubPaths } from '../vector/pathData';
import type { GradientStopValue, OptionSpec, Tool, ToolContext, ToolOptions, ToolPointerEvent } from './Tool';
import { parseHex, toHex8 } from '../core/color';
import {
  ARROW_HEADS,
  CAP_STYLES,
  DASH_STYLES,
  FILL_KINDS,
  JOIN_STYLES,
  OUTLINE_KINDS,
  SHAPE_GRADIENT_TYPES,
  type CapStyle,
  type JoinStyle,
  type PaintStop,
  type ShapeGradient,
  type ShapeStyleExtras,
} from '../vector/style';

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

const GRADIENT_TYPE_CHOICES = [
  { value: 'linear', labelKey: 'opt.gradientType.linear', icon: 'grad-linear' },
  { value: 'radial', labelKey: 'opt.gradientType.radial', icon: 'grad-radial' },
  { value: 'angular', labelKey: 'opt.gradientType.angular', icon: 'grad-angular' },
] satisfies { value: (typeof SHAPE_GRADIENT_TYPES)[number]; labelKey: I18nKey; icon: string }[];

const is = (key: string, value: string) => (o: Record<string, unknown>) => (o[key] ?? 'solid') === value;
const notMode = (mode: string) => (o: Record<string, unknown>) => o.mode !== mode;

/** Gradient settings for the fill or the outline (keys prefixed with `fill` or `outline`). */
function gradientOptions(prefix: 'fill' | 'outline'): OptionSpec[] {
  const kind = `${prefix}Kind`;
  const grad = is(kind, 'gradient');
  return [
    { key: `${prefix}GradientType`, type: 'segmented', labelKey: 'opt.gradientType', default: 'linear', iconsOnly: true, choices: GRADIENT_TYPE_CHOICES, visibleIf: grad },
    { key: `${prefix}Stops`, type: 'gradient', labelKey: 'opt.gradientColors', default: null, visibleIf: grad },
    {
      key: `${prefix}Angle`,
      type: 'slider',
      labelKey: 'opt.angle',
      min: 0,
      max: 360,
      step: 1,
      unit: '°',
      default: 0,
      visibleIf: (o) => grad(o) && o[`${prefix}GradientType`] !== 'radial',
    },
  ];
}

/** Fill: a colour, a gradient, a pattern or a picture (shown unless only the outline is drawn). */
export const FILL_STYLE_OPTION: OptionSpec = {
  key: 'fillStyle',
  type: 'popover',
  labelKey: 'opt.fillStyle',
  icon: 'fill',
  visibleIf: notMode('outline'),
  summary: (o) => `opt.fillKind.${FILL_KINDS.includes(o.fillKind as never) ? String(o.fillKind) : 'solid'}` as I18nKey,
  options: [
    {
      key: 'fillKind',
      type: 'segmented',
      labelKey: 'opt.fillKind',
      default: 'solid',
      choices: FILL_KINDS.map((k) => ({ value: k, labelKey: `opt.fillKind.${k}` as I18nKey })),
    },
    ...gradientOptions('fill'),
    { key: 'fillPattern', type: 'pattern', labelKey: 'opt.pattern', default: 'checker', visibleIf: is('fillKind', 'pattern') },
    { key: 'fillPatternScale', type: 'slider', labelKey: 'opt.patternScale', min: 1, max: 8, step: 1, unit: '×', default: 1, visibleIf: is('fillKind', 'pattern') },
    { key: 'fillImage', type: 'image', labelKey: 'opt.fillImage', default: '', visibleIf: is('fillKind', 'image') },
  ],
};

const ARROW_CHOICES = ARROW_HEADS.map((a) => ({ value: a, labelKey: `opt.arrow.${a}` as I18nKey }));

/** Outline: colour or gradient, dashes, ends and corners (and arrowheads on lines). */
export function outlineStyleOption(d: { cap: CapStyle; join: JoinStyle; arrows?: boolean | 'ifLines'; corners?: boolean }): OptionSpec {
  // The Move tool shows arrowheads only when the selection has a line or curve.
  const arrowsShown = d.arrows === 'ifLines' ? (o: Record<string, unknown>) => o.hasLines === true : undefined;
  return {
    key: 'outlineStyle',
    type: 'popover',
    labelKey: 'opt.outlineStyle',
    icon: 'pen',
    visibleIf: notMode('fill'),
    summary: (o) => `opt.dash.${DASH_STYLES.includes(o.dash as never) ? String(o.dash) : 'solid'}` as I18nKey,
    options: [
      {
        key: 'outlineKind',
        type: 'segmented',
        labelKey: 'opt.outlineKind',
        default: 'solid',
        choices: OUTLINE_KINDS.map((k) => ({ value: k, labelKey: `opt.fillKind.${k}` as I18nKey })),
      },
      ...gradientOptions('outline'),
      { key: 'dash', type: 'segmented', labelKey: 'opt.dash', default: 'solid', choices: DASH_STYLES.map((k) => ({ value: k, labelKey: `opt.dash.${k}` as I18nKey })) },
      { key: 'cap', type: 'segmented', labelKey: 'opt.cap', default: d.cap, choices: CAP_STYLES.map((k) => ({ value: k, labelKey: `opt.cap.${k}` as I18nKey })) },
      ...(d.corners === false
        ? []
        : [{ key: 'join', type: 'segmented', labelKey: 'opt.join', default: d.join, choices: JOIN_STYLES.map((k) => ({ value: k, labelKey: `opt.join.${k}` as I18nKey })) } as OptionSpec]),
      ...(d.arrows
        ? ([
            { key: 'arrowStart', type: 'segmented', labelKey: 'opt.arrowStart', default: 'none', choices: ARROW_CHOICES, visibleIf: arrowsShown },
            { key: 'arrowEnd', type: 'segmented', labelKey: 'opt.arrowEnd', default: 'none', choices: ARROW_CHOICES, visibleIf: arrowsShown },
          ] as OptionSpec[])
        : []),
    ],
  };
}

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function stopsOf(v: unknown): PaintStop[] | null {
  if (!Array.isArray(v)) return null;
  const stops = (v as GradientStopValue[]).map((s) => ({ pos: Number(s.pos), color: parseHex(String(s.color)) })).filter((s): s is PaintStop => s.color !== null && Number.isFinite(s.pos));
  return stops.length >= 2 ? stops : null;
}

function gradientOf(o: ToolOptions, prefix: 'fill' | 'outline'): ShapeGradient {
  return { type: pick(o[`${prefix}GradientType`], SHAPE_GRADIENT_TYPES, 'linear'), stops: stopsOf(o[`${prefix}Stops`]), angle: Number(o[`${prefix}Angle`] ?? 0) || 0 };
}

/**
 * The fill and outline styles in tool options, as stored on a shape. Only what's in use is
 * kept (a solid fill stores no gradient), so files stay small.
 */
export function styleExtrasOf(o: ToolOptions): ShapeStyleExtras {
  const x: ShapeStyleExtras = {};
  const fillKind = pick(o.fillKind, FILL_KINDS, 'solid');
  if (fillKind !== 'solid') x.fillKind = fillKind;
  if (fillKind === 'gradient') x.fillGradient = gradientOf(o, 'fill');
  if (fillKind === 'pattern') x.fillPattern = { id: String(o.fillPattern ?? 'checker'), scale: Math.max(1, Math.min(8, Math.round(Number(o.fillPatternScale ?? 1)))) };
  if (fillKind === 'image' && typeof o.fillImage === 'string' && o.fillImage) x.fillImage = o.fillImage;
  const outlineKind = pick(o.outlineKind, OUTLINE_KINDS, 'solid');
  if (outlineKind === 'gradient') {
    x.outlineKind = 'gradient';
    x.outlineGradient = gradientOf(o, 'outline');
  }
  const dash = pick(o.dash, DASH_STYLES, 'solid');
  if (dash !== 'solid') x.dash = dash;
  if (o.cap !== undefined) x.cap = pick(o.cap, CAP_STYLES, 'butt');
  if (o.join !== undefined) x.join = pick(o.join, JOIN_STYLES, 'miter');
  const start = pick(o.arrowStart, ARROW_HEADS, 'none');
  const end = pick(o.arrowEnd, ARROW_HEADS, 'none');
  if (start !== 'none') x.arrowStart = start;
  if (end !== 'none') x.arrowEnd = end;
  return x;
}

const stopValues = (stops: PaintStop[] | null): GradientStopValue[] | null => (stops ? stops.map((s) => ({ pos: s.pos, color: toHex8(s.color) })) : null);

/**
 * The other way round: a shape's style as tool option values (the Move tool shows them), with
 * its caps and corners as drawn.
 */
export function optionsOfStyle(s: ShapeStyle, line: { cap: CapStyle; join: JoinStyle }, hasLines = false): ToolOptions {
  const o: ToolOptions = {
    hasLines,
    cap: line.cap,
    join: line.join,
    mode: s.mode,
    width: s.width,
    fillKind: s.fillKind ?? 'solid',
    outlineKind: s.outlineKind ?? 'solid',
    dash: s.dash ?? 'solid',
    arrowStart: s.arrowStart ?? 'none',
    arrowEnd: s.arrowEnd ?? 'none',
  };
  for (const [prefix, g] of [
    ['fill', s.fillGradient],
    ['outline', s.outlineGradient],
  ] as const) {
    if (!g) continue;
    o[`${prefix}GradientType`] = g.type;
    o[`${prefix}Stops`] = stopValues(g.stops);
    o[`${prefix}Angle`] = g.angle;
  }
  if (s.fillPattern) {
    o.fillPattern = s.fillPattern.id;
    o.fillPatternScale = s.fillPattern.scale;
  }
  if (s.fillImage) o.fillImage = s.fillImage;
  return o;
}

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
    ...styleExtrasOf(o),
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
  // Alt+click on a path point switches it between smooth and corner.
  if (hit.type === 'anchor' && e.alt) {
    const before = live.bounds();
    const a = live.subpaths[hit.sub]?.anchors[hit.index];
    live.setPointSmooth(!a?.smooth, { sub: hit.sub, index: hit.index });
    ctx.invalidate(rectUnion(before, live.bounds()));
    ctx.invalidateOverlay();
    return true;
  }
  live.beginDrag(hit, { x: e.x, y: e.y }, ctx.view.zoom);
  ctx.invalidateOverlay();
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

/** Keys for a live shape: Enter applies, Esc discards, Delete removes a selected path point. */
export function pathKeys(ctx: ToolContext, e: KeyboardEvent): boolean {
  const live = liveShape(ctx);
  if (!live) return false;
  if ((e.key === 'Delete' || e.key === 'Backspace') && live.shape === 'path' && live.selected) {
    const before = live.bounds();
    if (!live.deleteSelected()) ctx.cancelLive();
    else ctx.invalidate(rectUnion(before, live.bounds()));
    ctx.invalidateOverlay();
    return true;
  }
  return shapeKeys(ctx, e);
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
  library?: (ctx: ToolContext) => { shapeId: string; params: Record<string, number>; unitPath?: SubPaths; fillRule?: 'evenodd' | 'nonzero' };
  galleryOnly?: boolean;
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
    galleryOnly: cfg.galleryOnly,
    paints: true,
    options: [
      ...(cfg.leadOptions ?? []),
      DRAW_AS_OPTION,
      FILL_MODE_OPTION,
      WIDTH_OPTION,
      FILL_STYLE_OPTION,
      outlineStyleOption({ cap: 'butt', join: cfg.kind === 'rect' || cfg.kind === 'parametric' ? 'miter' : 'round', corners: cfg.kind === 'rect' || cfg.kind === 'parametric' }),
      ...(cfg.extraOptions ?? []),
      ANTIALIAS_OPTION,
      SHAPE_COLORS_HINT,
    ],
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
        const { shapeId, params, unitPath, fillRule } = cfg.library(ctx);
        live.setShape(shapeId, params, unitPath, fillRule);
        ctx.invalidate(rectUnion(before, live.bounds()));
      }
    },
    colorsChanged: (ctx) => restyleLive(ctx, cfg.id, swapped),
    deactivate: () => {
      creating = null;
    },
  };
}
