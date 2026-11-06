import type { RGBA } from '../core/color';
import {
  boundsOfPoints,
  distToSegment,
  pointInPolygon,
  rectInflate,
  rectIntersect,
  rectRoundOut,
  snapAngle45,
  type Point,
  type Rect,
} from '../core/geometry';
import type { Overlay } from '../render/Overlay';
import type { Surface } from '../raster/Surface';
import type { Selection } from '../doc/Selection';
import type { I18nKey } from '../../i18n';
import {
  boxBounds,
  boxContains,
  boxCorners,
  boxFromRect,
  handleCursor,
  handlePosition,
  hitHandle,
  moveBox,
  resizeBox,
  rotateBox,
  transformPoints,
  RESIZE_HANDLES,
  type BoxGeom,
  type BoxHandle,
} from './BoxGeom';
import type { LiveObject } from './LiveObject';
import { hardenEdges, paintShape, shapePad } from '../vector/render';
import type { ShapeStyleExtras } from '../vector/style';
import type { VectorNode } from '../vector/model';

/** `parametric` shapes come from the shape library (`shapeId`), drawn into their box. */
export type ShapeKind = 'line' | 'curve' | 'rect' | 'roundRect' | 'ellipse' | 'polygon' | 'parametric';
export type FillMode = 'outline' | 'fill' | 'both';

/** Colours, fill mode and width, plus the optional gradient, pattern, image and line styles. */
export interface ShapeStyle extends ShapeStyleExtras {
  mode: FillMode;
  width: number;
  outline: RGBA;
  fill: RGBA;
  radius: number;
  antialias: boolean;
}

const LABELS: Record<ShapeKind, I18nKey> = {
  line: 'history.line',
  curve: 'history.curve',
  rect: 'history.rect',
  roundRect: 'history.roundRect',
  ellipse: 'history.ellipse',
  polygon: 'history.polygon',
  parametric: 'history.shape',
};

export type ShapeHit =
  | { type: 'box'; handle: BoxHandle }
  | { type: 'vertex'; index: number }
  | { type: 'body' };

/** Padding (CSS px) between polygon vertices and its transform box. */
const POINT_BOX_PAD = 10;

/**
 * A shape being edited. Box shapes (rect, rounded rect, ellipse) use an oriented box; point
 * shapes (line, curve [p0, c1, c2, p1], polygon) keep explicit points. Rendered with Canvas 2D
 * into a private bitmap that is exactly what gets rasterised on commit.
 */
export class ShapeObject implements LiveObject {
  readonly kind = 'shape' as const;
  box: BoxGeom | null;
  points: Point[];
  /** Library shape and its slider values (parametric shapes only). */
  shapeId: string | null;
  params: Record<string, number>;
  /** Polygon still being drawn (rubber band to the pointer). */
  open = false;
  rubber: Point | null = null;
  private canvas: OffscreenCanvas | null = null;
  private area: Rect | null = null;
  private dragStart: { box: BoxGeom | null; points: Point[]; at: Point; hit: ShapeHit } | null = null;

  constructor(
    readonly shape: ShapeKind,
    public style: ShapeStyle,
    private readonly docW: number,
    private readonly docH: number,
    geom: { box?: BoxGeom; points?: Point[]; shapeId?: string | null; params?: Readonly<Record<string, number>> },
  ) {
    this.box = geom.box ?? null;
    this.points = geom.points ?? [];
    this.shapeId = geom.shapeId ?? null;
    this.params = { ...(geom.params ?? {}) };
    this.update();
  }

  get historyLabel(): I18nKey {
    return LABELS[this.shape];
  }

  get isBoxShape(): boolean {
    return this.box !== null;
  }

  setStyle(style: ShapeStyle): void {
    this.style = style;
    this.update();
  }

  /** Another library shape, or new slider values, in the same box. */
  setShape(shapeId: string, params: Readonly<Record<string, number>>): void {
    if (this.shape !== 'parametric') return;
    this.shapeId = shapeId;
    this.params = { ...params };
    this.update();
  }

  bounds(): Rect | null {
    return this.area;
  }

