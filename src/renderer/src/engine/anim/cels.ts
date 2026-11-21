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

/** Drawings by where they start (all the timing needs). */
type Starts = readonly Pick<Cel, 'start'>[];

/** Index of the cel shown at `frame`. */
export function celIndexAt(cels: Starts, frame: number): number {
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

export type CelLoopMode = 'cycle' | 'pingpong';
export const CEL_LOOP_MODES: readonly CelLoopMode[] = ['cycle', 'pingpong'];

/**
 * A frame-by-frame layer's drawings repeating for the whole timeline: as a cycle (A B C A B C…)
 * or back and forth (A B C B A B C…, the ends not doubled). The cycle runs from frame 0 to `end`
 * (the frame after the last drawing's last), so the last drawing has a length of its own.
 */
export interface CelLoop {
  mode: CelLoopMode;
  end: number;
}

/** How long each drawing shows within the cycle (the last until the loop's end). */
function holds(cels: Starts, end: number): number[] {
  return cels.map((c, i) => Math.max(1, (i + 1 < cels.length ? cels[i + 1].start : end) - c.start));
}

/**
 * The frame within the first cycle that shows what `frame` shows: itself without a loop or
 * inside the first cycle; on a repeat, the same moment of the drawing repeated there.
 */
export function loopedFrame(cels: Starts, loop: CelLoop | null, frame: number): number {
  if (!loop || cels.length < 2 || frame < loop.end) return frame;
  const end = loop.end;
  if (loop.mode === 'cycle') return frame % end;
  // Back and forth: forward through every drawing, then back through the middle ones.
  const d = holds(cels, end);
  let back = 0;
  for (let i = 1; i < cels.length - 1; i++) back += d[i];
  const period = end + back;
  let f = frame % period;
  if (f < end) return f;
  f -= end;
  for (let i = cels.length - 2; i >= 1; i--) {
    if (f < d[i]) return cels[i].start + f;
    f -= d[i];
  }
  return cels[0].start;
}

/** Index of the cel shown at `frame`, the loop taken into account. */
export function celShownIndex(cels: Starts, loop: CelLoop | null, frame: number): number {
  return celIndexAt(cels, loopedFrame(cels, loop, frame));
}

/** The loop end a layer starts with: its last drawing as long as the one before it. */
export function defaultLoopEnd(cels: Starts): number {
  const n = cels.length;
  const last = cels[n - 1].start;
  return n > 1 ? last + Math.max(1, last - cels[n - 2].start) : last + 1;
}

/** A blocks of frames showing one drawing again, after the cycle (for the timeline). */
export interface CelRepeat {
  index: number;
  from: number;
  /** Inclusive. */
  to: number;
}

/** The repeats of a looping layer's drawings after its cycle, up to `length` frames, one block a run. */
export function celRepeats(cels: Starts, loop: CelLoop | null, length: number): CelRepeat[] {
  if (!loop || cels.length < 2) return [];
  const out: CelRepeat[] = [];
  for (let f = loop.end; f < length; f++) {
    const index = celShownIndex(cels, loop, f);
    const last = out[out.length - 1];
    // A new block where the drawing changes, or where the same one starts again (a cycle's seam).
    if (last && last.index === index && loopedFrame(cels, loop, f) === loopedFrame(cels, loop, f - 1) + 1) last.to = f;
    else out.push({ index, from: f, to: f });
  }
  return out;
}
