import { clamp, type Point, type Rect } from '../core/geometry';

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 32;

/** Zoom steps used by zoom in/out (as fractions). */
export const ZOOM_STEPS = [
  0.01, 0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 0.75, 1, 1.25,
  1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32,
];

export interface ViewState {
  zoom: number;
  /** Screen position (CSS px) of the document origin. */
  panX: number;
  panY: number;
  /** Viewport size in CSS px. */
  width: number;
  height: number;
  docW: number;
  docH: number;
}

/** Space kept around the document so edges and resize handles stay reachable. */
const MARGIN = 48;

/**
 * Document ⇄ screen transform. Pan is clamped so the document can't be lost off-screen, and
 * documents smaller than the viewport stay centred.
 */
export class View {
  zoom = 1;
  panX = 0;
  panY = 0;
  width = 1;
  height = 1;
  docW = 1;
  docH = 1;

  state(): ViewState {
    return {
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      width: this.width,
      height: this.height,
      docW: this.docW,
      docH: this.docH,
    };
  }

  toScreen(x: number, y: number): Point {
    return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
  }

  toDoc(sx: number, sy: number): Point {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  docRectOnScreen(): Rect {
    return { x: this.panX, y: this.panY, w: this.docW * this.zoom, h: this.docH * this.zoom };
  }

  /** Visible part of the document in doc coordinates (integer, clipped). */
  visibleDocRect(): Rect | null {
    const a = this.toDoc(0, 0);
    const b = this.toDoc(this.width, this.height);
    const x0 = clamp(Math.floor(a.x), 0, this.docW);
    const y0 = clamp(Math.floor(a.y), 0, this.docH);
    const x1 = clamp(Math.ceil(b.x), 0, this.docW);
    const y1 = clamp(Math.ceil(b.y), 0, this.docH);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  setViewport(w: number, h: number): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const docCenter = this.toDoc(cx, cy);
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    // Keep the same doc point at the centre while resizing.
    this.panX = this.width / 2 - docCenter.x * this.zoom;
    this.panY = this.height / 2 - docCenter.y * this.zoom;
    this.clampPan();
  }

  setDocSize(w: number, h: number): void {
    this.docW = w;
    this.docH = h;
    this.clampPan();
  }

  /** Zoom keeping the doc point under screen point (sx, sy) fixed. */
  zoomAt(z: number, sx: number, sy: number): void {
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const p = this.toDoc(sx, sy);
    this.zoom = nz;
    this.panX = sx - p.x * nz;
    this.panY = sy - p.y * nz;
    this.clampPan();
  }

  zoomCentered(z: number): void {
    this.zoomAt(z, this.width / 2, this.height / 2);
  }

  nextZoom(dir: 1 | -1): number {
    const z = this.zoom;
    if (dir > 0) return ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM;
    return [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? MIN_ZOOM;
  }

  /** Largest zoom (≤ 100% unless `allowUpscale`) that fits the doc in the viewport. */
  fitZoom(allowUpscale = false): number {
    const zx = (this.width - MARGIN * 2) / this.docW;
    const zy = (this.height - MARGIN * 2) / this.docH;
    const z = Math.min(zx, zy);
    return clamp(allowUpscale ? z : Math.min(1, z), MIN_ZOOM, MAX_ZOOM);
  }

  fit(allowUpscale = false): void {
    this.zoom = this.fitZoom(allowUpscale);
    this.center();
  }

  center(): void {
    this.panX = (this.width - this.docW * this.zoom) / 2;
    this.panY = (this.height - this.docH * this.zoom) / 2;
    this.clampPan();
  }

  /** Zoom so doc rect r fills the viewport. */
  zoomToRect(r: Rect): void {
    if (r.w < 1 || r.h < 1) return;
    const z = clamp(Math.min(this.width / r.w, this.height / r.h) * 0.95, MIN_ZOOM, MAX_ZOOM);
    this.zoom = z;
    this.panX = this.width / 2 - (r.x + r.w / 2) * z;
    this.panY = this.height / 2 - (r.y + r.h / 2) * z;
    this.clampPan();
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
  }

  /** Scroll geometry for scrollbars along one axis. */
  scrollInfo(axis: 'x' | 'y'): { content: number; viewport: number; offset: number } {
    const docSize = (axis === 'x' ? this.docW : this.docH) * this.zoom;
    const viewport = axis === 'x' ? this.width : this.height;
    const pan = axis === 'x' ? this.panX : this.panY;
    const content = Math.max(viewport, docSize + MARGIN * 2);
    // offset = how far the content's start is scrolled past the viewport start.
    const offset = docSize + MARGIN * 2 <= viewport ? 0 : MARGIN - pan;
    return { content, viewport, offset };
  }

  scrollTo(axis: 'x' | 'y', offset: number): void {
    if (axis === 'x') this.panX = MARGIN - offset;
    else this.panY = MARGIN - offset;
    this.clampPan();
  }

  private clampPan(): void {
    const dw = this.docW * this.zoom;
    const dh = this.docH * this.zoom;
    if (dw + MARGIN * 2 <= this.width) this.panX = (this.width - dw) / 2;
    else this.panX = clamp(this.panX, this.width - dw - MARGIN, MARGIN);
    if (dh + MARGIN * 2 <= this.height) this.panY = (this.height - dh) / 2;
    else this.panY = clamp(this.panY, this.height - dh - MARGIN, MARGIN);
  }
}