  private geometryBounds(): Rect | null {
    if (this.box) return boxBounds(this.box);
    const pts = this.open && this.rubber ? [...this.points, this.rubber] : this.points;
    return boundsOfPoints(pts);
  }

  /** Re-render the shape bitmap after any geometry or style change. */
  update(): void {
    const gb = this.geometryBounds();
    if (!gb) {
      this.area = null;
      return;
    }
    const pad = Math.max(this.style.width + 2, shapePad(this, this.open));
    const area = rectIntersect(rectRoundOut(rectInflate(gb, pad)), { x: 0, y: 0, w: this.docW, h: this.docH });
    this.area = area;
    if (!area) return;
    if (!this.canvas || this.canvas.width !== area.w || this.canvas.height !== area.h) {
      this.canvas = new OffscreenCanvas(area.w, area.h);
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, area.w, area.h);
    ctx.translate(-area.x, -area.y);
    paintShape(ctx, this, this.open, this.rubber);
    if (!this.style.antialias) {
      // Hard edges: threshold coverage so every pixel is fully on or off.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      hardenEdges(ctx, area.w, area.h);
    }
  }

  draw(ctx: OffscreenCanvasRenderingContext2D): void {
    if (this.canvas && this.area) ctx.drawImage(this.canvas, this.area.x, this.area.y);
  }

