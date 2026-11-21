import { toCss } from '../core/color';
import { rectIntersect, rectUnion, type Rect } from '../core/geometry';
import { walkLayers, type GroupLayer, type Layer, type PaintDocument, type RasterLayer, type VectorLayer } from '../doc/Document';
import { drawNodes } from '../vector/render';
import { tiedTrimAt } from '../anim/follow';
import type { Tile } from '../raster/Surface';
import { Surface, TILE_SIZE } from '../raster/Surface';
import type { PixelView } from '../raster/pixels';
import type { View } from './View';
import { pieceSurfaces, repeatAxes, type Piece, type Repeat } from '../anim/piece';
import { matChain, matTranslate } from '../core/matrix';
import type { Placement } from '../anim/space';
import type { Scene } from '../anim/scene';
import { sceneOf } from '../anim/follow';
import { pieceTiling } from '../anim/pieceRaster';
import { sampleProjective, sampleProjectiveBatch } from '../anim/pieceProject';
import type { Tiling } from '../anim/pieceSample';
import { PlaneRenderer } from './PlaneRenderer';
import { drawRuns, hingedIds, piecesByLayer, runSheets } from '../anim/pieceRaster';
import { celShownIndex } from '../anim/cels';
import { paintPuffs, pieceTrailsAt, puffBounds, puffTip, type PuffQuad, type TrailDrawing } from '../anim/trailDraw';
import { subtree } from '../anim/links';
import type { TipMask } from '../brush/tips';

/** Onion-skin tints: drawings before the one shown, and after it. */
const ONION_BEFORE = '#ff6a14';
const ONION_AFTER = '#1f6bff';
/** How strongly pieces show outside the canvas (faded, so it's clear they aren't in the picture). */
const OUTSIDE_ALPHA = 0.4;

const PATTERN_REPEAT: Record<Exclude<Repeat, 'none'>, 'repeat' | 'repeat-x' | 'repeat-y'> = { x: 'repeat-x', y: 'repeat-y', both: 'repeat' };

type Ctx2D = OffscreenCanvasRenderingContext2D;

interface Mirror {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
  tileImages: Map<number, ImageData>;
  /** The surface last uploaded; a different one (merge, undo of a resize) forces a full sync. */
  surface: Surface | null;
  /** Shape layers: the object version last drawn. */
  version: number;
  /** Shape layers with keyed trims: the frame last drawn. */
  frame?: number;
}

/** A piece's GPU copy and the tiles it was last uploaded from. */
interface PieceMirror {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
  tiles: (Tile | null)[];
  /** Goes up whenever its pixels change (a pattern made from it is then out of date). */
  version: number;
  /** The pattern each target draws a repeating piece with (making one copies the whole canvas). */
  patterns: WeakMap<object, { key: string; pattern: CanvasPattern }>;
}

/** Off-screen canvas a group's children are composited into before it is blended as one. */
interface GroupCanvas {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
}

/** Display-only adjustment of the active layer's pixels (stroke preview, floating hole). */
export type LayerFilter = (view: PixelView, r: Rect) => void;

/** Draws live objects into the composite (doc coordinates) right after the active layer. */
export type LiveDrawer = (ctx: Ctx2D, r: Rect) => void;

export interface Theme {
  workspace: string;
  shadow: string;
  checkerA: string;
  checkerB: string;
  pixelGrid: string;
}

function ctx2d(c: OffscreenCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = c.getContext('2d', opts);
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return ctx;
}

/**
 * Owns the GPU-side canvases: one mirror per layer (written only via putImageData), a
 * doc-sized composite updated by dirty rects, and the on-screen view canvas.
 */
export class Renderer {
  private mirrors = new Map<string, Mirror>();
  private groups = new Map<string, GroupCanvas>();
  /** Layers with pieces and a blend mode or opacity are composed here first (isolated). */
  private isolated = new Map<string, GroupCanvas>();
  /** GPU copies of piece pixels, brought up to date tile by tile when they're drawn. */
  private pieceCanvases = new WeakMap<Surface, PieceMirror>();
  /** Pieces tilted or turned in 3D (WebGL2). */
  private planes = new PlaneRenderer();
  /**
   * GPU copies of frame-by-frame drawings, kept so moving between frames needs no upload. The
   * least recently shown go first once they'd take more than CEL_MIRROR_BYTES.
   */
  private celMirrors = new Map<Surface, Mirror & { used: number }>();
  private useClock = 0;
  static CEL_MIRROR_BYTES = 768 * 1024 * 1024;
  private exportFull: GroupCanvas | null = null;
  private exportScaled: GroupCanvas | null = null;
  /** Onion skin on the active frame-by-frame layer (null = off). */
  onion: { count: number; opacity: number } | null = null;
  /** The piece being painted on (its drawings get onion skin too), if any. */
  onionPiece: (() => Piece | null) | null = null;
  /** Onion-skin copies of piece drawings, in each tint, while their tiles are the same. */
  private tints = new WeakMap<Surface, { tiles: readonly (Tile | null)[]; copies: Map<string, Surface> }>();
  private onionScratch: GroupCanvas | null = null;
  /** Pieces per layer for the composite pass under way. */
  private passPieces: Map<string, Piece[]> | null = null;
  /**
   * Trails worked out during one drawing of the screen or an export frame (by frame and piece), so
   * the composite's dirty areas and the pasteboard share them; null outside one.
   */
  private trailPass: Map<string, TrailDrawing[]> | null = null;
  private composite: OffscreenCanvas;
  private compositeCtx: Ctx2D;
  private dirty: Rect | null = null;
  private checker: CanvasPattern | null = null;
  private checkerKey = '';
  readonly viewCanvas: HTMLCanvasElement;
  private viewCtx: CanvasRenderingContext2D;
  dpr = 1;
  theme: Theme = {
    workspace: '#e9e8f0',
    shadow: 'rgba(20, 16, 60, 0.22)',
    checkerA: '#ffffff',
    checkerB: '#d9d8e2',
    pixelGrid: 'rgba(120, 120, 140, 0.45)',
  };
  showPixelGrid = true;
  /** Show the parts of pieces beyond the canvas, faded (screen only). */
  piecesOutside = true;
  activeFilters: LayerFilter[] = [];
  /** A reference image over the canvas (view only: not in the composite, never exported). */
  reference: { canvas: OffscreenCanvas; x: number; y: number; w: number; h: number; scale: number; opacity: number } | null = null;
  liveDrawer: LiveDrawer | null = null;
  /** True while the user is drawing/panning; trades downscale quality for speed. */
  interactive = false;

