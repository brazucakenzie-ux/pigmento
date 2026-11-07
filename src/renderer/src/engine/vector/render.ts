import { toCss, type RGBA } from '../core/color';
import { boundsOfPoints, rectInflate, rectIntersect, rectRoundOut, type Point, type Rect } from '../core/geometry';
import type { BoxGeom } from '../live/BoxGeom';
import type { ShapeKind, ShapeStyle } from '../live/ShapeObject';
import { patternById, renderPattern } from '../raster/patterns';
import { Surface } from '../raster/Surface';
import type { ImageBuf } from '../raster/transform';
import { customShapeDef, shapePath, shapeRegistry, type ShapeDef } from '../shapes/ShapeRegistry';
import { pathBounds, toPath2D } from '../shapes/path';
import { toCmds, type SubPaths } from './pathData';
import '../shapes/library';
import { assetCanvas } from './assets';
import { shapeBounds, walkShapes, type VectorNode, type VectorShape } from './model';
import { arrowHead, dashArray, gradientStops, hasArrows, lineDefaults, linearEnds, MITER_LIMIT, outlineReach, type ShapeGradient } from './style';

/** What's needed to draw a shape (a live ShapeObject or a vector object). */
export interface ShapeGeom {
  readonly shape: ShapeKind;
  readonly box: BoxGeom | null;
  readonly points: readonly Point[];
  readonly style: ShapeStyle;
  readonly shapeId?: string | null;
  readonly params?: Readonly<Record<string, number>>;
  readonly subpaths?: SubPaths;
  readonly unitPath?: SubPaths;
  readonly fillRule?: 'evenodd' | 'nonzero';
}

type Ctx = OffscreenCanvasRenderingContext2D;

/** Lines and curves (and polygons still being drawn) are strokes only. */
export function isLineShape(shape: ShapeKind, open = false): boolean {
  return shape === 'line' || shape === 'curve' || open;
}

/** Personal shapes carry their own outline; one definition is made per outline. */
const unitDefs = new WeakMap<object, ShapeDef>();

/** The library definition of a parametric shape (undefined for other kinds or unknown ids). */
export function shapeDefOf(g: Pick<ShapeGeom, 'shape' | 'shapeId' | 'unitPath' | 'fillRule'>): ShapeDef | undefined {
  if (g.shape !== 'parametric') return undefined;
  if (g.unitPath) {
    let d = unitDefs.get(g.unitPath);
    if (!d) {
      d = customShapeDef({ id: g.shapeId ?? 'custom', name: '', category: 'custom', unit: g.unitPath, fillRule: g.fillRule ?? 'evenodd', aspect: 1 });
      unitDefs.set(g.unitPath, d);
    }
    return d;
  }
  return g.shapeId ? shapeRegistry.get(g.shapeId) : undefined;
}

/** Drawn with the outline only: lines, curves, open polygons and line-only library shapes. */
export function isStrokeOnly(g: Pick<ShapeGeom, 'shape' | 'shapeId' | 'unitPath' | 'fillRule'>, open = false): boolean {
  return isLineShape(g.shape, open) || shapeDefOf(g)?.strokeOnly === true;
}

function fillRuleOf(g: ShapeGeom): CanvasFillRule {
  if (g.shape === 'path') return g.fillRule ?? 'evenodd';
  return shapeDefOf(g)?.fillRule ?? 'nonzero';
}

/** Caps and corners the outline uses (the style's, or the kind's usual ones). */
export function lineStyleOf(g: ShapeGeom, open = false): { cap: CanvasLineCap; join: CanvasLineJoin } {
  const d = lineDefaults(g.shape, isStrokeOnly(g, open));
  return { cap: g.style.cap ?? d.cap, join: g.style.join ?? d.join };
}

/** Arrowheads only go on lines and curves. */
function arrowsOf(g: ShapeGeom): boolean {
  return (g.shape === 'line' || g.shape === 'curve') && hasArrows(g.style);
}

/** How far the drawn shape can reach past its geometric bounds (outline, corners, arrows). */
export function shapePad(g: ShapeGeom, open = false): number {
  const line = isStrokeOnly(g, open);
  const outlined = line || g.style.mode !== 'fill';
  if (!outlined) return 1;
  return outlineReach(g.style.width, lineStyleOf(g, open).join, arrowsOf(g)) + 2;
}

/**
 * A shape in its own frame: the path, the box the paint is laid over, and the matrix to the
 * document. Box shapes use their oriented box (so gradients turn and flip with them); point
 * shapes use document space and their bounds.
 */
