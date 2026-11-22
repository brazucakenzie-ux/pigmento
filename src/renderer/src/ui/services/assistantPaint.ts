import { brushRegistry } from '@engine/brush/BrushRegistry';
import { ScriptedStroke, type StrokePoint } from '@engine/brush/scriptedStroke';
import { toHex8, type RGBA } from '@engine/core/color';
import { rectUnion, type Point } from '@engine/core/geometry';
import type { Layer } from '@engine/doc/Document';
import { ShapeObject, type ShapeStyle } from '@engine/live/ShapeObject';
import { TextObject } from '@engine/live/TextObject';
import { resolveParams, shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { ARROW_HEADS, DASH_STYLES, type ArrowHead, type DashStyle } from '@engine/vector/style';
import type { PathAnchor } from '@engine/vector/pathData';
import { engine } from '../state/engine';
import { bool, changeable, chooseLayer, colorArg, num, pixelLayer, str, type Handler } from './assistantArgs';

/**
 * The window's side of painting (8.9): colours, fill, brush strokes, lines, shapes, paths and
 * text. You watch strokes, lines and paths play out and shapes grow as if dragged (unless
 * drawing is instant); then each is made as one "Assistant: …" undo step. Your tool, its
 * options and your colours stay as they are (set_colors changes the colours on purpose).
 */

/** Run `step(t)` with t going from 0 to 1 over about `ms` (timers keep going in a window behind others). */
function playOut(ms: number, step: (t: number) => void): Promise<void> {
  // Nobody can watch a window that's minimised or hidden.
  if (document.hidden) return Promise.resolve();
  const t0 = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      step(t);
      if (t < 1) setTimeout(tick, 16);
      else resolve();
    };
    tick();
  });
}

/** How long a stroke or line of `length` px takes to watch: about half a second, up to 1.5 s for long ones. */
const watchMs = (length: number) => Math.min(1500, Math.max(500, length * 0.75));

const pointOf = (v: unknown): Point | null => {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const [x, y] = [num(o.x), num(o.y)];
  return x === undefined || y === undefined ? null : { x, y };
};

/** The points of a stroke, with pressure, and every 3 px in between (so it plays out smoothly). */
function strokePoints(v: unknown): { points: StrokePoint[]; length: number } {
  const given = (Array.isArray(v) ? v : []).map((o) => {
    const p = pointOf(o);
    if (!p) throw new Error('Each point needs x and y.');
    return { ...p, pressure: num((o as Record<string, unknown>).pressure) ?? 1 };
  });
  if (!given.length) throw new Error('A stroke needs at least one point.');
  const points: StrokePoint[] = [given[0]];
  let length = 0;
  for (let i = 1; i < given.length; i++) {
    const a = given[i - 1];
    const b = given[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    length += d;
    const n = Math.max(1, Math.ceil(d / 3));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, pressure: a.pressure + (b.pressure - a.pressure) * f });
    }
  }
  return { points, length };
}

/** The layer shapes and lines go on: pixels, or a shapes layer (where they stay editable). */
function shapeLayer(): Layer {
  const l = engine.doc.activeLayer;
  if (l.kind === 'group') throw new Error(`“${l.name}” is a group: name a pixels or shapes layer in it.`);
  changeable(l);
  return l;
}

/** Fill and outline colours from the arguments ('none' leaves one out); an outline in the primary colour if neither is given. */
function paintOf(args: Record<string, unknown>, width: number): ShapeStyle {
  const pick = (v: unknown, what: string): RGBA | null | undefined => (v === 'none' ? null : colorArg(v, what));
  let fill = pick(args.fill, 'fill');
  let outline = pick(args.outline, 'outline');
  if (fill === undefined && outline === undefined) outline = engine.primary;
  fill ??= null;
  outline ??= null;
  if (!fill && !outline) throw new Error('A shape needs a fill, an outline or both.');
  return { mode: fill && outline ? 'both' : fill ? 'fill' : 'outline', width, outline: outline ?? engine.primary, fill: fill ?? engine.secondary, radius: 0, antialias: true };
}

/** Show a live shape as it changes. */
function redraw(obj: ShapeObject, change: () => void): void {
  const before = obj.bounds();
  change();
  obj.update();
  engine.invalidate(rectUnion(before, obj.bounds()));
}

