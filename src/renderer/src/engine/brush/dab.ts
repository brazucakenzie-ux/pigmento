import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';
import type { PixelView } from '../raster/pixels';
import type { Surface } from '../raster/Surface';
import { sampleMask, tipLevel, type Mask, type TipMask } from './tips';
import type { TextureMode } from './types';

/** One stamp of the tip, fully worked out (dynamics, jitter and scatter already applied). */
export interface Dab {
  x: number;
  y: number;
  /** Diameter in px. */
  size: number;
  /** Radians. */
  angle: number;
  roundness: number;
  hardness: number;
  /** Paint this dab adds, 0–1. */
  alpha: number;
  color: RGBA;
}

/** How a dab's tip covers a pixel: the shape, aliasing and grain shared by every dab of a stroke. */
export interface DabShape {
  tip: 'round' | 'square' | TipMask;
  pixel: boolean;
  texture: { mask: Mask; scale: number; depth: number; mode: TextureMode } | null;
}

/** The pixels a dab can touch. */
export function dabBounds(d: Dab): Rect {
  const r = d.size / 2 + 1;
  return { x: Math.floor(d.x - r), y: Math.floor(d.y - r), w: Math.ceil(r * 2) + 1, h: Math.ceil(r * 2) + 1 };
}

function smooth(t: number): number {
  return t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
}

/**
 * Calls `fn(x, y, coverage)` for every pixel of `sub` the dab covers (coverage 0–1). The tip is
 * rotated by the dab's angle and squashed by its roundness.
 */
export function forEachDabPixel(d: Dab, shape: DabShape, sub: Rect, fn: (x: number, y: number, cov: number) => void): void {
  const rx = Math.max(0.5, d.size / 2);
  const ry = Math.max(0.5, rx * Math.min(1, Math.max(0.05, d.roundness)));
  const c = Math.cos(d.angle);
  const s = Math.sin(d.angle);
  const hard = Math.min(1, Math.max(0, d.hardness));
  const tip = shape.tip;
  const level = typeof tip === 'object' ? tipLevel(tip, d.size) : null;
  const tex = shape.texture;
  const grain = (x: number, y: number) => {
    if (!tex) return 1;
    const tx = Math.floor(x / tex.scale) % tex.mask.w;
    const ty = Math.floor(y / tex.scale) % tex.mask.h;
    return tex.mask.data[(ty < 0 ? ty + tex.mask.h : ty) * tex.mask.w + (tx < 0 ? tx + tex.mask.w : tx)] / 255;
  };
  if (shape.pixel && !level) {
    // Pixel art: an exact footprint of whole pixels (as Paint's pencil), grain then a threshold.
    const sz = Math.max(1, Math.round(d.size));
    const x0 = Math.floor(d.x - sz / 2 + 0.5);
    const y0 = Math.floor(d.y - sz / 2 + 0.5);
    const cx = x0 + sz / 2;
    const cy = y0 + sz / 2;
    const r2 = (sz / 2) * (sz / 2);
    for (let y = Math.max(sub.y, y0); y < Math.min(sub.y + sub.h, y0 + sz); y++) {
      for (let x = Math.max(sub.x, x0); x < Math.min(sub.x + sub.w, x0 + sz); x++) {
        if (tip === 'round' && sz > 2 && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r2) continue;
        const g = grain(x, y);
        const cov = tex ? (tex.mode === 'subtract' ? 1 - tex.depth * (1 - g) : 1 - tex.depth * (1 - g)) : 1;
        if (cov >= 0.5) fn(x, y, 1);
      }
    }
    return;
  }
  // Anti-aliasing width in the tip's own units.
  const aa = 1 / Math.min(rx, ry);
  for (let y = sub.y; y < sub.y + sub.h; y++) {
    const dy = y + 0.5 - d.y;
    for (let x = sub.x; x < sub.x + sub.w; x++) {
      const dx = x + 0.5 - d.x;
      const u = (dx * c + dy * s) / rx;
      const v = (-dx * s + dy * c) / ry;
      let cov: number;
      if (level) {
        if (u < -1 || u > 1 || v < -1 || v > 1) continue;
        cov = sampleMask(level, (u + 1) / 2, (v + 1) / 2);
      } else {
        const dist = tip === 'square' ? Math.max(Math.abs(u), Math.abs(v)) : Math.sqrt(u * u + v * v);
        if (dist >= 1 + aa) continue;
        cov = Math.min(1, (1 - dist) / aa + 0.5);
        if (hard < 1 && dist > hard) {
          const fall = smooth((dist - hard) / (1 - hard));
          if (fall < cov) cov = fall;
        }
      }
      if (cov <= 0) continue;
      if (tex) {
        const g = grain(x, y);
        cov = tex.mode === 'subtract' ? Math.max(0, cov - tex.depth * (1 - g)) : cov * (1 - tex.depth * (1 - g));
      }
      if (shape.pixel) cov = cov >= 0.5 ? 1 : 0;
      if (cov <= 0) continue;
      fn(x, y, cov);
    }
  }
}

/** Paint a dab onto a pixel view: its colour laid over what's there with alpha × coverage. */
export function paintDab(view: PixelView, sub: Rect, d: Dab, shape: DabShape): void {
  const data = view.data;
  const { r, g, b, a } = d.color;
  const ca = (a / 255) * d.alpha;
  forEachDabPixel(d, shape, sub, (x, y, cov) => {
    const sa = ca * cov;
    if (sa <= 0) return;
    const i = ((y - view.oy) * view.stride + (x - view.ox)) * 4;
    const da = data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    const k = (da * (1 - sa)) / oa;
    const t = sa / oa;
    data[i] = r * t + data[i] * k;
    data[i + 1] = g * t + data[i + 1] * k;
    data[i + 2] = b * t + data[i + 2] * k;
    // Rounded up: with half-to-even rounding, low-flow dabs would stall at 254 and never cover.
    data[i + 3] = Math.ceil(oa * 255 - 1e-6);
  });
}

/** Paint a dab into a surface (only the tiles it touches are created). */
export function paintDabInto(surface: Surface, d: Dab, shape: DabShape): Rect | null {
  const box = dabBounds(d);
  let touched: Rect | null = null;
  surface.forEachTile(
    box,
    (view, sub) => {
      paintDab(view, sub, d, shape);
      touched = touched ? union(touched, sub) : sub;
    },
    true,
  );
  return touched;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
