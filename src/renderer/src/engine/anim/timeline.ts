/** How playback (and an exported GIF) runs past the last frame. */
export type LoopMode = 'loop' | 'once' | 'pingpong';
export const LOOP_MODES: readonly LoopMode[] = ['loop', 'once', 'pingpong'];

export const MIN_FPS = 1;
export const MAX_FPS = 60;
export const MAX_FRAMES = 2000;

/** The document's animation timing. Frames are numbered from 0. */
export interface Timeline {
  fps: number;
  /** Number of frames (1 … MAX_FRAMES). */
  length: number;
  loop: LoopMode;
  /** The frame shown and edited. */
  frame: number;
}

export function defaultTimeline(): Timeline {
  return { fps: 12, length: 24, loop: 'loop', frame: 0 };
}

export function clampFrame(frame: number, length: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(0, Math.round(frame)), Math.max(0, length - 1));
}

export function clampFps(fps: number): number {
  return Number.isFinite(fps) ? Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps))) : 12;
}

export function clampLength(length: number): number {
  return Number.isFinite(length) ? Math.min(MAX_FRAMES, Math.max(1, Math.round(length))) : 1;
}

/** Where playback is: the frame and which way it's going (ping-pong goes back). */
export interface PlayState {
  frame: number;
  dir: 1 | -1;
}

/**
 * Advance playback by `steps` frames (more than one when the screen fell behind).
 * Returns null when "once" reaches the end, which stops playback on the last frame.
 */
export function advance(state: PlayState, steps: number, t: Pick<Timeline, 'length' | 'loop'>): PlayState | null {
  const n = t.length;
  if (n <= 1) return t.loop === 'once' ? null : { frame: 0, dir: 1 };
  if (t.loop === 'loop') return { frame: (((state.frame + steps) % n) + n) % n, dir: 1 };
  if (t.loop === 'once') {
    const f = state.frame + steps;
    return f >= n - 1 ? null : { frame: f, dir: 1 };
  }
  // Ping-pong: 0 1 … n-1 n-2 … 1 0 1 …, a cycle of 2(n-1) steps.
  const period = 2 * (n - 1);
  const pos = state.dir === 1 ? state.frame : period - state.frame;
  const next = (((pos + steps) % period) + period) % period;
  return next < n ? { frame: next, dir: next === n - 1 ? -1 : 1 } : { frame: period - next, dir: -1 };
}

/** Seconds a frame stays on screen. */
export function frameDuration(fps: number): number {
  return 1 / clampFps(fps);
}
