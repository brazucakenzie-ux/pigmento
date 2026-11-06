import type { Point, Rect } from '../core/geometry';
import type { Selection } from '../doc/Selection';
import { renderGradient, type GradientSpec } from '../raster/gradient';
import type { Surface } from '../raster/Surface';
import type { Overlay } from '../render/Overlay';
import type { LiveObject } from './LiveObject';

export type GradientEnd = 'start' | 'end';

/** Longest side of the on-screen preview (the applied gradient is computed at full size). */
const PREVIEW_MAX = 1024;

/**
 * A gradient being placed: its two ends stay draggable, and changing the tool's options or
 * colours updates it, until it's applied (Enter or another tool). Fills the selection, or
 * the whole canvas when nothing is selected.
 */
export class GradientObject implements LiveObject {
  readonly kind = 'gradient' as const;
  readonly historyLabel = 'history.gradient' as const;
  private preview: OffscreenCanvas | null = null;
  private dirty = true;

  constructor(
    private spec: GradientSpec,
    private opacity: number,
    private readonly clip: Selection | null,
    private readonly docW: number,
    private readonly docH: number,
  ) {}

  get start(): Point {
    return this.spec.start;
  }

  get end(): Point {
    return this.spec.end;
  }

  /** The area the gradient fills. */
  private get target(): Rect {
    return this.clip ? { ...this.clip.bounds } : { x: 0, y: 0, w: this.docW, h: this.docH };
  }

  bounds(): Rect {
    return this.target;
  }

  setPoint(which: GradientEnd, p: Point): void {
    this.spec = { ...this.spec, [which]: { ...p } };
    this.dirty = true;
  }

  /** New colours, type, repeat… from the tool options (the ends stay where they are). */
  update(spec: Omit<GradientSpec, 'start' | 'end'>, opacity: number): void {
    this.spec = { ...spec, start: this.spec.start, end: this.spec.end };
    this.opacity = opacity;
    this.dirty = true;
  }

  private renderPreview(): OffscreenCanvas {
    const r = this.target;
    const k = Math.min(1, PREVIEW_MAX / Math.max(r.w, r.h));
    const pw = Math.max(1, Math.round(r.w * k));
    const ph = Math.max(1, Math.round(r.h * k));
    // The gradient position only depends on ratios, so scaling both ends renders the same picture smaller.
    const scaled: GradientSpec = {
      ...this.spec,
      start: { x: (this.spec.start.x - r.x) * (pw / r.w), y: (this.spec.start.y - r.y) * (ph / r.h) },
      end: { x: (this.spec.end.x - r.x) * (pw / r.w), y: (this.spec.end.y - r.y) * (ph / r.h) },
    };
    const img = renderGradient(scaled, { x: 0, y: 0, w: pw, h: ph });
    if (!this.preview || this.preview.width !== pw || this.preview.height !== ph) this.preview = new OffscreenCanvas(pw, ph);
    this.preview.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, pw, ph), 0, 0);
    this.dirty = false;
    return this.preview;
  }

  draw(ctx: OffscreenCanvasRenderingContext2D): void {
    const canvas = this.dirty || !this.preview ? this.renderPreview() : this.preview;
    const r = this.target;
    ctx.save();
    if (this.clip && !this.clip.isRect) {
      ctx.beginPath();
      for (const loop of this.clip.outlines) {
        loop.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.closePath();
      }
      ctx.clip('evenodd');
    }
    ctx.globalAlpha = this.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  rasterize(surface: Surface): void {
    const r = this.target;
    const img = renderGradient(this.spec, r);
    surface.compositeImage(r, { data: img.data, stride: r.w, ox: r.x, oy: r.y }, 'over', this.opacity, this.clip ? this.clip.maskView() : null);
  }

  /** Which end is under the pointer (screen space), if any. */
  hit(sp: Point, screen: (p: Point) => Point, tolerance = 8): GradientEnd | null {
    for (const which of ['end', 'start'] as const) {
      const p = screen(this.spec[which]);
      if (Math.hypot(p.x - sp.x, p.y - sp.y) <= tolerance) return which;
    }
    return null;
  }

  drawOverlay(ov: Overlay): void {
    const a = ov.toScreen(this.spec.start);
    const b = ov.toScreen(this.spec.end);
    ov.line(a, b);
    ov.handle(a, 'circle');
    ov.handle(b, 'square');
  }

  dispose(): void {
    this.preview = null;
  }
}