interface Frame {
  path: Path2D;
  matrix: DOMMatrix | null;
  rect: Rect;
}

function frameOf(g: ShapeGeom, open = false, rubber: Point | null = null): Frame {
  const { style } = g;
  if (g.box) {
    const b = g.box;
    const def = shapeDefOf(g);
    const inset = style.mode === 'fill' && !def?.strokeOnly ? 0 : style.width / 2;
    const hw = Math.max(0, Math.abs(b.w) / 2 - inset);
    const hh = Math.max(0, Math.abs(b.h) / 2 - inset);
    let local = new Path2D();
    let sx = 1;
    let sy = 1;
    if (g.shape === 'parametric') {
      // Library shapes are drawn into their box; a negative side mirrors them (flips).
      const w = hw * 2;
      const h = hh * 2;
      local = def ? toPath2D(shapePath(def, w, h, g.params), -hw, -hh) : local;
      if (!def) local.rect(-hw, -hh, w, h);
      sx = Math.sign(b.w) || 1;
      sy = Math.sign(b.h) || 1;
    } else if (g.shape === 'ellipse') {
      local.ellipse(0, 0, Math.max(0.01, hw), Math.max(0.01, hh), 0, 0, Math.PI * 2);
    } else if (g.shape === 'roundRect') {
      const r = Math.max(0, Math.min(style.radius - inset, hw, hh));
      local.roundRect(-hw, -hh, hw * 2, hh * 2, r);
    } else {
      local.rect(-hw, -hh, hw * 2, hh * 2);
    }
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    const aw = Math.abs(b.w);
    const ah = Math.abs(b.h);
    return { path: local, matrix: new DOMMatrix([c * sx, s * sx, -s * sy, c * sy, b.cx, b.cy]), rect: { x: -aw / 2, y: -ah / 2, w: aw, h: ah } };
  }
  if (g.shape === 'path') {
    const cmds = toCmds(g.subpaths ?? []);
    // While the pen is placing points, a segment runs from the last one to the pointer.
    const lastSub = g.subpaths?.[g.subpaths.length - 1];
    const last = lastSub?.anchors[lastSub.anchors.length - 1];
    if (open && rubber && last) {
      const c1 = last.out ?? last;
      cmds.push({ op: 'C', x1: c1.x, y1: c1.y, x2: rubber.x, y2: rubber.y, x: rubber.x, y: rubber.y });
    }
    return { path: toPath2D(cmds), matrix: null, rect: pathBounds(cmds) ?? { x: 0, y: 0, w: 0, h: 0 } };
  }
  const p = new Path2D();
  const pts = g.points;
  const all = open && rubber ? [...pts, rubber] : [...pts];
  const rect = boundsOfPoints(all) ?? { x: 0, y: 0, w: 0, h: 0 };
  if (pts.length === 0) return { path: p, matrix: null, rect };
  if (g.shape === 'curve' && pts.length === 4) {
    p.moveTo(pts[0].x, pts[0].y);
    p.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
    return { path: p, matrix: null, rect };
  }
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  if (open && rubber) p.lineTo(rubber.x, rubber.y);
  if (g.shape === 'polygon' && !open) p.closePath();
  return { path: p, matrix: null, rect };
}

/** Path in document coordinates. Outlines are inset so the stroke stays inside the box. */
export function buildShapePath(g: ShapeGeom, open = false, rubber: Point | null = null): Path2D {
  const f = frameOf(g, open, rubber);
  if (!f.matrix) return f.path;
  const p = new Path2D();
  p.addPath(f.path, f.matrix);
  return p;
}

// ---- paints -------------------------------------------------------------------------------

/** Saved patterns live in the engine; it registers how to find them. */
let savedPatternTile: (id: string, scale: number) => ImageBuf | null = () => null;

export function setSavedPatternSource(fn: (id: string, scale: number) => ImageBuf | null): void {
  savedPatternTile = fn;
  patternCache.clear();
}

const patternCache = new Map<string, OffscreenCanvas>();

function patternCanvas(id: string, scale: number, fg: RGBA, bg: RGBA): OffscreenCanvas | null {
  const key = `${id}|${scale}|${toCss(fg)}|${toCss(bg)}`;
  let c = patternCache.get(key);
  if (c) return c;
  const def = patternById(id);
  const tile = def ? renderPattern(def, fg, bg, scale) : savedPatternTile(id, scale);
  if (!tile) return null;
  c = new OffscreenCanvas(tile.w, tile.h);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tile.data), tile.w, tile.h), 0, 0);
  if (patternCache.size > 48) patternCache.delete(patternCache.keys().next().value!);
  patternCache.set(key, c);
  return c;
}

