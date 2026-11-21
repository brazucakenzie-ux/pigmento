import { ease, type Easing, type Keyframe } from './interpolate';
import { loopFrame, type PieceLoop } from './piece';

/**
 * Spin forever: a piece turning on and on at a speed, without keyframes for its angle. Speeds are
 * in turns a second (either way) for its spin, and its tilt and turn in 3D, keyed on their own
 * (not the piece's keyframes) with the usual easings. The extra turn at a frame is the speed added
 * up over time from the first frame, so a change of speed never makes it jump; it's added to what
 * the keyframes say, and a looping piece's speeds loop with its moves (the turn keeps adding up).
 */

export interface SpinKey {
  readonly frame: number;
  /** Turns a second: spin (in the piece's plane), and tilt and turn in 3D. */
  readonly spin: number;
  readonly tilt: number;
  readonly turn: number;
  readonly easing: Easing;
}

/** A piece's spin: its speeds, keyed (one key: the same speed throughout). */
export interface Spin {
  readonly keys: readonly SpinKey[];
}

/** The three speeds (turns a second), or how far each has turned (turns). */
export interface SpinAxes {
  spin: number;
  tilt: number;
  turn: number;
}

export const NO_SPIN: SpinAxes = { spin: 0, tilt: 0, turn: 0 };
/** Fastest a piece can spin, turns a second either way. */
export const MAX_SPIN = 100;
export const MAX_SPIN_KEYS = 2000;

/** The speeds keyed at `frame` (held before the first key and after the last). */
export function spinSpeedAt(s: Spin, frame: number): SpinAxes {
  const keys = s.keys;
  if (!keys.length) return { ...NO_SPIN };
  const pick = (k: SpinKey): SpinAxes => ({ spin: k.spin, tilt: k.tilt, turn: k.turn });
  if (frame <= keys[0].frame) return pick(keys[0]);
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return pick(last);
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const e = ease(a.easing, (frame - a.frame) / (b.frame - a.frame));
  return { spin: a.spin + (b.spin - a.spin) * e, tilt: a.tilt + (b.tilt - a.tilt) * e, turn: a.turn + (b.turn - a.turn) * e };
}

/** What a piece's spin is worked out from: the spin, and how its moves loop (its keyframes' span). */
export interface Spinning {
  readonly spin: Spin | null;
  readonly loop: PieceLoop;
  readonly keyframes: readonly { frame: number }[];
}

interface Table {
  keys: readonly SpinKey[];
  /** What the speeds' loop depends on: how the piece loops, from its first keyframe to its last. */
  span: string;
  fps: number;
  /** Turns from frame 0 to frame i, for each axis. */
  spin: number[];
  tilt: number[];
  turn: number[];
}

const tables = new WeakMap<Spin, Table>();

/** Most frames a turn is added up over before the table stops growing (far past any timeline). */
const MAX_TABLE = 100_000;

/**
 * How far a piece has turned by its spin at `frame` (turns, each axis): the speeds added up from
 * frame 0 (Simpson's rule on each frame, exact for the eased segments to well under a thousandth
 * of a turn), the speed at a moment read where the piece's loop puts it. Before frame 0 it went
 * at the speed it has there.
 */
export function spunAt(p: Spinning, frame: number, fps: number): SpinAxes {
  const s = p.spin;
  if (!s?.keys.length || !Number.isFinite(frame)) return { ...NO_SPIN };
  const perFrame = 1 / Math.max(1, fps);
  const speed = (t: number) => spinSpeedAt(s, loopFrame(p.keyframes, p.loop, t));
  const over = (a: number, b: number): SpinAxes => {
    // The speeds just inside the stretch: a held speed, or a loop going round, jumps at a key frame.
    const sa = speed(a + (b - a) * 1e-9);
    const sm = speed((a + b) / 2);
    const sb = speed(b - (b - a) * 1e-9);
    const k = ((b - a) * perFrame) / 6;
    return { spin: k * (sa.spin + 4 * sm.spin + sb.spin), tilt: k * (sa.tilt + 4 * sm.tilt + sb.tilt), turn: k * (sa.turn + 4 * sm.turn + sb.turn) };
  };
  if (frame <= 0) {
    // Before the first frame: at the speed there, backwards.
    const s0 = speed(0);
    return { spin: s0.spin * frame * perFrame, tilt: s0.tilt * frame * perFrame, turn: s0.turn * frame * perFrame };
  }
  const k = p.keyframes;
  const span = p.loop === 'off' || k.length < 2 ? 'off' : `${p.loop} ${k[0].frame} ${k[k.length - 1].frame}`;
  let t = tables.get(s);
  if (!t || t.keys !== s.keys || t.span !== span || t.fps !== fps) {
    t = { keys: s.keys, span, fps, spin: [0], tilt: [0], turn: [0] };
    tables.set(s, t);
  }
  const whole = Math.min(MAX_TABLE, Math.floor(frame));
  while (t.spin.length <= whole) {
    const i = t.spin.length - 1;
    const d = over(i, i + 1);
    t.spin.push(t.spin[i] + d.spin);
    t.tilt.push(t.tilt[i] + d.tilt);
    t.turn.push(t.turn[i] + d.turn);
  }
  const rest = frame > whole ? over(whole, frame) : NO_SPIN;
  return { spin: t.spin[whole] + rest.spin, tilt: t.tilt[whole] + rest.tilt, turn: t.turn[whole] + rest.turn };
}