  constructor(
    private doc: PaintDocument,
    private readonly view: View,
  ) {
    this.composite = new OffscreenCanvas(doc.width, doc.height);
    this.compositeCtx = ctx2d(this.composite);
    this.viewCanvas = document.createElement('canvas');
    this.viewCanvas.className = 'pg-view-canvas';
    const vctx = this.viewCanvas.getContext('2d', { alpha: false });
    if (!vctx) throw new Error('Canvas 2D unavailable');
    this.viewCtx = vctx;
    this.resetDocument(doc);
  }

  /** Rebuild every GPU canvas for a new or resized document. */
  resetDocument(doc: PaintDocument): void {
    this.doc = doc;
    this.mirrors.clear();
    this.groups.clear();
    this.isolated.clear();
    this.celMirrors.clear();
    if (this.composite.width !== doc.width || this.composite.height !== doc.height) {
      this.composite = new OffscreenCanvas(doc.width, doc.height);
      this.compositeCtx = ctx2d(this.composite);
    }
    this.syncTree();
  }

  /**
   * After the layer tree changed: upload layers that are new or whose surface was replaced,
   * drop canvases of removed layers, and recomposite everything.
   */
  syncTree(): void {
    const live = new Set<string>();
    const liveCels = new Set<Surface>();
    for (const layer of walkLayers(this.doc.layers)) {
      live.add(layer.id);
      if (layer.kind === 'vector') {
        this.drawVector(layer);
        continue;
      }
      if (layer.kind !== 'raster') continue;
      if (layer.cels) {
        // Frame-by-frame: the drawing shown has its own GPU copy (uploaded once, then kept).
        this.mirrors.delete(layer.id);
        for (const c of layer.cels) liveCels.add(c.surface);
      }
      const m = layer.cels ? this.celMirrors.get(layer.surface) : this.mirrors.get(layer.id);
      if (!m || m.surface !== layer.surface || m.canvas.width !== this.doc.width || m.canvas.height !== this.doc.height) {
        this.syncLayer(layer, null);
      }
    }
    for (const id of [...this.mirrors.keys()]) if (!live.has(id)) this.mirrors.delete(id);
    for (const id of [...this.groups.keys()]) if (!live.has(id)) this.groups.delete(id);
    for (const id of [...this.isolated.keys()]) if (!live.has(id)) this.isolated.delete(id);
    // Drawings no longer in the picture (deleted, cleared, or replaced by a resize) let their copies go.
    for (const s of [...this.celMirrors.keys()]) if (!liveCels.has(s)) this.celMirrors.delete(s);
    // Textures of pieces that are gone (undo can bring a piece back: it's uploaded again then).
    this.planes.retain(new Set(this.doc.pieces.flatMap((p) => pieceSurfaces(p))));
    this.invalidate(null);
  }

  /** Redraw a shape layer's canvas from its objects if they changed since last time. */
  /** Draw a shape layer's objects into its copy (at `frame`, for keyed trims) if they changed since. */
  private drawVector(layer: VectorLayer, frame = this.doc.timeline.frame): boolean {
    const m = this.mirrorFor(layer);
    if (m.version === layer.version && (!layer.keyed || m.frame === frame)) return false;
    m.ctx.setTransform(1, 0, 0, 1, 0, 0);
    m.ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
    drawNodes(m.ctx, layer.objects, this.doc.width, this.doc.height, layer.keyed ? (s) => tiedTrimAt(this.doc, layer.id, s, frame) : null);
    m.version = layer.version;
    m.frame = frame;
    return true;
  }

  /** A shape layer changed: redraw it and recomposite. */
  syncVector(layer: VectorLayer): void {
    if (this.drawVector(layer)) this.invalidate(null);
  }

  private mirrorFor(layer: RasterLayer | VectorLayer): Mirror {
    if (layer.kind === 'raster' && layer.cels) return this.celMirror(layer.surface);
    let m = this.mirrors.get(layer.id);
    if (!m || m.canvas.width !== this.doc.width || m.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      m = { canvas, ctx: ctx2d(canvas), tileImages: new Map(), surface: null, version: -1 };
      this.mirrors.set(layer.id, m);
    }
    return m;
  }

