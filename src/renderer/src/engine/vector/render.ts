import { toCss } from '../core/color';
import { rectInflate, rectIntersect, rectRoundOut, type Point } from '../core/geometry';
import type { BoxGeom } from '../live/BoxGeom';
import type { ShapeKind, ShapeStyle } from '../live/ShapeObject';
import { Surface } from '../raster/Surface';
import { shapeBounds, walkShapes, type VectorNode, type VectorShape } from './model';

/** What's needed to draw a shape (a live ShapeObject or a vector object). */
export interface ShapeGeom {
  readonly shape: ShapeKind;
  readonly box: BoxGeom | null;
  readonly points: readonly Point[];
  readonly style: ShapeStyle;
}

type Ctx = OffscreenCanvasRenderingContext2D;

/** Lines and curves (and polygons still being drawn) are strokes only. */
export function isLineShape(shape: ShapeKind, open = false): boolean {
  return shape === 'line' || shape === 'curve' || open;
}

/** Path in document coordinates. Outlines are inset so the stroke stays inside the box. */
export function buildShapePath(g: ShapeGeom, open = false, rubber: Point | null = null): Path2D {
  const p = new Path2D();
  const { style } = g;
  if (g.box) {
    const b = g.box;
    const inset = style.mode === 'fill' ? 0 : style.width / 2;
    const hw = Math.max(0, Math.abs(b.w) / 2 - inset);
    const hh = Math.max(0, Math.abs(b.h) / 2 - inset);
    const local = new Path2D();
    if (g.shape === 'ellipse') {
      local.ellipse(0, 0, Math.max(0.01, hw), Math.max(0.01, hh), 0, 0, Math.PI * 2);
    } else if (g.shape === 'roundRect') {
      const r = Math.max(0, Math.min(style.radius - inset, hw, hh));
      local.roundRect(-hw, -hh, hw * 2, hh * 2, r);
    } else {
      local.rect(-hw, -hh, hw * 2, hh * 2);
    }
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    p.addPath(local, new DOMMatrix([c, s, -s, c, b.cx, b.cy]));
    return p;
  }
  const pts = g.points;
  if (pts.length === 0) return p;
  if (g.shape === 'curve' && pts.length === 4) {
    p.moveTo(pts[0].x, pts[0].y);
    p.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y);
    return p;
  }
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  if (open && rubber) p.lineTo(rubber.x, rubber.y);
  if (g.shape === 'polygon' && !open) p.closePath();
  return p;
}

/** Fill and/or stroke a shape's path with its style. */
export function paintShape(ctx: Ctx, g: ShapeGeom, path: Path2D, open = false): void {
  const { style } = g;
  const line = isLineShape(g.shape, open);
  const fill = !line && (style.mode === 'fill' || style.mode === 'both');
  const stroke = line || style.mode === 'outline' || style.mode === 'both';
  if (fill) {
    ctx.fillStyle = toCss(style.fill);
    ctx.fill(path);
  }
  if (stroke && style.width > 0) {
    ctx.strokeStyle = toCss(style.outline);
    ctx.lineWidth = style.width;
    ctx.lineJoin = g.shape === 'rect' ? 'miter' : 'round';
    ctx.lineCap = line ? 'round' : 'butt';
    ctx.stroke(path);
  }
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
  const path = buildShapePath(s);
  if (s.style.antialias) {
    paintShape(ctx, s, path);
    return;
  }
  // Hard edges need their own bitmap, thresholded, then drawn in place.
  const b = shapeBounds(s);
  if (!b) return;
  const area = rectIntersect(rectRoundOut(rectInflate(b, s.style.width + 2)), { x: 0, y: 0, w: docW, h: docH });
  if (!area) return;
  if (!scratch || scratch.width < area.w || scratch.height < area.h) scratch = new OffscreenCanvas(Math.max(area.w, scratch?.width ?? 0), Math.max(area.h, scratch?.height ?? 0));
  const sc = scratch.getContext('2d', { willReadFrequently: true })!;
  sc.setTransform(1, 0, 0, 1, 0, 0);
  sc.clearRect(0, 0, area.w, area.h);
  sc.translate(-area.x, -area.y);
  paintShape(sc, s, path);
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
    const line = isLineShape(s.shape);
    if (!line && (s.style.mode === 'fill' || s.style.mode === 'both') && ctx.isPointInPath(path, p.x, p.y)) return true;
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
