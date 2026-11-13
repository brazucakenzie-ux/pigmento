import type { Rect } from '../core/geometry';
import { ADJUSTMENTS } from './adjustments';
import { EFFECTS } from './effects';
import type { FilterDef, FilterGroup, FilterInput, FilterParams } from './types';

/** Every adjustment and filter, by id (built-in only; the registry is shared with workers). */
export class FilterRegistry {
  private defs = new Map<string, FilterDef>();

  register(def: FilterDef): void {
    if (this.defs.has(def.id)) throw new Error(`Filter "${def.id}" is already registered`);
    this.defs.set(def.id, def);
  }

  get(id: string): FilterDef | undefined {
    return this.defs.get(id);
  }

  all(): FilterDef[] {
    return [...this.defs.values()];
  }

  byGroup(g: FilterGroup): FilterDef[] {
    return this.all().filter((d) => d.group === g);
  }
}

export const filterRegistry = new FilterRegistry();
for (const d of [...ADJUSTMENTS, ...EFFECTS]) filterRegistry.register(d);

/** Rows a band reads beyond the ones it outputs. */
export function padOf(def: FilterDef, p: FilterParams, scale: number): number {
  return Math.max(0, Math.ceil(def.pad?.(p, scale) ?? 0));
}

/** One job of a banded run: rows [y0, y1) of the output, reading rows [r0, r1) of the source. */
export interface Band {
  y0: number;
  y1: number;
  r0: number;
  r1: number;
}

/**
 * Split `inner` rows (within a source `h` rows tall) into bands that each read `pad` rows more
 * on both sides. Bands are at least twice the pad (so overlap stays a small share of the work)
 * and there are enough for progress to move smoothly.
 */
export function planBands(inner: { y: number; h: number }, h: number, pad: number, workers: number): Band[] {
  const target = Math.max(64, pad * 2, Math.ceil(inner.h / Math.max(1, workers * 6)));
  const bands: Band[] = [];
  for (let y = inner.y; y < inner.y + inner.h; y += target) {
    const y1 = Math.min(inner.y + inner.h, y + target);
    bands.push({ y0: y, y1, r0: Math.max(0, y - pad), r1: Math.min(h, y1 + pad) });
  }
  return bands;
}

/** A source image and the part of it to filter (the rest is padding the filter may read). */
export interface FilterJob {
  filterId: string;
  params: FilterParams;
  src: { data: Uint8ClampedArray; w: number; h: number };
  /** Where `src` sits in the (scaled) image. */
  x0: number;
  y0: number;
  /** The output area, in `src` coordinates. */
  inner: Rect;
  /** The area being filtered, in image coordinates at full size. */
  frame: Rect;
  scale: number;
}

/** The band's slice of the source as a filter input. */
export function bandInput(job: FilterJob, b: Band): FilterInput {
  const { w } = job.src;
  return { data: job.src.data.slice(b.r0 * w * 4, b.r1 * w * 4), w, h: b.r1 - b.r0, x0: job.x0, y0: job.y0 + b.r0, frame: job.frame, scale: job.scale };
}

/** Copy a band's output rows (inner columns only) into the job's result. */
export function placeBand(job: FilterJob, b: Band, bandOut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const { w } = job.src;
  const { x, y, w: iw } = job.inner;
  for (let row = b.y0; row < b.y1; row++) {
    const from = ((row - b.r0) * w + x) * 4;
    out.set(bandOut.subarray(from, from + iw * 4), (row - y) * iw * 4);
  }
}

/** Run a whole job on this thread (tests, and previews too small to be worth a worker). */
export function runJob(job: FilterJob): Uint8ClampedArray {
  const def = filterRegistry.get(job.filterId);
  if (!def) throw new Error(`Unknown filter "${job.filterId}"`);
  const out = new Uint8ClampedArray(job.inner.w * job.inner.h * 4);
  const pad = padOf(def, job.params, job.scale);
  for (const b of planBands(job.inner, job.src.h, pad, 1)) placeBand(job, b, def.run(bandInput(job, b), job.params), out);
  return out;
}