/** Watch a shape, line or path (made live first), then make it: as pixels, or an object on a shapes layer. */
function shapeChange(label: 'assistant.step.draw_shape' | 'assistant.step.draw_line' | 'assistant.step.draw_path', obj: ShapeObject, watch: (t: number) => void, finish: () => void, ms: number, text: string) {
  const live = () => {
    if (engine.live !== obj) engine.setLive(obj);
  };
  return {
    label,
    watch: async () => {
      live();
      await playOut(ms, (t) => redraw(obj, () => watch(t)));
    },
    apply: () => {
      live();
      redraw(obj, finish);
      engine.commitLive(true);
      return { text };
    },
  };
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const PAINT_HANDLERS: Record<string, Handler> = {
  set_colors: (args) => {
    const primary = colorArg(args.primary, 'primary colour');
    const secondary = colorArg(args.secondary, 'secondary colour');
    if (primary) engine.setPrimary(primary);
    if (secondary) engine.setSecondary(secondary);
    return { text: `The colours are ${toHex8(engine.primary)} and ${toHex8(engine.secondary)}.`, data: { primary: toHex8(engine.primary), secondary: toHex8(engine.secondary) } };
  },

  fill: (args) => {
    chooseLayer(args.layer);
    const layer = pixelLayer();
    const color = colorArg(args.color) ?? engine.primary;
    const [x, y] = [num(args.x), num(args.y)];
    const { width: W, height: H } = engine.doc;
    if ((x === undefined) !== (y === undefined)) throw new Error('A fill from a point needs both x and y.');
    if (x !== undefined && y !== undefined) {
      if (x < 0 || y < 0 || x >= W || y >= H) throw new Error(`That point is outside the picture, which is ${W} × ${H} pixels.`);
      const tolerance = num(args.tolerance) ?? 15;
      const contiguous = bool(args.contiguous) ?? true;
      return {
        label: 'assistant.step.fill',
        apply: async () => {
          await engine.floodFill(x, y, color, tolerance, contiguous);
          return { text: `Filled around ${Math.floor(x)}, ${Math.floor(y)} on “${layer.name}”.` };
        },
      };
    }
    return {
      label: 'assistant.step.fill',
      apply: () => {
        engine.fillSelection(color);
        return { text: `Filled ${engine.doc.selection ? 'the selection' : 'the whole layer'} on “${layer.name}”.` };
      },
    };
  },

  brush_stroke: (args) => {
    chooseLayer(args.layer);
    const layer = pixelLayer();
    const { points, length } = strokePoints(args.points);
    const id = str(args.brush) ?? 'round';
    const def = brushRegistry.get(id);
    if (!def) throw new Error(`There’s no brush ${id}. list_available with what: brushes lists them.`);
    const erase = bool(args.erase) ?? def.eraser;
    const brush = { settings: def.settings, size: num(args.size) ?? 8, opacity: num(args.opacity) ?? 1, color: colorArg(args.color) ?? engine.primary, erase };
    let stroke: ScriptedStroke | null = null;
    let fed = 0;
    const feedTo = (n: number) => {
      stroke ??= new ScriptedStroke(engine, layer, brush, points[0]);
      if (n > fed) stroke.add(points.slice(fed, n));
      fed = Math.max(fed, n);
    };
    return {
      label: 'assistant.step.brush_stroke',
      watch: () => playOut(watchMs(length), (t) => feedTo(Math.max(1, Math.ceil(t * points.length)))),
      apply: () => {
        feedTo(points.length);
        const r = stroke!.end(erase ? 'history.eraser' : 'history.brush');
        const name = def.name ?? id;
        return { text: r ? `${erase ? 'Erased' : 'Painted'} a stroke with ${name} on “${layer.name}”.` : 'The stroke painted nothing inside the picture (or the selection).', data: { area: r && { x: r.x, y: r.y, width: r.w, height: r.h } } };
      },
    };
  },

  draw_line: (args) => {
    chooseLayer(args.layer);
    const layer = shapeLayer();
    const from = pointOf(args.from);
    const to = pointOf(args.to);
    if (!from || !to) throw new Error('A line needs from and to, each with x and y.');
    const arrowStart = (str(args.arrowStart) ?? 'none') as ArrowHead;
    const arrowEnd = (str(args.arrowEnd) ?? 'none') as ArrowHead;
    const dash = (str(args.dash) ?? 'solid') as DashStyle;
    if (!ARROW_HEADS.includes(arrowStart) || !ARROW_HEADS.includes(arrowEnd)) throw new Error(`Arrow heads can be ${ARROW_HEADS.join(', ')}.`);
    if (!DASH_STYLES.includes(dash)) throw new Error(`Dashes can be ${DASH_STYLES.join(', ')}.`);
    const style: ShapeStyle = { mode: 'outline', width: num(args.width) ?? 3, outline: colorArg(args.color) ?? engine.primary, fill: engine.secondary, radius: 0, antialias: true, arrowStart, arrowEnd, dash };
    const obj = new ShapeObject('line', style, engine.doc.width, engine.doc.height, { points: [from, from] });
    return shapeChange(
      'assistant.step.draw_line',
      obj,
      (t) => (obj.points = [from, lerp(from, to, t)]),
      () => (obj.points = [from, to]),
      watchMs(Math.hypot(to.x - from.x, to.y - from.y)),
      `Drew a line on “${layer.name}”.`,
    );
  },

  draw_shape: (args) => {
    chooseLayer(args.layer);
    const layer = shapeLayer();
    const id = str(args.shape) ?? '';
    const def = shapeRegistry.get(id);
    if (!def) throw new Error(`There’s no shape ${id}. list_available with what: shapes lists them.`);
    const [x, y, w, h] = [num(args.x), num(args.y), num(args.width), num(args.height)];
    if (x === undefined || y === undefined || w === undefined || h === undefined) throw new Error('A shape needs x, y, width and height.');
    const angle = ((num(args.rotate) ?? 0) * Math.PI) / 180;
    const given = typeof args.settings === 'object' && args.settings !== null ? (args.settings as Record<string, number>) : undefined;
    const params = resolveParams(def, given);
    const own = def.custom && def.unit ? { unitPath: def.unit, fillRule: def.fillRule } : {};
    const style = paintOf(args, num(args.outlineWidth) ?? 3);
    const boxAt = (t: number) => ({ cx: x + (w * t) / 2, cy: y + (h * t) / 2, w: Math.max(1, w * t), h: Math.max(1, h * t), angle });
    const obj = new ShapeObject('parametric', style, engine.doc.width, engine.doc.height, { box: boxAt(0.02), shapeId: def.id, params, ...own });
    const onShapes = layer.kind === 'vector' ? ' (an object you can still edit)' : '';
    return shapeChange(
      'assistant.step.draw_shape',
      obj,
      (t) => (obj.box = boxAt(Math.max(0.02, t))),
      () => (obj.box = boxAt(1)),
      450,
      `Drew a ${def.name ?? def.id} on “${layer.name}”${onShapes}.`,
    );
  },

  draw_path: (args) => {
    chooseLayer(args.layer);
    const layer = shapeLayer();
    const anchors: PathAnchor[] = (Array.isArray(args.points) ? args.points : []).map((o) => {
      const p = pointOf(o);
      if (!p) throw new Error('Each point of a path needs x and y.');
      const r = o as Record<string, unknown>;
      return { x: p.x, y: p.y, in: pointOf(r.in), out: pointOf(r.out), smooth: false };
    });
    if (anchors.length < 2) throw new Error('A path needs at least two points.');
    const closed = bool(args.closed) ?? false;
    const style = paintOf(closed ? args : { ...args, fill: args.fill ?? 'none' }, num(args.outlineWidth) ?? 3);
    const obj = new ShapeObject('path', style, engine.doc.width, engine.doc.height, { subpaths: [{ closed: false, anchors: anchors.slice(0, 2) }] });
    let length = 0;
    for (let i = 1; i < anchors.length; i++) length += Math.hypot(anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y);
    return shapeChange(
      'assistant.step.draw_path',
      obj,
      (t) => (obj.subpaths = [{ closed: false, anchors: anchors.slice(0, Math.max(2, Math.ceil(t * anchors.length))) }]),
      () => (obj.subpaths = [{ closed, anchors }]),
      watchMs(length),
      `Drew a ${closed ? 'closed' : 'open'} path of ${anchors.length} points on “${layer.name}”.`,
    );
  },

  add_text: (args) => {
    chooseLayer(args.layer);
    const layer = pixelLayer();
    const text = str(args.text) ?? '';
    if (!text.trim()) throw new Error('Give the text to write.');
    const [x, y] = [num(args.x), num(args.y)];
    if (x === undefined || y === undefined) throw new Error('Text needs x and y (its top-left corner).');
    const align = str(args.align) ?? 'left';
    const obj = new TextObject(
      Math.round(x),
      Math.round(y),
      Math.round(num(args.width) ?? 0),
      0,
      {
        family: str(args.font) ?? 'Segoe UI',
        sizePt: num(args.size) ?? 24,
        bold: bool(args.bold) ?? false,
        italic: bool(args.italic) ?? false,
        underline: bool(args.underline) ?? false,
        strike: false,
        align: align === 'center' || align === 'right' ? align : 'left',
        color: colorArg(args.color) ?? engine.primary,
        background: colorArg(args.background, 'background') ?? null,
      },
      engine.doc.dpi,
      engine.doc.width,
      engine.doc.height,
    );
    const show = (s: string) => {
      const before = obj.bounds();
      obj.setText(s);
      engine.invalidate(rectUnion(before, obj.bounds()));
    };
    const live = () => {
      if (engine.live !== obj) engine.setLive(obj);
    };
    return {
      label: 'assistant.step.add_text',
      // Typed out, a letter at a time.
      watch: async () => {
        live();
        await playOut(Math.min(1500, Math.max(400, text.length * 40)), (t) => show(text.slice(0, Math.ceil(t * text.length))));
      },
      apply: () => {
        live();
        show(text);
        engine.commitLive(true);
        return { text: `Wrote “${text.length > 40 ? `${text.slice(0, 40)}…` : text}” on “${layer.name}”.` };
      },
    };
  },
};