  rasterize(surface: Surface, clip: Selection | null): void {
    if (this.open) {
      // A polygon still being drawn is closed when committed (e.g. by switching tools).
      if (this.points.length < 3) return;
      this.open = false;
      this.rubber = null;
      this.update();
    }
    if (!this.canvas || !this.area) return;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, this.area.w, this.area.h);
    surface.compositeImage(
      this.area,
      { data: img.data, stride: this.area.w, ox: this.area.x, oy: this.area.y },
      'over',
      1,
      clip?.maskView() ?? null,
    );
  }

  /** Box used for transforming point shapes (polygon), padded in screen px. */
  private pointBox(zoom: number): BoxGeom | null {
    if (this.shape !== 'polygon' || this.open) return null;
    const b = boundsOfPoints(this.points);
    if (!b) return null;
    return boxFromRect(rectInflate(b, POINT_BOX_PAD / zoom));
  }

  private editBox(zoom: number): BoxGeom | null {
    return this.box ?? this.pointBox(zoom);
  }

  hit(p: Point, sp: Point, screen: (q: Point) => Point, zoom: number): ShapeHit | null {
    if (this.open) return null;
    const tol = 7;
    if (!this.box) {
      for (let i = 0; i < this.points.length; i++) {
        const v = screen(this.points[i]);
        if (Math.abs(v.x - sp.x) <= tol && Math.abs(v.y - sp.y) <= tol) return { type: 'vertex', index: i };
      }
    }
    const eb = this.editBox(zoom);
    if (eb) {
      const h = hitHandle(eb, screen, sp, zoom, true, tol);
      if (h && (this.box || h === 'rotate' || ['nw', 'ne', 'se', 'sw'].includes(h))) return { type: 'box', handle: h };
    }
    if (this.box) return boxContains(this.box, p) ? { type: 'body' } : null;
    const reach = this.style.width / 2 + 5 / zoom;
    const pts = this.points;
    if (this.shape === 'polygon' && pointInPolygon(p.x, p.y, pts)) return { type: 'body' };
    const poly = this.shape === 'curve' ? this.flattenCurve() : pts;
    for (let i = 0; i + 1 < poly.length; i++) if (distToSegment(p, poly[i], poly[i + 1]) <= reach) return { type: 'body' };
    if (this.shape === 'polygon' && pts.length > 2 && distToSegment(p, pts[pts.length - 1], pts[0]) <= reach) {
      return { type: 'body' };
    }
    return null;
  }

  private flattenCurve(): Point[] {
    const [a, b, c, d] = this.points;
    const out: Point[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
      });
    }
    return out;
  }

  cursorFor(hit: ShapeHit | null): string | null {
    if (!hit) return null;
    if (hit.type === 'body') return 'move';
    if (hit.type === 'vertex') return 'pointer';
    return handleCursor(hit.handle, this.box?.angle ?? 0);
  }

  cursorAt(): string | null {
    return null;
  }

  beginDrag(hit: ShapeHit, at: Point, zoom: number): void {
    this.dragStart = {
      box: hit.type === 'box' && !this.box ? this.pointBox(zoom) : this.box ? { ...this.box } : null,
      points: this.points.map((q) => ({ ...q })),
      at,
      hit,
    };
  }

  drag(p: Point, mods: { shift: boolean; alt: boolean }): void {
    const d = this.dragStart;
    if (!d) return;
    const dx = p.x - d.at.x;
    const dy = p.y - d.at.y;
    if (d.hit.type === 'body') {
      if (this.box && d.box) this.box = moveBox(d.box, dx, dy);
      else this.points = d.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
    } else if (d.hit.type === 'vertex') {
      const pts = d.points.map((q) => ({ ...q }));
      let np = p;
      if (mods.shift && (this.shape === 'line' || this.shape === 'polygon')) {
        const anchorIdx = this.shape === 'line' ? 1 - d.hit.index : (d.hit.index + pts.length - 1) % pts.length;
        np = snapAngle45(pts[anchorIdx], p);
      }
      pts[d.hit.index] = np;
      this.points = pts;
    } else if (d.box) {
      const h = d.hit.handle;
      const next =
        h === 'rotate'
          ? rotateBox(d.box, d.at, p, mods.shift)
          : resizeBox(d.box, h, p, { keepAspect: mods.shift, fromCenter: mods.alt });
      if (this.box) this.box = next;
      else this.points = transformPoints(d.points, d.box, next);
    }
    this.update();
  }

  endDrag(): void {
    this.dragStart = null;
  }

  get dragging(): boolean {
    return this.dragStart !== null;
  }

  /** Set when this shape is an object of a shape layer being edited in place. */
  vectorEdit: { layerId: string; id: string; index: number; before: readonly VectorNode[] } | null = null;

  /** Finish a polygon that's still being drawn. Returns false if it has too few corners. */
  close(): boolean {
    if (!this.open) return true;
    if (this.points.length < 3) return false;
    this.open = false;
    this.rubber = null;
    this.update();
    return true;
  }

  /** What the current drag moves, and the shape's bounds when it started (for snapping). */
  get dragInfo(): { body: boolean; rotate: boolean; at: Point; bounds: Rect | null } | null {
    const d = this.dragStart;
    if (!d) return null;
    const bounds = d.box ? boxBounds(d.box) : boundsOfPoints(d.points);
    return { body: d.hit.type === 'body', rotate: d.hit.type === 'box' && d.hit.handle === 'rotate', at: d.at, bounds };
  }

  drawOverlay(ov: Overlay): void {
    const screen = (q: Point) => ov.toScreen(q);
    const zoom = ov.view.zoom;
    if (this.open) {
      for (const v of this.points) ov.handle(screen(v), 'circle');
      return;
    }
    if (this.box) {
      ov.outlineScreen(boxCorners(this.box).map(screen), true, true);
      const top = screen(handlePosition(this.box, 'n', zoom));
      const rot = screen(handlePosition(this.box, 'rotate', zoom));
      ov.line(top, rot);
      for (const h of RESIZE_HANDLES) ov.handle(screen(handlePosition(this.box, h, zoom)));
      ov.handle(rot, 'circle');
      return;
    }
    if (this.shape === 'curve' && this.points.length === 4) {
      const [a, b, c, d] = this.points.map(screen);
      ov.line(a, b, true);
      ov.line(d, c, true);
      ov.handle(b, 'circle');
      ov.handle(c, 'circle');
      ov.handle(a);
      ov.handle(d);
      return;
    }
    const pb = this.pointBox(zoom);
    if (pb) {
      ov.outlineScreen(boxCorners(pb).map(screen), true, true);
      for (const h of ['nw', 'ne', 'se', 'sw'] as const) ov.handle(screen(handlePosition(pb, h, zoom)));
      const top = screen(handlePosition(pb, 'n', zoom));
      const rot = screen(handlePosition(pb, 'rotate', zoom));
      ov.line(top, rot);
      ov.handle(rot, 'circle');
    }
    for (const v of this.points) ov.handle(screen(v), 'circle');
  }

  dispose(): void {
    this.canvas = null;
  }
}