/**
 * Fit to the timeline: the speeds made a little faster or slower so each axis turns a whole number
 * of times over `length` frames (at least once if it turns at all), so a looping export runs on
 * without a jump. Keyed speeds are all scaled alike, keeping their shape.
 */
export function fitSpin(p: Spinning, length: number, fps: number): Spin | null {
  const s = p.spin;
  if (!s?.keys.length) return null;
  const total = spunAt(p, length, fps);
  const scale = (axis: keyof SpinAxes): number => {
    const t = total[axis];
    if (Math.abs(t) < 1e-9) return 1;
    const whole = Math.max(1, Math.round(Math.abs(t))) * Math.sign(t);
    // Already whole (fitted before): left as it is.
    return Math.abs(whole - t) < 1e-9 ? 1 : whole / t;
  };
  const k = { spin: scale('spin'), tilt: scale('tilt'), turn: scale('turn') };
  if (k.spin === 1 && k.tilt === 1 && k.turn === 1) return s;
  return { keys: s.keys.map((key) => ({ ...key, spin: key.spin * k.spin, tilt: key.tilt * k.tilt, turn: key.turn * k.turn })) };
}

export function cloneSpin(s: Spin | null): Spin | null {
  return s && { keys: s.keys.map((k) => ({ ...k })) };
}

/** A spin with every number in range, keys one a frame in order (what the options and the file reader let through); null without keys. */
export function cleanSpin(s: Spin | null): Spin | null {
  if (!s) return null;
  const fin = (v: number) => (Number.isFinite(v) ? Math.max(-MAX_SPIN, Math.min(MAX_SPIN, v)) : 0);
  const byFrame = new Map<number, SpinKey>();
  for (const k of s.keys.slice(0, MAX_SPIN_KEYS)) {
    const frame = Math.max(0, Math.round(Number.isFinite(k.frame) ? k.frame : 0));
    byFrame.set(frame, { frame, spin: fin(k.spin), tilt: fin(k.tilt), turn: fin(k.turn), easing: k.easing });
  }
  const keys = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return keys.length ? { keys } : null;
}

/** The frame a speed keyed at `frame` goes on: itself, or on a looping piece's repeat, the frame it repeats (where its speed is read). */
export function spinKeyFrame(p: Spinning, frame: number): number {
  return Math.round(loopFrame(p.keyframes, p.loop, frame));
}

/** Speeds set at `frame`: that key changed, or one added there starting from the speeds there, with the easing of the stretch it splits. */
export function setSpinKey(s: Spin | null, frame: number, change: Partial<SpinAxes & { easing: Easing }>): Spin {
  const keys = s?.keys ?? [];
  const at = keys.find((k) => k.frame === frame);
  const before = [...keys].reverse().find((k) => k.frame < frame);
  const base: SpinKey = at ?? { frame, ...(s ? spinSpeedAt(s, frame) : NO_SPIN), easing: before?.easing ?? 'linear' };
  return cleanSpin({ keys: [...keys.filter((k) => k.frame !== frame), { ...base, ...change, frame }] }) ?? { keys: [] };
}

/** Without the speed key at `frame` (null: none left, so it doesn't spin), or undefined when there's no key there. */
export function removeSpinKey(s: Spin | null, frame: number): Spin | null | undefined {
  if (!s?.keys.some((k) => k.frame === frame)) return undefined;
  return cleanSpin({ keys: s.keys.filter((k) => k.frame !== frame) });
}

/** The speed key at `from` moved to `to`, or null when there's none at `from` or `to` is taken. */
export function moveSpinKey(s: Spin | null, from: number, to: number): Spin | null {
  if (!s || !Number.isInteger(to) || to < 0 || !s.keys.some((k) => k.frame === from)) return null;
  if (to !== from && s.keys.some((k) => k.frame === to)) return null;
  return cleanSpin({ keys: s.keys.map((k) => (k.frame === from ? { ...k, frame: to } : k)) });
}

/** How far a spin has turned a piece at a frame, in radians (null: not at all). */
export type SpunAngles = (frame: number) => { angle: number; tilt: number; turn: number } | null;

/**
 * Keyframes re-placed by `move` (a pivot moved, say) as they show with the spin added, keeping just
 * what `move` places them by (x, y and depth): so a spinning piece stays put on every keyframe too.
 * `move` maps keyframes one for one.
 */
export function placeWithSpin(keys: readonly Keyframe[], spun: SpunAngles, move: (keys: Keyframe[]) => Keyframe[]): Keyframe[] {
  const turned = keys.map((k) => {
    const s = spun(k.frame);
    return s ? { ...k, angle: k.angle + s.angle, tilt: k.tilt + s.tilt, turn: k.turn + s.turn } : k;
  });
  const moved = move(turned);
  return keys.map((k, i) => ({ ...k, x: moved[i].x, y: moved[i].y, depth: moved[i].depth }));
}
