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
import {
  allPoints,
  insertAnchor,
  moveAnchor,
  moveHandle,
  nearestSegment,
  removeAnchor,
  segmentsOf,
  setClosed,
  setSmooth,
  toCmds,
  withPoints,
  type PathAnchor,
  type SubPath,
  type SubPaths,
} from '../vector/pathData';
import { pathBounds } from '../shapes/path';

/** What the options bar shows for a path being edited. */
export interface PathInfo {
  /** The pen is still placing points. */
  drawing: boolean;
  /** The subpath of the selected point (or the only one) is closed. */
  closed: boolean;
  /** The selected point, if any. */
  selected: { smooth: boolean } | null;
  anchors: number;
}

let pathHitCtx: OffscreenCanvasRenderingContext2D | null = null;

/** Points along a subpath (curves sampled), for overlays and hit tests. */
function flatten(sub: SubPath): Point[] {
  const out: Point[] = [];
  const a = sub.anchors;
  if (!a.length) return out;
  out.push({ x: a[0].x, y: a[0].y });
  for (const [i, j] of segmentsOf(sub)) {
    const p0 = a[i];
    const p1 = a[i].out ?? a[i];
    const p2 = a[j].in ?? a[j];
    const p3 = a[j];
    const curved = a[i].out || a[j].in;
    for (let k = 1; k <= (curved ? 16 : 1); k++) {
      const t = k / (curved ? 16 : 1);
      const u = 1 - t;
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    }
  }
  return out;
}

/**
 * `parametric` shapes come from the shape library (`shapeId`), drawn into their box; `path`
 * shapes are free-form outlines (the Pen tool, or a shape converted to a path).
 */
export type ShapeKind = 'line' | 'curve' | 'rect' | 'roundRect' | 'ellipse' | 'polygon' | 'parametric' | 'path';
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
  path: 'history.path',
};

