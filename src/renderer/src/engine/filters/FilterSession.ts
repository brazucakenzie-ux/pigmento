import type { I18nKey } from '../../i18n';
import { rectIntersect, type Rect } from '../core/geometry';
import type { RasterLayer } from '../doc/Document';
import { maskAt, type MaskView, type PixelView } from '../raster/pixels';
import type { TileDelta } from '../raster/Surface';
import { resample } from '../raster/transform';
import type { LayerFilter } from '../render/Renderer';
import { padOf, type FilterJob } from './FilterRegistry';
import type { FilterPool } from './FilterPool';
import type { FilterDef, FilterParams } from './types';

/** What a filter session needs from the engine. */
export interface FilterHost {
  addLayerFilter(f: LayerFilter): void;
  removeLayerFilter(f: LayerFilter): void;
  syncActiveLayer(r: Rect | null): void;
  pushPixels(label: I18nKey, layer: RasterLayer, delta: TileDelta | null): void;
}

/** Previews are worked out on at most about this many pixels while settings change. */
const FAST_PIXELS = 300_000;

interface Result {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

/** Lay `res` over the pixel at `i` by `t` (0–1), premultiplied so transparent edges stay clean. */
function blendAt(dst: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number, t: number): void {
  if (t >= 1) {
    dst[i] = r;
    dst[i + 1] = g;
    dst[i + 2] = b;
    dst[i + 3] = a;
    return;
  }
  const da = dst[i + 3];
  const na = da + (a - da) * t;
  if (na <= 0) {
    dst[i + 3] = 0;
    return;
  }
  dst[i] = (dst[i] * da + (r * a - dst[i] * da) * t) / na;
  dst[i + 1] = (dst[i + 1] * da + (g * a - dst[i + 1] * da) * t) / na;
  dst[i + 2] = (dst[i + 2] * da + (b * a - dst[i + 2] * da) * t) / na;
  dst[i + 3] = na;
}

/**
 * One adjustment or filter being set up in its dialog: a live preview on the active layer
 * (downscaled while settings change, then full size), and Apply as one undo step. Only the
 * selection changes, if there is one.
 */
export class FilterSession {
  private shown: Result | null = null;
  private full: { key: string; res: Result } | null = null;
  private readonly display: LayerFilter;

  constructor(
    private readonly host: FilterHost,
    private readonly pool: FilterPool,
    readonly def: FilterDef,
    readonly layer: RasterLayer,
    /** The area filtered: the selection's bounds, or the whole layer. */
    readonly region: Rect,
    private readonly clip: MaskView | null,
  ) {
    this.display = (view: PixelView, r: Rect) => this.drawPreview(view, r);
  }

  /** A job for these settings at `scale` (1 = full size). */
  private job(params: FilterParams, scale: number): FilterJob {
    const { region, layer } = this;
    const pad = Math.ceil(padOf(this.def, params, scale) / scale);
    const lb = { x: 0, y: 0, w: layer.surface.width, h: layer.surface.height };
    const area = rectIntersect({ x: region.x - pad, y: region.y - pad, w: region.w + pad * 2, h: region.h + pad * 2 }, lb) ?? region;
    let src = { data: layer.surface.readRect(area), w: area.w, h: area.h };
    if (scale < 1) src = resample(src, area.w * scale, area.h * scale, 'bilinear');
    const k = { x: src.w / area.w, y: src.h / area.h };
    const inner = {
      x: Math.min(src.w - 1, Math.round((region.x - area.x) * k.x)),
      y: Math.min(src.h - 1, Math.round((region.y - area.y) * k.y)),
      w: 0,
      h: 0,
    };
    inner.w = Math.max(1, Math.min(src.w - inner.x, Math.round(region.w * k.x)));
    inner.h = Math.max(1, Math.min(src.h - inner.y, Math.round(region.h * k.y)));
    return { filterId: this.def.id, params, src, x0: Math.round(area.x * k.x), y0: Math.round(area.y * k.y), inner, frame: region, scale };
  }