  private groupCanvas(group: GroupLayer): GroupCanvas {
    let g = this.groups.get(group.id);
    if (!g || g.canvas.width !== this.doc.width || g.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      g = { canvas, ctx: ctx2d(canvas) };
      this.groups.set(group.id, g);
    }
    return g;
  }

  private isolatedCanvas(id: string): GroupCanvas {
    let g = this.isolated.get(id);
    if (!g || g.canvas.width !== this.doc.width || g.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      g = { canvas, ctx: ctx2d(canvas) };
      this.isolated.set(id, g);
    }
    return g;
  }

  /**
   * A piece's GPU copy. Painting, undo and redo give a changed tile a new array, so comparing
   * the tiles with the ones last uploaded finds what to upload again; `pieceChanged` covers a
   * stroke still writing into the same tiles.
   */
  private pieceCanvas(s: Surface): OffscreenCanvas {
    let m = this.pieceCanvases.get(s);
    if (!m) {
      const canvas = new OffscreenCanvas(s.width, s.height);
      // A new canvas is transparent, which is what empty tiles are.
      m = { canvas, ctx: ctx2d(canvas), tiles: s.tiles.map(() => null), version: 0, patterns: new WeakMap() };
      this.pieceCanvases.set(s, m);
    }
    for (let i = 0; i < s.tiles.length; i++) if (m.tiles[i] !== s.tiles[i]) this.uploadPieceTile(m, s, i);
    return m.canvas;
  }

  /** The pattern a repeating piece is drawn with on `ctx`, made again only when its pixels change. */
  private piecePattern(ctx: Ctx2D | CanvasRenderingContext2D, s: Surface, repeat: Exclude<Repeat, 'none'>): CanvasPattern | null {
    const canvas = this.pieceCanvas(s);
    const m = this.pieceCanvases.get(s)!;
    const key = `${repeat}:${m.version}`;
    const hit = m.patterns.get(ctx);
    if (hit?.key === key) return hit.pattern;
    const pattern = ctx.createPattern(canvas, PATTERN_REPEAT[repeat]);
    if (pattern) m.patterns.set(ctx, { key, pattern });
    return pattern;
  }

  private uploadPieceTile(m: PieceMirror, s: Surface, i: number): void {
    const tile = s.tiles[i];
    const r = s.tileRect(i);
    m.tiles[i] = tile;
    m.version++;
    if (!tile) m.ctx.clearRect(r.x, r.y, r.w, r.h);
    else m.ctx.putImageData(new ImageData(tile as Uint8ClampedArray<ArrayBuffer>, TILE_SIZE, TILE_SIZE), r.x, r.y, 0, 0, r.w, r.h);
  }

