import { toCss } from '../core/color';
import { rectIntersect, rectUnion, type Rect } from '../core/geometry';
import type { Layer, PaintDocument } from '../doc/Document';
import { TILE_SIZE } from '../raster/Surface';
import type { PixelView } from '../raster/pixels';
import type { View } from './View';

type Ctx2D = OffscreenCanvasRenderingContext2D;

interface Mirror {
  canvas: OffscreenCanvas;
  ctx: Ctx2D;
  tileImages: Map<number, ImageData>;
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
  liveDrawer: LiveDrawer | null = null;

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
    if (this.composite.width !== doc.width || this.composite.height !== doc.height) {
      this.composite = new OffscreenCanvas(doc.width, doc.height);
      this.compositeCtx = ctx2d(this.composite);
    }
    for (const layer of doc.layers) this.syncLayer(layer, null);
    this.invalidate(null);
  }

  private mirrorFor(layer: Layer): Mirror {
    let m = this.mirrors.get(layer.id);
    if (!m || m.canvas.width !== this.doc.width || m.canvas.height !== this.doc.height) {
      const canvas = new OffscreenCanvas(this.doc.width, this.doc.height);
      m = { canvas, ctx: ctx2d(canvas), tileImages: new Map() };
      this.mirrors.set(layer.id, m);
    }
    return m;
  }

  /** Upload a layer's tiles inside r (null = all) to its mirror canvas. */
  syncLayer(layer: Layer, r: Rect | null): void {
    const docRect = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const area = r ? rectIntersect(r, docRect) : docRect;
    if (!area) return;
    const m = this.mirrorFor(layer);
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
    const active = this.doc.activeLayer;
    for (const layer of this.doc.layers) {
      if (layer.visible) {
        const m = this.mirrorFor(layer);
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blend === 'normal' ? 'source-over' : layer.blend;
        ctx.drawImage(m.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (layer === active && this.liveDrawer) this.liveDrawer(ctx, r);
    }
    ctx.restore();
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
      ctx.imageSmoothingQuality = 'high';
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
  }

  /** Scaled snapshot of the composite for the navigator. */
  drawThumbnail(target: CanvasRenderingContext2D, w: number, h: number): void {
    this.flushComposite();
    target.clearRect(0, 0, w, h);
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(this.composite, 0, 0, this.doc.width, this.doc.height, 0, 0, w, h);
  }
}