export type ShapeHit =
  | { type: 'box'; handle: BoxHandle }
  | { type: 'vertex'; index: number }
  | { type: 'anchor'; sub: number; index: number }
  | { type: 'handle'; sub: number; index: number; which: 'in' | 'out' }
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
  /** Paths: the outline (document coordinates). */
  subpaths: SubPath[];
  /** Personal library shapes: their own outline in a unit box. */
  unitPath: SubPaths | undefined;
  fillRule: 'evenodd' | 'nonzero' | undefined;
  /** Paths: the point last clicked or added (its handles are shown). */
  selected: { sub: number; index: number } | null = null;
  /** Told when a path's points, selection or closing change (the options bar follows). */
  onPathChange: (() => void) | null = null;
  /** Polygon still being drawn (rubber band to the pointer). */
  open = false;
  rubber: Point | null = null;
  private canvas: OffscreenCanvas | null = null;
  private area: Rect | null = null;
  private dragStart: { box: BoxGeom | null; points: Point[]; subpaths: SubPath[]; at: Point; hit: ShapeHit } | null = null;

  constructor(
    readonly shape: ShapeKind,
    public style: ShapeStyle,
    private readonly docW: number,
    private readonly docH: number,
    geom: {
      box?: BoxGeom;
      points?: Point[];
      shapeId?: string | null;
      params?: Readonly<Record<string, number>>;
      subpaths?: SubPaths;
      unitPath?: SubPaths;
      fillRule?: 'evenodd' | 'nonzero';
    },
  ) {
    this.box = geom.box ?? null;
    this.points = geom.points ?? [];
    this.shapeId = geom.shapeId ?? null;
    this.params = { ...(geom.params ?? {}) };
    this.subpaths = [...(geom.subpaths ?? [])];
    this.unitPath = geom.unitPath;
    this.fillRule = geom.fillRule;
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
  setShape(shapeId: string, params: Readonly<Record<string, number>>, unitPath?: SubPaths, fillRule?: 'evenodd' | 'nonzero'): void {
    if (this.shape !== 'parametric') return;
    this.shapeId = shapeId;
    this.params = { ...params };
    this.unitPath = unitPath;
    this.fillRule = fillRule;
    this.update();
  }

  bounds(): Rect | null {
    return this.area;
  }

  private geometryBounds(): Rect | null {
    if (this.box) return boxBounds(this.box);
    if (this.shape === 'path') {
      // Handles are included so the bitmap always covers what can be dragged.
      const pts = allPoints(this.subpaths);
      if (this.open && this.rubber) pts.push(this.rubber);
      const b = pathBounds(toCmds(this.subpaths));
      const hb = boundsOfPoints(pts);
      return b && hb ? { x: Math.min(b.x, hb.x), y: Math.min(b.y, hb.y), w: Math.max(b.x + b.w, hb.x + hb.w) - Math.min(b.x, hb.x), h: Math.max(b.y + b.h, hb.y + hb.h) - Math.min(b.y, hb.y) } : (hb ?? b);
    }
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
      // A polygon or path still being drawn is finished when committed (e.g. by switching tools).
      if (!this.close()) return;
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
    if ((this.shape !== 'polygon' && this.shape !== 'path') || this.open) return null;
    const b = this.shape === 'path' ? pathBounds(toCmds(this.subpaths)) : boundsOfPoints(this.points);
    if (!b) return null;
    return boxFromRect(rectInflate(b, POINT_BOX_PAD / zoom));
  }

  private editBox(zoom: number): BoxGeom | null {
    return this.box ?? this.pointBox(zoom);
  }

  /** Handles shown for editing: the selected point's, and its neighbours' towards it. */
  private visibleHandles(): { sub: number; index: number; which: 'in' | 'out'; at: Point; anchor: PathAnchor }[] {
    const sel = this.selected;
    if (!sel) return [];
    const s = this.subpaths[sel.sub];
    if (!s) return [];
    const n = s.anchors.length;
    const out: { sub: number; index: number; which: 'in' | 'out'; at: Point; anchor: PathAnchor }[] = [];
    const add = (index: number, which: 'in' | 'out') => {
      const a = s.anchors[index];
      const h = a?.[which];
      if (h) out.push({ sub: sel.sub, index, which, at: h, anchor: a });
    };
    add(sel.index, 'in');
    add(sel.index, 'out');
    const prev = sel.index > 0 ? sel.index - 1 : s.closed ? n - 1 : -1;
    const next = sel.index < n - 1 ? sel.index + 1 : s.closed ? 0 : -1;
    if (prev >= 0 && prev !== sel.index) add(prev, 'out');
    if (next >= 0 && next !== sel.index) add(next, 'in');
    return out;
  }

  private hitPath(p: Point, sp: Point, screen: (q: Point) => Point, zoom: number): ShapeHit | null {
    const tol = 7;
    const near = (q: Point) => {
      const v = screen(q);
      return Math.abs(v.x - sp.x) <= tol && Math.abs(v.y - sp.y) <= tol;
    };
    for (const h of this.visibleHandles()) if (near(h.at)) return { type: 'handle', sub: h.sub, index: h.index, which: h.which };
    for (let si = 0; si < this.subpaths.length; si++) {
      const a = this.subpaths[si].anchors;
      for (let i = 0; i < a.length; i++) if (near(a[i])) return { type: 'anchor', sub: si, index: i };
    }
    const eb = this.pointBox(zoom);
    if (eb) {
      const h = hitHandle(eb, screen, sp, zoom, true, tol);
      if (h && (h === 'rotate' || ['nw', 'ne', 'se', 'sw'].includes(h))) return { type: 'box', handle: h };
    }
    const seg = nearestSegment(this.subpaths, p);
    if (seg && seg.dist <= this.style.width / 2 + 5 / zoom) return { type: 'body' };
    if (this.style.mode !== 'outline') {
      pathHitCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
      const path = new Path2D();
      for (const s of this.subpaths) {
        const pts = flatten(s);
        pts.forEach((q, i) => (i === 0 ? path.moveTo(q.x, q.y) : path.lineTo(q.x, q.y)));
        path.closePath();
      }
      if (pathHitCtx.isPointInPath(path, p.x, p.y, this.fillRule ?? 'evenodd')) return { type: 'body' };
    }
    return null;
  }

  hit(p: Point, sp: Point, screen: (q: Point) => Point, zoom: number): ShapeHit | null {
    if (this.open) return null;
    if (this.shape === 'path') return this.hitPath(p, sp, screen, zoom);
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
    if (hit.type === 'vertex' || hit.type === 'anchor' || hit.type === 'handle') return 'pointer';
    return handleCursor(hit.handle, this.box?.angle ?? 0);
  }

  cursorAt(): string | null {
    return null;
  }

  beginDrag(hit: ShapeHit, at: Point, zoom: number): void {
    this.dragStart = {
      box: hit.type === 'box' && !this.box ? this.pointBox(zoom) : this.box ? { ...this.box } : null,
      points: this.points.map((q) => ({ ...q })),
      subpaths: this.subpaths,
      at,
      hit,
    };
    if (hit.type === 'anchor') this.select({ sub: hit.sub, index: hit.index });
  }

  drag(p: Point, mods: { shift: boolean; alt: boolean }): void {
    const d = this.dragStart;
    if (!d) return;
    const dx = p.x - d.at.x;
    const dy = p.y - d.at.y;
    if (d.hit.type === 'anchor') {
      this.subpaths = moveAnchor(d.subpaths, d.hit.sub, d.hit.index, p);
    } else if (d.hit.type === 'handle') {
      this.subpaths = moveHandle(d.subpaths, d.hit.sub, d.hit.index, d.hit.which, p, mods.alt);
    } else if (d.hit.type === 'body' && this.shape === 'path') {
      this.subpaths = withPoints(d.subpaths, allPoints(d.subpaths).map((q) => ({ x: q.x + dx, y: q.y + dy })));
    } else if (d.hit.type === 'body') {
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
      else if (this.shape === 'path') this.subpaths = withPoints(d.subpaths, transformPoints(allPoints(d.subpaths), d.box, next));
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

  /** Finish a polygon or path that's still being drawn. Returns false if it has too few points. */
  close(): boolean {
    if (!this.open) return true;
    if (this.shape === 'path') {
      const last = this.subpaths[this.subpaths.length - 1];
      if (!last || last.anchors.length < 2) return false;
      this.open = false;
      this.rubber = null;
      this.update();
      this.changed();
      return true;
    }
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

  // ---- paths ---------------------------------------------------------------------------

  private changed(): void {
    this.onPathChange?.();
  }

  select(sel: { sub: number; index: number } | null): void {
    this.selected = sel;
    this.changed();
  }

  pathInfo(): PathInfo {
    const sel = this.selected;
    const sub = this.subpaths[sel?.sub ?? this.subpaths.length - 1];
    const a = sel ? sub?.anchors[sel.index] : undefined;
    return {
      drawing: this.open,
      closed: sub?.closed ?? false,
      selected: a ? { smooth: a.smooth } : null,
      anchors: this.subpaths.reduce((n, s) => n + s.anchors.length, 0),
    };
  }

  /** The pen adds a corner point to the path it is drawing. */
  penAdd(p: Point): void {
    const subs = [...this.subpaths];
    const last = subs[subs.length - 1];
    subs[subs.length - 1] = { ...last, anchors: [...last.anchors, { x: p.x, y: p.y, in: null, out: null, smooth: false }] };
    this.subpaths = subs;
    this.selected = { sub: subs.length - 1, index: subs[subs.length - 1].anchors.length - 1 };
    this.update();
    this.changed();
  }

  /** Dragging after placing a point pulls out its handles (a smooth curve point). */
  penDrag(p: Point): void {
    const si = this.subpaths.length - 1;
    const last = this.subpaths[si];
    const i = last.anchors.length - 1;
    const a = last.anchors[i];
    const anchors = [...last.anchors];
    anchors[i] = { ...a, out: { ...p }, in: { x: 2 * a.x - p.x, y: 2 * a.y - p.y }, smooth: true };
    this.subpaths = this.subpaths.map((s, k) => (k === si ? { ...s, anchors } : s));
    this.update();
    this.changed();
  }

  /** The pointer is on the first point of the path being drawn (a click there closes it). */
  penNearStart(sp: Point, screen: (q: Point) => Point): boolean {
    const last = this.subpaths[this.subpaths.length - 1];
    if (!this.open || !last || last.anchors.length < 2) return false;
    const v = screen(last.anchors[0]);
    return Math.abs(v.x - sp.x) <= 7 && Math.abs(v.y - sp.y) <= 7;
  }

  penClose(): void {
    const si = this.subpaths.length - 1;
    this.subpaths = setClosed(this.subpaths, si, true);
    this.open = false;
    this.rubber = null;
    this.update();
    this.changed();
  }

  /** Take back the last point placed (false when none are left). */
  penUndo(): boolean {
    const si = this.subpaths.length - 1;
    const last = this.subpaths[si];
    if (!last || last.anchors.length <= 1) return false;
    this.subpaths = this.subpaths.map((s, k) => (k === si ? { ...s, anchors: s.anchors.slice(0, -1) } : s));
    this.selected = { sub: si, index: last.anchors.length - 2 };
    this.update();
    this.changed();
    return true;
  }

  /** Make the selected point smooth or a corner. */
  setPointSmooth(smooth: boolean, which = this.selected): void {
    if (!which) return;
    this.subpaths = setSmooth(this.subpaths, which.sub, which.index, smooth);
    this.selected = which;
    this.update();
    this.changed();
  }

  /** Remove the selected point; false if that would leave no path. */
  deleteSelected(): boolean {
    const sel = this.selected;
    if (!sel) return true;
    const next = removeAnchor(this.subpaths, sel.sub, sel.index);
    if (next.length === 0) return false;
    this.subpaths = next;
    this.selected = null;
    this.update();
    this.changed();
    return true;
  }

  /** Close or open the selected point's subpath (or the last one). */
  setClosedPath(closed: boolean): void {
    const si = this.selected?.sub ?? this.subpaths.length - 1;
    if (!this.subpaths[si]) return;
    this.subpaths = setClosed(this.subpaths, si, closed);
    this.update();
    this.changed();
  }

  /** Add a point where p is on the outline (within tolerance); false if it's not near it. */
  insertAt(p: Point, tolerance: number): boolean {
    const seg = nearestSegment(this.subpaths, p);
    if (!seg || seg.dist > tolerance) return false;
    const r = insertAnchor(this.subpaths, seg.sub, seg.seg, seg.t);
    this.subpaths = r.subs;
    this.selected = { sub: seg.sub, index: r.index };
    this.update();
    this.changed();
    return true;
  }

  drawOverlay(ov: Overlay): void {
    const screen = (q: Point) => ov.toScreen(q);
    const zoom = ov.view.zoom;
    if (this.shape === 'path') {
      this.drawPathOverlay(ov, screen, zoom);
      return;
    }
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

  private drawPathOverlay(ov: Overlay, screen: (q: Point) => Point, zoom: number): void {
    for (const s of this.subpaths) ov.outlineScreen(flatten(s).map(screen), s.closed && s.anchors.length > 2);
    const pb = this.pointBox(zoom);
    if (pb) {
      ov.outlineScreen(boxCorners(pb).map(screen), true, true);
      for (const h of ['nw', 'ne', 'se', 'sw'] as const) ov.handle(screen(handlePosition(pb, h, zoom)));
      const top = screen(handlePosition(pb, 'n', zoom));
      const rot = screen(handlePosition(pb, 'rotate', zoom));
      ov.line(top, rot);
      ov.handle(rot, 'circle');
    }
    for (const h of this.visibleHandles()) {
      ov.line(screen(h.anchor), screen(h.at));
      ov.handle(screen(h.at), 'circle');
    }
    this.subpaths.forEach((s, si) =>
      s.anchors.forEach((a, i) => ov.handle(screen(a), 'square', this.selected?.sub === si && this.selected.index === i)),
    );
  }

  dispose(): void {
    this.canvas = null;
    this.onPathChange = null;
  }
}