  /** A piece's pixels changed inside r (its own pixels) without new tiles (a stroke under way). */
  pieceChanged(s: Surface, r: Rect): void {
    this.planes.touch(s, r);
    const m = this.pieceCanvases.get(s);
    if (!m) return;
    const tx0 = Math.max(0, Math.floor(r.x / TILE_SIZE));
    const ty0 = Math.max(0, Math.floor(r.y / TILE_SIZE));
    const tx1 = Math.min(s.cols - 1, Math.floor((r.x + r.w - 1) / TILE_SIZE));
    const ty1 = Math.min(s.rows - 1, Math.floor((r.y + r.h - 1) / TILE_SIZE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.uploadPieceTile(m, s, ty * s.cols + tx);
  }

  /**
   * Draw pieces as they are at the current frame (r = only those touching it; alpha scales
   * them). A repeating piece fills r with its tiles (`area` when r is null: the whole picture
   * unless the caller says what's showing).
   */
  private drawPieces(
    ctx: Ctx2D | CanvasRenderingContext2D,
    pieces: readonly Piece[],
    r: Rect | null,
    alpha = 1,
    frame = this.doc.timeline.frame,
    area: Rect = r ?? { x: 0, y: 0, w: this.doc.width, h: this.doc.height },
  ): void {
    const scene = sceneOf(this.doc, frame);
    // Trails reach far beyond their pieces: the pieces (and groups) on this layer that leave one.
    const layerId = pieces[0]?.layerId;
    const owners = layerId === undefined ? [] : this.doc.pieces.filter((q) => q.layerId === layerId && q.trails.length > 0);
    const trails = new Map(owners.map((q) => [q.id, this.trailsAt(q, frame)]));
    const groups = owners.filter((q) => q.kind === 'group');
    const shown = (p: Piece) => scene.shows(p) && (!r || scene.touches(p, r));
    const order = scene.backToFront(pieces).filter((p) => shown(p) || trails.has(p.id));
    // A group's trail goes behind (or in front of) its whole tree; a piece's just behind (or in front of) it.
    for (const g of groups) this.drawTrails(ctx, g, trails.get(g.id)!, false, area, alpha);
    for (const run of drawRuns(order, hingedIds(this.doc.pieces))) {
      for (const p of run) this.drawTrails(ctx, p, trails.get(p.id), false, area, alpha);
      const visible = run.filter(shown);
      if (visible.length > 1) this.drawJoined(ctx, visible, scene, area, alpha);
      else if (visible.length === 1) this.drawOne(ctx, visible[0], scene, area, alpha);
      for (const p of run) this.drawTrails(ctx, p, trails.get(p.id), true, area, alpha);
    }
    for (const g of groups) this.drawTrails(ctx, g, trails.get(g.id)!, true, area, alpha);
  }

  /** A piece's trails at a frame, worked out once a drawing. */
  private trailsAt(p: Piece, frame: number): TrailDrawing[] {
    const key = `${frame} ${p.id}`;
    const hit = this.trailPass?.get(key);
    if (hit) return hit;
    const d = pieceTrailsAt(this.doc, p, frame);
    this.trailPass?.set(key, d);
    return d;
  }

  /** One piece as `scene` has it, inside `area`, at `alpha` times its own opacity. */
  private drawOne(ctx: Ctx2D | CanvasRenderingContext2D, p: Piece, scene: Scene, area: Rect, alpha: number, src: Surface = scene.src(p)): void {
    const { state: st, placement: pl, opacity } = scene.pose(p);
    ctx.save();
    ctx.globalAlpha = opacity * alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!pl.affine) {
      // Tilted or turned: a true perspective image needs the GPU (or the CPU path if it can't).
      const tiling = pieceTiling(p, st);
      const where = tiling ? area : rectIntersect(area, scene.bounds(p));
      const shade = scene.shade(p, this.doc.light);
      if (where && !this.planes.draw(ctx, src, pl, tiling, where, shade)) this.drawOnCpu(ctx, src, pl, tiling, where, shade);
      ctx.restore();
      return;
    }
    const m = pl.affine;
    if (p.repeat === 'none') {
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(this.pieceCanvas(src), 0, 0);
    } else if (!this.planes.draw(ctx, src, pl, pieceTiling(p, st), area, 1)) {
      // On the GPU it's one pass over what's showing (a pattern from a picture this big is slow to
      // fill); without it, tiles as a pattern in the piece's own space, slid by its scroll on the
      // axes it repeats along.
      const pat = this.piecePattern(ctx, src, p.repeat);
      if (pat) {
        const ax = repeatAxes(p.repeat);
        const t = matChain(matTranslate(ax.x ? st.scrollX : 0, ax.y ? st.scrollY : 0), m);
        pat.setTransform(new DOMMatrix([t[0], t[1], t[2], t[3], t[4], t[5]]));
        ctx.fillStyle = pat;
        ctx.fillRect(area.x, area.y, area.w, area.h);
      }
    }
    ctx.restore();
  }

  /**
   * A piece's trails that go behind it (or in front): puffs on the GPU (the CPU if it can't), and
   * echoes as the piece (a group: its pieces) drawn again as it was a few frames back.
   */
  private drawTrails(ctx: Ctx2D | CanvasRenderingContext2D, p: Piece, drawings: readonly TrailDrawing[] | undefined, front: boolean, area: Rect, alpha: number): void {
    if (!drawings) return;
    for (const d of drawings) {
      if (d.trail.front !== front) continue;
      if (d.trail.kind === 'echo') {
        const shapes = p.kind === 'group' ? subtree(this.doc.pieces, p.id).filter((q) => q.kind === 'piece') : [p];
        for (const copy of d.echoes) {
          const then = sceneOf(this.doc, copy.frame);
          for (const q of then.backToFront(shapes)) if (then.shows(q)) this.drawOne(ctx, q, then, area, alpha * copy.opacity);
        }
        continue;
      }
      const tip = puffTip(d.trail.brush);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (!this.planes.drawPuffs(ctx, d.puffs, tip, area)) this.drawPuffsOnCpu(ctx, d.puffs, tip, area);
      ctx.restore();
    }
  }

  /** Puffs drawn by the CPU (no GPU): painted at document resolution, then laid over the target. */
  private drawPuffsOnCpu(ctx: Ctx2D | CanvasRenderingContext2D, puffs: readonly PuffQuad[], tip: TipMask, area: Rect): void {
    let b: Rect | null = null;
    for (const q of puffs) b = rectUnion(b, puffBounds(q));
    const where = b && rectIntersect(b, area);
    if (!where || where.w <= 0 || where.h <= 0) return;
    const view = { data: new Uint8ClampedArray(where.w * where.h * 4), stride: where.w, ox: where.x, oy: where.y };
    paintPuffs(view, where, puffs, tip);
    const c = new OffscreenCanvas(where.w, where.h);
    c.getContext('2d')!.putImageData(new ImageData(view.data, where.w, where.h), 0, 0);
    ctx.drawImage(c, where.x, where.y);
  }

  /**
   * Hinged faces next to each other in drawing order, drawn as one picture (on the GPU, or by the
   * CPU path if it can't), so their seams are as solid as the faces.
   */
  private drawJoined(ctx: Ctx2D | CanvasRenderingContext2D, run: readonly Piece[], scene: Scene, area: Rect, alpha: number): void {
    const sheets = runSheets(run, scene, this.doc.light);
    let where: Rect | null = null;
    for (const s of sheets) where = rectUnion(where, s.bounds);
    where = where && rectIntersect(area, where);
    if (!where) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!this.planes.drawBatch(ctx, sheets, where)) {
      const img = sampleProjectiveBatch(sheets, where);
      if (img.w > 0 && img.h > 0) {
        const c = new OffscreenCanvas(img.w, img.h);
        ctx2d(c).putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0);
        ctx.drawImage(c, img.x, img.y);
      }
    }
    ctx.restore();
  }

  /** A piece in 3D drawn by the CPU path when the GPU can't (no WebGL2, or the GPU reset). */
  private drawOnCpu(ctx: Ctx2D | CanvasRenderingContext2D, src: Surface, pl: Placement, tiling: Tiling | null, where: Rect, shade: number): void {
    const img = sampleProjective(src, pl, where, tiling, tiling ? null : where, shade);
    if (img.w === 0 || img.h === 0) return;
    const c = new OffscreenCanvas(img.w, img.h);
    ctx2d(c).putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.w, img.h), 0, 0);
    ctx.drawImage(c, img.x, img.y);
  }

  /** True when pieces in 3D are drawn on the GPU (false: the CPU path stands in). */
  get gpuPlanes(): boolean {
    return this.planes.ready;
  }

  /** The GPU copy of one frame-by-frame drawing (made empty if it's new or was let go). */
  private celMirror(surface: Surface): Mirror {
    let m = this.celMirrors.get(surface);
    if (!m || m.canvas.width !== this.doc.width || m.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      m = { canvas, ctx: ctx2d(canvas), tileImages: new Map(), surface: null, version: -1, used: 0 };
      this.celMirrors.set(surface, m);
      this.trimCelMirrors();
    }
    m.used = ++this.useClock;
    return m;
  }

  /** Let the least recently shown drawings' GPU copies go while they take too much memory. */
  private trimCelMirrors(): void {
    const each = this.doc.width * this.doc.height * 4;
    const shown = new Set(this.doc.rasterLayers().map((l) => l.surface));
    let over = this.celMirrors.size * each - Renderer.CEL_MIRROR_BYTES;
    if (over <= 0) return;
    const old = [...this.celMirrors.entries()].filter(([s]) => !shown.has(s)).sort((a, b) => a[1].used - b[1].used);
    for (const [s] of old) {
      if (over <= 0) break;
      this.celMirrors.delete(s);
      over -= each;
    }
  }

  /** How many frame-by-frame drawings have a GPU copy (for tests and the performance overlay). */
  get celMirrorCount(): number {
    return this.celMirrors.size;
  }