function makeGradient(ctx: Ctx, g: ShapeGradient | undefined, r: Rect, outline: RGBA, fill: RGBA): CanvasGradient {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const type = g?.type ?? 'linear';
  let grad: CanvasGradient;
  if (type === 'radial') grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(0.5, Math.hypot(r.w, r.h) / 2));
  else if (type === 'angular') grad = ctx.createConicGradient((((g?.angle ?? 0) * Math.PI) / 180), cx, cy);
  else {
    const [a, b] = linearEnds(cx, cy, r.w, r.h, g?.angle ?? 0);
    grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  }
  for (const s of gradientStops(g, outline, fill)) grad.addColorStop(Math.min(1, Math.max(0, s.pos)), toCss(s.color));
  return grad;
}

/** Paint for the outline (a colour or a gradient over the shape's frame). */
function outlinePaint(ctx: Ctx, g: ShapeGeom, f: Frame): string | CanvasGradient {
  const st = g.style;
  return st.outlineKind === 'gradient' ? makeGradient(ctx, st.outlineGradient, f.rect, st.outline, st.fill) : toCss(st.outline);
}

function fillShape(ctx: Ctx, g: ShapeGeom, f: Frame): void {
  const st = g.style;
  const rule = fillRuleOf(g);
  const kind = st.fillKind ?? 'solid';
  if (kind === 'gradient') {
    ctx.fillStyle = makeGradient(ctx, st.fillGradient, f.rect, st.outline, st.fill);
    ctx.fill(f.path, rule);
    return;
  }
  if (kind === 'pattern' && st.fillPattern) {
    const tile = patternCanvas(st.fillPattern.id, Math.max(1, Math.min(8, Math.round(st.fillPattern.scale))), st.outline, st.fill);
    const pattern = tile ? ctx.createPattern(tile, 'repeat') : null;
    if (pattern) {
      // Tiles line up with the document, like the Fill tool's, whatever the shape's angle.
      if (f.matrix) pattern.setTransform(f.matrix.inverse());
      ctx.fillStyle = pattern;
      ctx.fill(f.path, rule);
      return;
    }
  }
  if (kind === 'image' && st.fillImage) {
    const img = assetCanvas(st.fillImage);
    if (img) {
      // The picture covers the box, cropped to its proportions.
      const r = f.rect;
      const k = Math.max(r.w / img.width, r.h / img.height);
      const w = img.width * k;
      const h = img.height * k;
      ctx.save();
      ctx.clip(f.path, rule);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
      ctx.restore();
      return;
    }
  }
  ctx.fillStyle = toCss(st.fill);
  ctx.fill(f.path, rule);
}