  /**
   * Show the filter with these settings. `fast` works on a smaller copy (for slider drags);
   * otherwise full size, kept for Apply.
   */
  async preview(params: FilterParams, fast: boolean, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<void> {
    const px = this.region.w * this.region.h;
    const scale = fast ? Math.min(1, Math.sqrt(FAST_PIXELS / px)) : 1;
    const res = scale === 1 ? await this.fullResult(params, signal, onProgress) : await this.compute(params, scale, signal, onProgress);
    if (signal?.aborted) return;
    this.shown = res;
    this.host.addLayerFilter(this.display);
    this.host.syncActiveLayer(this.region);
  }

  /** Back to the layer as it is. */
  clearPreview(): void {
    if (!this.shown) return;
    this.shown = null;
    this.host.removeLayerFilter(this.display);
    this.host.syncActiveLayer(this.region);
  }

  private async compute(params: FilterParams, scale: number, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<Result> {
    const job = this.job(params, scale);
    const data = await this.pool.run(job, onProgress, signal);
    return { data, w: job.inner.w, h: job.inner.h };
  }

  private async fullResult(params: FilterParams, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<Result> {
    const key = JSON.stringify(params);
    if (this.full?.key === key) {
      onProgress?.(1);
      return this.full.res;
    }
    const res = await this.compute(params, 1, signal, onProgress);
    this.full = { key, res };
    return res;
  }

  private drawPreview(view: PixelView, r: Rect): void {
    const res = this.shown;
    const a = res ? rectIntersect(r, this.region) : null;
    if (!res || !a) return;
    const kx = res.w / this.region.w;
    const ky = res.h / this.region.h;
    for (let y = a.y; y < a.y + a.h; y++) {
      const sy = Math.min(res.h - 1, Math.floor((y - this.region.y) * ky));
      for (let x = a.x; x < a.x + a.w; x++) {
        const m = this.clip ? maskAt(this.clip, x, y) : 255;
        if (m === 0) continue;
        const s = (sy * res.w + Math.min(res.w - 1, Math.floor((x - this.region.x) * kx))) * 4;
        blendAt(view.data, ((y - view.oy) * view.stride + (x - view.ox)) * 4, res.data[s], res.data[s + 1], res.data[s + 2], res.data[s + 3], m / 255);
      }
    }
  }

  /** Filter the layer for real (one undo step). Resolves false if cancelled. */
  async apply(params: FilterParams, signal?: AbortSignal, onProgress?: (p: number) => void): Promise<boolean> {
    let res: Result;
    try {
      res = await this.fullResult(params, signal, onProgress);
    } catch (err) {
      if (signal?.aborted) return false;
      throw err;
    }
    if (signal?.aborted) return false;
    this.end();
    const { region, layer } = this;
    const surf = layer.surface;
    surf.beginEdit();
    const cur = surf.readRect(region);
    for (let y = 0; y < region.h; y++) {
      for (let x = 0; x < region.w; x++) {
        const m = this.clip ? maskAt(this.clip, region.x + x, region.y + y) : 255;
        if (m === 0) continue;
        const i = (y * region.w + x) * 4;
        blendAt(cur, i, res.data[i], res.data[i + 1], res.data[i + 2], res.data[i + 3], m / 255);
      }
    }
    surf.writeRect(region, { data: cur, stride: region.w, ox: region.x, oy: region.y });
    this.host.pushPixels(this.def.labelKey, layer, surf.endEdit());
    this.host.syncActiveLayer(region);
    return true;
  }

  /** Close the session: the preview goes away. */
  end(): void {
    this.clearPreview();
    this.host.removeLayerFilter(this.display);
  }

  /** Stop the workers now (the user cancelled a long run). */
  stopWorkers(): void {
    this.pool.stop();
  }
}
