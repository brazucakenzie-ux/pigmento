import type { Surface } from '../raster/Surface';

/**
 * One drawing of a frame-by-frame layer: it shows from `start` until the next cel starts. A
 * layer's cels are sorted by start, the first starts at frame 0, and no two share a start.
 */
export interface Cel {
  start: number;
  surface: Surface;
}

export const MAX_CELS = 2000;

/** Index of the cel shown at `frame`. */
export function celIndexAt(cels: readonly Cel[], frame: number): number {
  let lo = 0;
  let hi = cels.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cels[mid].start <= frame) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function celAt(cels: readonly Cel[], frame: number): Cel {
  return cels[celIndexAt(cels, frame)];
}

/** The frame a cel stops showing after (inclusive), for a timeline `length` long. */
export function celEnd(cels: readonly Cel[], i: number, length: number): number {
  return i + 1 < cels.length ? cels[i + 1].start - 1 : Math.max(cels[i].start, length - 1);
}

/**
 * Cels with a new one starting at `frame`, holding `surface` (the cel that was showing there
 * now ends just before it). Null if a cel already starts at that frame.
 */
export function insertCel(cels: readonly Cel[], frame: number, surface: Surface): Cel[] | null {
  if (frame < 0 || cels.some((c) => c.start === frame)) return null;
  return [...cels, { start: frame, surface }].sort((a, b) => a.start - b.start);
}

/**
 * Cels without the one shown at `frame` (the one before it shows on in its place; if it was the
 * first, the next one starts at frame 0 instead). Null when it's the only one.
 */
export function removeCelAt(cels: readonly Cel[], frame: number): Cel[] | null {
  if (cels.length <= 1) return null;
  const i = celIndexAt(cels, frame);
  const out = cels.filter((_, k) => k !== i).map((c) => ({ ...c }));
  out[0] = { ...out[0], start: 0 };
  return out;
}

/**
 * Move where cel `i` starts (holding the one before it longer or shorter). It stays after the
 * one before and before the one after; the first cel always starts at 0. Null if it can't move.
 */
export function moveCelStart(cels: readonly Cel[], i: number, start: number): Cel[] | null {
  if (i <= 0 || i >= cels.length) return null;
  const min = cels[i - 1].start + 1;
  const max = i + 1 < cels.length ? cels[i + 1].start - 1 : Number.POSITIVE_INFINITY;
  const s = Math.round(start);
  if (s < min || s > max || s === cels[i].start) return null;
  return cels.map((c, k) => (k === i ? { ...c, start: s } : { ...c }));
}

/** The distinct surfaces of some cels (copy-on-write copies share tiles, not surfaces). */
export function celSurfaces(cels: readonly Cel[]): Surface[] {
  return [...new Set(cels.map((c) => c.surface))];
}