/** Unit direction from a to b (or null when they coincide). */
function dirOf(a: Point, b: Point): Point | null {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d < 1e-6 ? null : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** A line or curve with arrowheads: the line pulled back into the heads, then the heads. */
function strokeWithArrows(ctx: Ctx, g: ShapeGeom, paint: string | CanvasGradient): void {
  const st = g.style;
  const pts = g.points.map((p) => ({ ...p }));
  if (pts.length < 2) return;
  const last = pts.length - 1;
  // Tangents at the ends (curves: towards their nearest distinct control point).
  const startFrom = g.shape === 'curve' ? (pts.slice(1).find((p) => dirOf(p, pts[0])) ?? pts[last]) : pts[1];
  const endFrom = g.shape === 'curve' ? ([...pts.slice(0, last)].reverse().find((p) => dirOf(p, pts[last])) ?? pts[0]) : pts[last - 1];
  const dStart = dirOf(startFrom, pts[0]);
  const dEnd = dirOf(endFrom, pts[last]);
  const length = Math.hypot(pts[last].x - pts[0].x, pts[last].y - pts[0].y);
  const heads = [
    dStart ? arrowHead(st.arrowStart ?? 'none', pts[0], dStart, st.width) : null,
    dEnd ? arrowHead(st.arrowEnd ?? 'none', pts[last], dEnd, st.width) : null,
  ];
  const pull = (i: number, d: Point | null, inset: number) => {
    if (!d || !inset) return;
    const k = Math.min(inset, length * 0.45);
    pts[i] = { x: pts[i].x - d.x * k, y: pts[i].y - d.y * k };
  };
  pull(0, dStart, heads[0]?.inset ?? 0);
  pull(last, dEnd, heads[1]?.inset ?? 0);
  const p = new Path2D();
  p.moveTo(pts[0].x, pts[0].y);
  if (g.shape === 'curve' && pts.length === 4) p.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
  else for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  ctx.stroke(p);
  ctx.setLineDash([]);
  for (const h of heads) {
    if (!h) continue;
    const hp = new Path2D();
    h.points.forEach((q, i) => (i === 0 ? hp.moveTo(q.x, q.y) : hp.lineTo(q.x, q.y)));
    if (h.closed) {
      hp.closePath();
      ctx.fillStyle = paint;
      ctx.fill(hp);
    } else {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(hp);
    }
  }
}

/** Fill and/or outline a shape with its style. */
export function paintShape(ctx: Ctx, g: ShapeGeom, open = false, rubber: Point | null = null): void {
  const { style } = g;
  const line = isStrokeOnly(g, open);
  const fill = !line && (style.mode === 'fill' || style.mode === 'both');
  const stroke = line || style.mode === 'outline' || style.mode === 'both';
  const f = frameOf(g, open, rubber);
  ctx.save();
  if (f.matrix) ctx.transform(f.matrix.a, f.matrix.b, f.matrix.c, f.matrix.d, f.matrix.e, f.matrix.f);
  if (fill) fillShape(ctx, g, f);
  if (stroke && style.width > 0) {
    const { cap, join } = lineStyleOf(g, open);
    const paint = outlinePaint(ctx, g, f);
    ctx.strokeStyle = paint;
    ctx.lineWidth = style.width;
    ctx.lineJoin = join;
    ctx.miterLimit = MITER_LIMIT;
    ctx.lineCap = cap;
    ctx.setLineDash(dashArray(style.dash, style.width, cap));
    if (arrowsOf(g) && !open) strokeWithArrows(ctx, g, paint);
    else ctx.stroke(f.path);
  }
  ctx.restore();
}

/** Make every pixel fully on or off (shapes with anti-aliasing turned off). */
export function hardenEdges(ctx: Ctx, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

let scratch: OffscreenCanvas | null = null;

/** Draw one vector shape into ctx (document coordinates). */
export function drawVectorShape(ctx: Ctx, s: VectorShape, docW: number, docH: number): void {
  if (s.style.antialias) {
    paintShape(ctx, s);
    return;
  }
  // Hard edges need their own bitmap, thresholded, then drawn in place.
  const b = shapeBounds(s);
  if (!b) return;
  const area = rectIntersect(rectRoundOut(rectInflate(b, shapePad(s))), { x: 0, y: 0, w: docW, h: docH });
  if (!area) return;
  if (!scratch || scratch.width < area.w || scratch.height < area.h) scratch = new OffscreenCanvas(Math.max(area.w, scratch?.width ?? 0), Math.max(area.h, scratch?.height ?? 0));
  const sc = scratch.getContext('2d', { willReadFrequently: true })!;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.clearRect(0, 0, area.w, area.h);
  sc.translate(-area.x, -area.y);
  paintShape(sc, s);
  sc.setTransform(1, 0, 0, 1, 0, 0);
  hardenEdges(sc, area.w, area.h);
  ctx.drawImage(scratch, 0, 0, area.w, area.h, area.x, area.y, area.w, area.h);
}

export function drawNodes(ctx: Ctx, nodes: readonly VectorNode[], docW: number, docH: number): void {
  for (const s of walkShapes(nodes)) drawVectorShape(ctx, s, docW, docH);
}

/** The objects as pixels (for blending, export, flattening and the colour picker). */
export function rasterizeNodes(nodes: readonly VectorNode[], w: number, h: number): Surface {
  if (nodes.length === 0) return new Surface(w, h);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawNodes(ctx, nodes, w, h);
  const s = Surface.fromRGBA(w, h, ctx.getImageData(0, 0, w, h).data);
  s.compact();
  return s;
}

let hitCtx: OffscreenCanvasRenderingContext2D | null = null;

/**
 * The topmost top-level node under document point p (within `tolerance` document px of a
 * stroke), or null.
 */
export function hitTestNodes(nodes: readonly VectorNode[], p: Point, tolerance: number): string | null {
  hitCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  const ctx = hitCtx;
  const hitShape = (s: VectorShape): boolean => {
    const path = buildShapePath(s);
    const line = isStrokeOnly(s);
    if (!line && (s.style.mode === 'fill' || s.style.mode === 'both') && ctx.isPointInPath(path, p.x, p.y, fillRuleOf(s))) return true;
    ctx.lineWidth = Math.max(s.style.width, 0) + tolerance * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    return ctx.isPointInStroke(path, p.x, p.y);
  };
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    for (const s of walkShapes([n])) if (hitShape(s)) return n.id;
  }
  return null;
}
