import type { LoopMode } from './timeline';

/**
 * The frames an export plays, in order, for frames `from` … `to` (inclusive, 0-based). Back and
 * forth plays to the end and back without showing either end twice in a row; the others play
 * straight through (whether they repeat is up to the file's own loop setting).
 */
export function frameSequence(from: number, to: number, playback: LoopMode): number[] {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const out: number[] = [];
  for (let f = a; f <= b; f++) out.push(f);
  if (playback === 'pingpong') for (let f = b - 1; f > a; f--) out.push(f);
  return out;
}

/**
 * Each frame's time on screen in whole milliseconds, adding up to the right total (12 fps is 83
 * or 84 ms a frame, not 83 every time, so a 12-frame second lasts a second).
 */
export function frameDelays(count: number, fps: number, unitMs = 1): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 1; i <= count; i++) {
    const t = Math.round((i * 1000) / fps / unitMs) * unitMs;
    out.push(t - prev);
    prev = t;
  }
  return out;
}

/** Output size of an export at `scale` (at least 1 px). */
export function exportSize(w: number, h: number, scale: number): { w: number; h: number } {
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}
