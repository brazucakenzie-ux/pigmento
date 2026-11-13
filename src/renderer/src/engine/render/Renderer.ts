import { toCss } from '../core/color';
import { rectIntersect, rectUnion, type Rect } from '../core/geometry';
import { walkLayers, type GroupLayer, type Layer, type PaintDocument, type RasterLayer, type VectorLayer } from '../doc/Document';
import { drawNodes } from '../vector/render';
import type { Surface } from '../raster/Surface';
import { TILE_SIZE } from '../raster/Surface';
import type { PixelView } from '../raster/pixels';
import type { View } from './View';

type Ctx2D = OffscreenCanvasRenderingContext2D;

interface Mirror {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
  tileImages: Map<number, ImageData>;
  /** The surface last uploaded; a different one (merge, undo of a resize) forces a full sync. */
  surface: Surface | null;
  /** Shape layers: the object version last drawn. */
  version: number;
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
    for (const layer of walkLayers(this.doc.layers)) {
      live.add(layer.id);
      if (layer.kind === 'vector') {
        this.drawVector(layer);
        continue;
      }
      if (layer.kind !== 'raster') continue;
      const m = this.mirrors.get(layer.id);
      if (!m || m.surface !== layer.surface || m.canvas.width !== this.doc.width || m.canvas.height !== this.doc.height) {
        this.syncLayer(layer, null);
      }
    }
    for (const id of [...this.mirrors.keys()]) if (!live.has(id)) this.mirrors.delete(id);
    for (const id of [...this.groups.keys()]) if (!live.has(id)) this.groups.delete(id);
    this.invalidate(null);
  }

  /** Redraw a shape layer's canvas from its objects if they changed since last time. */
  private drawVector(layer: VectorLayer): boolean {
    const m = this.mirrorFor(layer);
    if (m.version === layer.version) return false;
    m.ctx.setTransform(1, 0, 0, 1, 0, 0);
    m.ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
    drawNodes(m.ctx, layer.objects, this.doc.width, this.doc.height);
    m.version = layer.version;
    return true;
  }

  /** A shape layer changed: redraw it and recomposite. */
  syncVector(layer: VectorLayer): void {
    if (this.drawVector(layer)) this.invalidate(null);
  }

  private mirrorFor(layer: RasterLayer | VectorLayer): Mirror {
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

  /** Mirror canvas of a raster layer, if it exists. */
  layerCanvas(id: string): OffscreenCanvas | null {
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
        const m = this.mirrors.get(l.id);
        if (!m) return;
        target.globalAlpha = top ? 1 : l.opacity;
        target.globalCompositeOperation = top || l.blend === 'normal' ? 'source-over' : l.blend;
        target.drawImage(m.canvas, 0, 0, this.doc.width, this.doc.height, 0, 0, w, h);
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
      const s = layer.surface;
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
    this.invalidate(area);
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
    this.drawLayers(ctx, this.doc.layers, r);
    ctx.restore();
  }

  /** Draw a layer list into ctx inside r. Groups render into their own canvas first. */
  private drawLayers(ctx: Ctx2D, layers: Layer[], r: Rect): void {
    const active = this.doc.activeLayer;
    for (const layer of layers) {
      if (layer.visible) {
        let source: OffscreenCanvas;
        if (layer.kind === 'raster') {
          source = this.mirrorFor(layer).canvas;
        } else if (layer.kind === 'vector') {
          this.drawVector(layer);
          source = this.mirrorFor(layer).canvas;
        } else {
          const g = this.groupCanvas(layer);
          g.ctx.save();
          g.ctx.beginPath();
          g.ctx.rect(r.x, r.y, r.w, r.h);
          g.ctx.clip();
          g.ctx.clearRect(r.x, r.y, r.w, r.h);
          this.drawLayers(g.ctx, layer.children, r);
          g.ctx.restore();
          source = g.canvas;
        }
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
        ctx.drawImage(source, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // Live objects (shape being drawn, floating pixels) sit right above the active layer.
      if (layer === active && this.liveDrawer) this.liveDrawer(ctx, r);
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

  /** Scaled snapshot of the composite for the navigator. */
  drawThumbnail(target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): void {
    this.flushComposite();
    target.clearRect(0, 0, w, h);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.composite, 0, 0, this.doc.width, this.doc.height, 0, 0, w, h);
  }
}
