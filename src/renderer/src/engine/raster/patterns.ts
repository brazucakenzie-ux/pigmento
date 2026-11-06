import type { RGBA } from '../core/color';
import type { Rect } from '../core/geometry';
import type { I18nKey } from '../../i18n';
import type { ImageBuf } from './transform';

/**
 * Built-in fill patterns: original, procedural two-colour tiles (foreground over background)
 * described by a coverage function on one tile.
 */
export interface PatternDef {
  id: string;
  labelKey: I18nKey;
  /** Tile size at scale 1. */
  w: number;
  h: number;
  /** Foreground coverage (0…1) at tile point (x, y). */
  coverage(x: number, y: number): number;
}

const mod = (v: number, m: number) => ((v % m) + m) % m;
const band = (d: number, half: number) => (Math.abs(d) <= half ? 1 : 0);

export const BUILTIN_PATTERNS: readonly PatternDef[] = [
  { id: 'checker', labelKey: 'pattern.checker', w: 16, h: 16, coverage: (x, y) => (Math.floor(x / 8) + Math.floor(y / 8)) % 2 },
  { id: 'stripes', labelKey: 'pattern.stripes', w: 12, h: 12, coverage: (_x, y) => (y < 4 ? 1 : 0) },
  { id: 'diagonal', labelKey: 'pattern.diagonal', w: 16, h: 16, coverage: (x, y) => (mod(x + y, 16) < 5 ? 1 : 0) },
  { id: 'dots', labelKey: 'pattern.dots', w: 16, h: 16, coverage: (x, y) => (Math.hypot(x - 8, y - 8) < 3.5 ? 1 : 0) },
  { id: 'grid', labelKey: 'pattern.grid', w: 16, h: 16, coverage: (x, y) => (x < 1.5 || y < 1.5 ? 1 : 0) },
  {
    id: 'bricks',
    labelKey: 'pattern.bricks',
    w: 24,
    h: 16,
    coverage: (x, y) => {
      if (y < 2 || (y >= 8 && y < 10)) return 1;
      const offset = y < 8 ? 0 : 12;
      return mod(x - offset, 24) < 2 ? 1 : 0;
    },
  },
  { id: 'crosshatch', labelKey: 'pattern.crosshatch', w: 12, h: 12, coverage: (x, y) => (mod(x + y, 12) < 1.6 || mod(x - y, 12) < 1.6 ? 1 : 0) },
  { id: 'zigzag', labelKey: 'pattern.zigzag', w: 16, h: 12, coverage: (x, y) => band(y - (6 - Math.abs(mod(x, 16) - 8) * 0.75), 1.5) },
  { id: 'waves', labelKey: 'pattern.waves', w: 24, h: 12, coverage: (x, y) => band(y - (6 + 3 * Math.sin((x / 24) * Math.PI * 2)), 1.4) },
  {
    id: 'scales',
    labelKey: 'pattern.scales',
    w: 16,
    h: 16,
    coverage: (x, y) => {
      // Overlapping arcs: rows of circles, every other row offset by half a tile.
      const ring = (cx: number, cy: number) => band(Math.hypot(x - cx, y - cy) - 7.5, 0.9);
      return Math.max(ring(8, 16), ring(0, 8), ring(16, 8), ring(8, 0), ring(0, 24), ring(16, 24));
    },
  },
];

export function patternById(id: string): PatternDef | undefined {
  return BUILTIN_PATTERNS.find((p) => p.id === id);
}

/**
 * One tile of a built-in pattern at `scale`, anti-aliased with 4×4 supersampling.
 * `bg` null leaves the background transparent.
 */
export function renderPattern(def: PatternDef, fg: RGBA, bg: RGBA | null, scale = 1): ImageBuf {
  const k = Math.max(1, Math.min(8, Math.round(scale)));
  const w = def.w * k;
  const h = def.h * k;
  const data = new Uint8ClampedArray(w * h * 4);
  const SS = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) c += def.coverage((x + (sx + 0.5) / SS) / k, (y + (sy + 0.5) / SS) / k);
      }
      c /= SS * SS;
      const i = (y * w + x) * 4;
      if (bg) {
        // Foreground over background (straight alpha "over").
        const fa = (fg.a / 255) * c;
        const ba = (bg.a / 255) * (1 - fa);
        const a = fa + ba;
        if (a > 0) {
          data[i] = (fg.r * fa + bg.r * ba) / a;
          data[i + 1] = (fg.g * fa + bg.g * ba) / a;
          data[i + 2] = (fg.b * fa + bg.b * ba) / a;
        }
        data[i + 3] = a * 255;
      } else {
        data[i] = fg.r;
        data[i + 1] = fg.g;
        data[i + 2] = fg.b;
        data[i + 3] = fg.a * c;
      }
    }
  }
  return { w, h, data };
}

/** The pattern repeated over r, lined up with the document origin (so separate fills join up). */
export function tileInto(tile: ImageBuf, r: Rect): ImageBuf {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const ty = mod(r.y + y, tile.h);
    for (let x = 0; x < r.w; x++) {
      const tx = mod(r.x + x, tile.w);
      const si = (ty * tile.w + tx) * 4;
      const di = (y * r.w + x) * 4;
      out[di] = tile.data[si];
      out[di + 1] = tile.data[si + 1];
      out[di + 2] = tile.data[si + 2];
      out[di + 3] = tile.data[si + 3];
    }
  }
  return { w: r.w, h: r.h, data: out };
}

/** Largest pattern that can be made from a selection (each side). */
export const MAX_PATTERN_SIZE = 1024;