/**
   * The picture at `frame` for an export, drawn on the GPU with the same compositing as the screen
   * (no onion skin, live objects, guides or selection), at w × h, on `background` (null =
   * see-through). The returned canvas is reused by the next call.
   */
  frameCanvas(frame: number, w: number, h: number, background: string | null): OffscreenCanvas {
    const dw = this.doc.width;
    const dh = this.doc.height;
    if (!this.exportFull || this.exportFull.canvas.width !== dw || this.exportFull.canvas.height !== dh) {
      const canvas = new OffscreenCanvas(dw, dh);
      this.exportFull = { canvas, ctx: ctx2d(canvas) };
    }
    const full = this.exportFull.ctx;
    const r = { x: 0, y: 0, w: dw, h: dh };
    full.save();
    full.clearRect(0, 0, dw, dh);
    if (background) {
      full.fillStyle = background;
      full.fillRect(0, 0, dw, dh);
    }
    this.passPieces = this.doc.pieces.length ? piecesByLayer(this.doc.pieces) : null;
    this.trailPass = new Map();
    this.drawLayers(full, this.doc.layers, r, frame);
    this.trailPass = null;
    this.passPieces = null;
    full.restore();
    // Shared canvases (groups, isolated layers) were drawn for this frame: redraw the screen later.
    this.invalidate(null);
    if (w === dw && h === dh) return this.exportFull.canvas;
    if (!this.exportScaled || this.exportScaled.canvas.width !== w || this.exportScaled.canvas.height !== h) {
      const canvas = new OffscreenCanvas(w, h);
      this.exportScaled = { canvas, ctx: ctx2d(canvas) };
    }
    const sc = this.exportScaled.ctx;
    sc.clearRect(0, 0, w, h);
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(this.exportFull.canvas, 0, 0, w, h);
    return this.exportScaled.canvas;
  }

  /** Mirror canvas of a raster layer, if it exists. */
  layerCanvas(id: string): OffscreenCanvas | null {
    const l = this.doc.layerById(id);
    if (l?.kind === 'raster' && l.cels) return this.celMirrors.get(l.surface)?.canvas ?? null;
    return this.mirrors.get(id)?.canvas ?? null;
  }

  /**
   * Scaled preview of one layer for the Layers panel (a group shows its children composited,
   * ignoring the group's own opacity so the thumbnail stays readable).
   */
  drawLayerThumbnail(layer: Layer, target: CanvasRenderingContext2D, w: number, h: number): void {
    target.save();
    target.clearRect(0, 0, w, h);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'medium';
    const draw = (l: Layer, top: boolean): void => {
      if (!top && !l.visible) return;
      if (l.kind === 'raster' || l.kind === 'vector') {
        const m = l.kind === 'raster' && l.cels ? this.celMirrors.get(l.surface) : this.mirrors.get(l.id);
        if (!m) return;
        target.globalAlpha = top ? 1 : l.opacity;
        target.globalCompositeOperation = top || l.blend === 'normal' ? 'source-over' : l.blend;
        target.drawImage(m.canvas, 0, 0, this.doc.width, this.doc.height, 0, 0, w, h);
        const pieces = this.doc.pieces.filter((p) => p.layerId === l.id && p.kind === 'piece');
        if (pieces.length) {
          target.save();
          target.scale(w / this.doc.width, h / this.doc.height);
          this.drawPieces(target, pieces, null, target.globalAlpha);
          target.restore();
        }
      } else {
        for (const c of l.children) draw(c, false);
      }
    };
    draw(layer, true);
    target.restore();
  }

  /** Upload a layer's tiles inside r (null = all) to its mirror canvas. */
  syncLayer(layer: RasterLayer, r: Rect | null): void {
    const docRect = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const area = r ? rectIntersect(r, docRect) : docRect;
    if (!area) return;
    const m = this.mirrorFor(layer);
    if (m.surface !== layer.surface) {
      m.tileImages.clear();
      m.surface = layer.surface;
    }
    const isActive = layer === this.doc.activeLayer;
    if (isActive && this.activeFilters.length > 0) {
      // Filtered path: read tiles, apply display filters, upload one rect.
      const buf = layer.surface.readRect(area);
      const view: PixelView = { data: buf, stride: area.w, ox: area.x, oy: area.y };
      for (const f of this.activeFilters) f(view, area);
      m.ctx.putImageData(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, area.w, area.h), area.x, area.y);
    } else {
      this.upload(m, layer.surface, area);
    }
    this.invalidate(area);
  }

  /** Upload a surface's tiles inside area to a mirror. */
  private upload(m: Mirror, s: Surface, area: Rect): void {
    const tx0 = Math.floor(area.x / TILE_SIZE);
    const ty0 = Math.floor(area.y / TILE_SIZE);
    const tx1 = Math.floor((area.x + area.w - 1) / TILE_SIZE);
    const ty1 = Math.floor((area.y + area.h - 1) / TILE_SIZE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * s.cols + tx;
        const sub = rectIntersect(area, s.tileRect(i))!;
        const tile = s.tiles[i];
        if (!tile) {
          m.ctx.clearRect(sub.x, sub.y, sub.w, sub.h);
          continue;
        }
        // Wrap the tile memory directly (no copy) and upload just the dirty sub-rect.
        let img = m.tileImages.get(i);
        if (!img || img.data !== tile) {
          img = new ImageData(tile as Uint8ClampedArray<ArrayBuffer>, TILE_SIZE, TILE_SIZE);
          m.tileImages.set(i, img);
        }
        m.ctx.putImageData(img, tx * TILE_SIZE, ty * TILE_SIZE, sub.x - tx * TILE_SIZE, sub.y - ty * TILE_SIZE, sub.w, sub.h);
      }
    }
  }

  /** A drawing's GPU copy, uploaded first if it hasn't been (onion skin shows drawings not on show). */
  private drawingCanvas(s: Surface): OffscreenCanvas {
    const m = this.celMirror(s);
    if (m.surface !== s) {
      m.tileImages.clear();
      m.surface = s;
      this.upload(m, s, { x: 0, y: 0, w: this.doc.width, h: this.doc.height });
    }
    return m.canvas;
  }

  /**
   * Onion skin: the active frame-by-frame layer's drawings before (orange) and after (blue) the
   * one shown, fainter the further away, drawn just under it. Screen only: exports never see it.
   */
  private drawOnion(ctx: Ctx2D, layer: RasterLayer, r: Rect): void {
    const o = this.onion;
    if (!o || !layer.cels || layer.cels.length < 2) return;
    const cels = layer.cels;
    const at = celShownIndex(cels, layer.celLoop, this.doc.timeline.frame);
    if (!this.onionScratch || this.onionScratch.canvas.width !== this.doc.width || this.onionScratch.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      this.onionScratch = { canvas, ctx: ctx2d(canvas) };
    }
    const sc = this.onionScratch.ctx;
    for (let k = o.count; k >= 1; k--) {
      for (const [j, tint] of [
        [at - k, ONION_BEFORE],
        [at + k, ONION_AFTER],
      ] as const) {
        if (j < 0 || j >= cels.length) continue;
        const src = this.drawingCanvas(cels[j].surface);
        sc.save();
        sc.globalCompositeOperation = 'copy';
        sc.drawImage(src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        sc.globalCompositeOperation = 'source-in';
        sc.fillStyle = tint;
        sc.fillRect(r.x, r.y, r.w, r.h);
        sc.restore();
        ctx.globalAlpha = o.opacity * ((o.count - k + 1) / o.count);
        ctx.drawImage(this.onionScratch.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Onion skin of the piece being painted on, when it's drawn frame by frame: its drawings before
   * and after the one on show, tinted, where the piece is now (on screen only).
   */
  private drawPieceOnion(ctx: Ctx2D, layer: RasterLayer, r: Rect): void {
    const o = this.onion;
    const p = this.onionPiece?.();
    if (!o || !p || p.layerId !== layer.id || !p.drawings || p.drawings.length < 2) return;
    const frame = this.doc.timeline.frame;
    const at = celShownIndex(p.drawings, p.drawingLoop, frame);
    const scene = sceneOf(this.doc, frame);
    if (!scene.shows(p)) return;
    for (let k = o.count; k >= 1; k--) {
      for (const [j, tint] of [
        [at - k, ONION_BEFORE],
        [at + k, ONION_AFTER],
      ] as const) {
        if (j < 0 || j >= p.drawings.length) continue;
        this.drawOne(ctx, p, scene, r, o.opacity * ((o.count - k + 1) / o.count), this.tinted(p.drawings[j].surface, tint));
      }
    }
  }

  /** A drawing in one colour (its shape kept), for onion skin. */
  private tinted(s: Surface, tint: string): Surface {
    let hit = this.tints.get(s);
    if (!hit || hit.tiles.length !== s.tiles.length || hit.tiles.some((t, i) => t !== s.tiles[i])) {
      hit = { tiles: [...s.tiles], copies: new Map() };
      this.tints.set(s, hit);
    }
    let copy = hit.copies.get(tint);
    if (!copy) {
      const n = parseInt(tint.slice(1), 16);
      const data = s.toRGBA();
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (n >> 16) & 255;
        data[i + 1] = (n >> 8) & 255;
        data[i + 2] = n & 255;
      }
      copy = Surface.fromRGBA(s.width, s.height, data);
      hit.copies.set(tint, copy);
    }
    return copy;
  }

  invalidate(r: Rect | null): void {
    const docRect = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    this.dirty = rectUnion(this.dirty, r ? rectIntersect(r, docRect) : docRect);
  }

  get compositeCanvas(): OffscreenCanvas {
    return this.composite;
  }

  /** Recomposite the dirty area: paper, then each visible layer, live objects after active. */
  private flushComposite(): void {
    const r = this.dirty;
    this.dirty = null;
    if (!r) return;
    const ctx = this.compositeCtx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.clearRect(r.x, r.y, r.w, r.h);
    if (this.doc.paper) {
      ctx.fillStyle = toCss(this.doc.paper);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    this.passPieces = this.doc.pieces.length ? piecesByLayer(this.doc.pieces) : null;
    this.drawLayers(ctx, this.doc.layers, r);
    this.passPieces = null;
    ctx.restore();
  }

  /** Draw a layer list into ctx inside r. Groups render into their own canvas first. */
  private drawLayers(ctx: Ctx2D, layers: Layer[], r: Rect, exportFrame: number | null = null): void {
    const active = this.doc.activeLayer;
    const frame = exportFrame ?? this.doc.timeline.frame;
    for (const layer of layers) {
      if (layer.visible) {
        if (exportFrame === null && layer === active && layer.kind === 'raster') this.drawOnion(ctx, layer, r);
        if (exportFrame === null && layer.kind === 'raster') this.drawPieceOnion(ctx, layer, r);
        let source: OffscreenCanvas;
        // Pieces drawn straight over the layer (same result when it's normal at full opacity).
        let over: Piece[] | null = null;
        if (layer.kind === 'raster') {
          // Another frame's drawing comes from its own GPU copy.
          source = exportFrame !== null && layer.cels ? this.drawingCanvas(layer.cels[celShownIndex(layer.cels, layer.celLoop, exportFrame)].surface) : this.mirrorFor(layer).canvas;
          const pieces = this.passPieces?.get(layer.id);
          if (pieces?.length && layer.blend === 'normal' && layer.opacity === 1) over = pieces;
          else if (pieces?.length) {
            const iso = this.isolatedCanvas(layer.id);
            iso.ctx.save();
            iso.ctx.beginPath();
            iso.ctx.rect(r.x, r.y, r.w, r.h);
            iso.ctx.clip();
            iso.ctx.clearRect(r.x, r.y, r.w, r.h);
            iso.ctx.drawImage(source, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
            this.drawPieces(iso.ctx, pieces, r, 1, frame);
            iso.ctx.restore();
            source = iso.canvas;
          }
        } else if (layer.kind === 'vector') {
          this.drawVector(layer, frame);
          source = this.mirrorFor(layer).canvas;
        } else {
          const g = this.groupCanvas(layer);
          g.ctx.save();
          g.ctx.beginPath();
          g.ctx.rect(r.x, r.y, r.w, r.h);
          g.ctx.clip();
          g.ctx.clearRect(r.x, r.y, r.w, r.h);
          this.drawLayers(g.ctx, layer.children, r, exportFrame);
          g.ctx.restore();
          source = g.canvas;
        }
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
        ctx.drawImage(source, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (over) this.drawPieces(ctx, over, r, 1, frame);
      }
      // Live objects (shape being drawn, floating pixels) sit right above the active layer.
      if (exportFrame === null && layer === active && this.liveDrawer) this.liveDrawer(ctx, r);
    }
  }

  resizeView(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.viewCanvas.width !== w || this.viewCanvas.height !== h) {
      this.viewCanvas.width = w;
      this.viewCanvas.height = h;
    }
    this.viewCanvas.style.width = `${cssW}px`;
    this.viewCanvas.style.height = `${cssH}px`;
  }

  private checkerPattern(): CanvasPattern | null {
    const size = Math.max(4, Math.round(8 * this.dpr));
    const key = `${size}|${this.theme.checkerA}|${this.theme.checkerB}`;
    if (this.checker && this.checkerKey === key) return this.checker;
    const c = new OffscreenCanvas(size * 2, size * 2);
    const g = ctx2d(c);
    g.fillStyle = this.theme.checkerA;
    g.fillRect(0, 0, size * 2, size * 2);
    g.fillStyle = this.theme.checkerB;
    g.fillRect(0, 0, size, size);
    g.fillRect(size, size, size, size);
    this.checker = this.viewCtx.createPattern(c, 'repeat');
    this.checkerKey = key;
    return this.checker;
  }

  /** Draw the workspace, document and pixel grid to the screen. */
  render(): void {
    this.trailPass = new Map();
    try {
      this.renderPass();
    } finally {
      this.trailPass = null;
    }
  }

  private renderPass(): void {
    this.flushComposite();
    const ctx = this.viewCtx;
    const { dpr, view } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.theme.workspace;
    ctx.fillRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
    if (view.rotation !== 0) {
      // A turned view: the page is drawn as usual, about the viewport's centre.
      ctx.translate((view.width / 2) * dpr, (view.height / 2) * dpr);
      ctx.rotate((view.rotation * Math.PI) / 180);
      ctx.translate((-view.width / 2) * dpr, (-view.height / 2) * dpr);
    }

    const d = view.docRectOnScreen();
    const x = Math.round(d.x * dpr);
    const y = Math.round(d.y * dpr);
    const w = Math.round((d.x + d.w) * dpr) - x;
    const h = Math.round((d.y + d.h) * dpr) - y;

    // Soft shadow under the page.
    ctx.save();
    ctx.shadowColor = this.theme.shadow;
    ctx.shadowBlur = 14 * dpr;
    ctx.shadowOffsetY = 3 * dpr;
    ctx.fillStyle = this.theme.checkerA;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    if (!this.doc.paper || this.doc.paper.a < 255) {
      const pat = this.checkerPattern();
      if (pat) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }

    // Only draw the visible part of the composite.
    const vis = view.visibleDocRect();
    if (vis) {
      const z = view.zoom * dpr;
      ctx.imageSmoothingEnabled = view.zoom < 2;
      // High-quality downscaling of a huge canvas is costly: use it only when idle.
      ctx.imageSmoothingQuality = this.interactive ? 'low' : 'high';
      ctx.drawImage(
        this.composite,
        vis.x,
        vis.y,
        vis.w,
        vis.h,
        d.x * dpr + vis.x * z,
        d.y * dpr + vis.y * z,
        vis.w * z,
        vis.h * z,
      );

      if (this.showPixelGrid && view.zoom >= 8) {
        ctx.beginPath();
        for (let px = vis.x; px <= vis.x + vis.w; px++) {
          const sx = Math.round(d.x * dpr + px * z) + 0.5;
          ctx.moveTo(sx, Math.max(0, d.y * dpr + vis.y * z));
          ctx.lineTo(sx, d.y * dpr + (vis.y + vis.h) * z);
        }
        for (let py = vis.y; py <= vis.y + vis.h; py++) {
          const sy = Math.round(d.y * dpr + py * z) + 0.5;
          ctx.moveTo(Math.max(0, d.x * dpr + vis.x * z), sy);
          ctx.lineTo(d.x * dpr + (vis.x + vis.w) * z, sy);
        }
        ctx.strokeStyle = this.theme.pixelGrid;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    if (this.piecesOutside && this.doc.pieces.length) this.drawOutside(ctx, { x, y, w, h });

    const ref = this.reference;
    if (ref) {
      const z = view.zoom * dpr;
      ctx.save();
      ctx.globalAlpha = ref.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(ref.canvas, d.x * dpr + ref.x * z, d.y * dpr + ref.y * z, ref.w * ref.scale * z, ref.h * ref.scale * z);
      ctx.restore();
    }
  }

  /**
   * The parts of pieces beyond the canvas, faded, on the workspace around the page (`page` is
   * where it's drawn on the view canvas), so they can be seen and grabbed there. Never exported.
   */
  private drawOutside(ctx: CanvasRenderingContext2D, page: Rect): void {
    const frame = this.doc.timeline.frame;
    const scene = sceneOf(this.doc, frame);
    const { width: dw, height: dh } = this.doc;
    const out: Piece[] = [];
    for (const layer of walkLayers(this.doc.layers)) {
      if (layer.kind !== 'raster' || !this.doc.isEffectivelyVisible(layer.id)) continue;
      for (const p of this.doc.pieces) {
        if (p.layerId !== layer.id || p.kind !== 'piece') continue;
        const b = scene.bounds(p);
        if (p.repeat !== 'none' || b.x < 0 || b.y < 0 || b.x + b.w > dw || b.y + b.h > dh) out.push(p);
      }
    }
    if (!out.length) return;
    const z = this.view.zoom * this.dpr;
    const d = this.view.docRectOnScreen();
    ctx.save();
    // Everywhere but the page.
    const far = 1e7;
    ctx.beginPath();
    ctx.rect(-far, -far, 2 * far, 2 * far);
    ctx.rect(page.x, page.y, page.w, page.h);
    ctx.clip('evenodd');
    ctx.transform(z, 0, 0, z, d.x * this.dpr, d.y * this.dpr);
    this.drawPieces(ctx, out, null, OUTSIDE_ALPHA, frame, this.viewportInDoc());
    ctx.restore();
  }

  /** The viewport in document pixels (what a repeating piece needs to fill), turned view included. */
  private viewportInDoc(): Rect {
    const v = this.view;
    const c = [v.toDoc(0, 0), v.toDoc(v.width, 0), v.toDoc(0, v.height), v.toDoc(v.width, v.height)];
    const x0 = Math.floor(Math.min(...c.map((p) => p.x))) - 1;
    const y0 = Math.floor(Math.min(...c.map((p) => p.y))) - 1;
    return { x: x0, y: y0, w: Math.ceil(Math.max(...c.map((p) => p.x))) + 1 - x0, h: Math.ceil(Math.max(...c.map((p) => p.y))) + 1 - y0 };
  }

  /** Scaled snapshot of the composite for the navigator. */
  drawThumbnail(target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): void {
    this.flushComposite();
    target.clearRect(0, 0, w, h);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.composite, 0, 0, this.doc.width, this.doc.height, 0, 0, w, h);
  }
}
