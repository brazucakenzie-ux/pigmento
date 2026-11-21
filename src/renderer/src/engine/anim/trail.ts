import type { RGBA } from '../core/color';
import type { Point } from '../core/geometry';
import { ease, type Easing } from './interpolate';
import type { Vec3 } from './space';

/**
 * Trails: what a moving piece leaves behind, from a point on it (its emitter). A trail is either
 * puffs (stamps of a brush tip that live a while, growing, drifting, fading and changing colour)
 * or an echo (fading copies of the piece itself).
 *
 * Worked out from the timeline alone: what shows at a frame depends only on the frame, the
 * piece's motion and the trail's settings and seed, never on the frames shown before, so
 * scrubbing, playback and exports always agree and nothing but the settings is saved.
 *
 * Births run on fixed times through the whole timeline (and before it, so a chimney is already
 * smoking on the first frame): one every 1/rate seconds, and, for distance, in thin slices of
 * time on one grid, each due the distance its emitter moved over it divided by the spacing. The
 * whole number due in a slice is born, and one more as often as the fraction left says (by the
 * seed). Where emission is keyed down, births are left out at random in proportion.
 */

export type TrailKind = 'puffs' | 'echo';
export const TRAIL_KINDS: readonly TrailKind[] = ['puffs', 'echo'];

/** A colour along a puff's life: pos 0 at birth, 1 at the end. */
export interface TrailStop {
  readonly pos: number;
  readonly color: RGBA;
}

/** Emission keyed at a frame: how much of the rate (and spacing) is emitted, 0 (off) … 1, and the easing on to the next key. */
export interface TrailKey {
  readonly frame: number;
  readonly amount: number;
  readonly easing: Easing;
}

export interface Trail {
  /** Stable while the trail lives (the options list it by this). */
  readonly id: string;
  readonly kind: TrailKind;
  /** Where it comes from, in the piece's own pixels (it turns and moves with the piece). */
  readonly emitter: Point;
  /** Puffs: born each second while emitting (0 … MAX_RATE). */
  readonly rate: number;
  /** Puffs: one born each time the emitter travels this many document pixels (0: none). */
  readonly spacing: number;
  /** Puffs: seconds each one lives. */
  readonly lifetime: number;
  /** Puffs: width at birth, in document pixels. */
  readonly size: number;
  /** Puffs: size at the end of its life, as a multiple of the size at birth. */
  readonly growth: number;
  /** Puffs: drift (pixels a second) and its direction (radians on the canvas, -π/2 = up). */
  readonly drift: number;
  readonly driftAngle: number;
  /** Puffs: random scatter, up to this many pixels a second in any direction. */
  readonly spread: number;
  /** Opacity at birth (0 … 1). */
  readonly opacity: number;
  /** How much it fades by the end of its life (0: not at all, 1: to nothing). */
  readonly fade: number;
  /** Puffs: colours over life, 2 … 4, in order of pos. */
  readonly colors: readonly TrailStop[];
  /** Puffs: the brush whose tip they're stamped with. */
  readonly brush: string;
  /** Puffs: stretched along the way the emitter was going when born (speed lines). */
  readonly stretch: boolean;
  /** Drawn in front of the piece instead of behind it. */
  readonly front: boolean;
  /** Echo: how many copies, and how many frames apart. */
  readonly copies: number;
  readonly gap: number;
  readonly seed: number;
  /** Emission keyed on the timeline (none: always on, fully). */
  readonly keys: readonly TrailKey[];
}

/** Most trails a piece can have. */
export const MAX_TRAILS = 4;
/** Most puffs of one trail alive at once (the newest are kept). */
export const MAX_LIVE_PUFFS = 5000;
export const MAX_RATE = 1000;
export const MAX_LIFETIME = 30;
export const MAX_SIZE = 2000;
export const MAX_GROWTH = 20;
export const MAX_DRIFT = 10000;
export const MAX_SPACING = 10000;
export const MAX_COPIES = 32;
export const MAX_GAP = 60;
export const MAX_TRAIL_KEYS = 2000;

/** A new trail of a kind, with plain settings (the presets start from these). */
export function makeTrail(id: string, kind: TrailKind, emitter: Point, seed: number): Trail {
  return {
    id,
    kind,
    emitter: { ...emitter },
    rate: 30,
    spacing: 8,
    lifetime: 1.5,
    size: 24,
    growth: 2.5,
    drift: 20,
    driftAngle: -Math.PI / 2,
    spread: 15,
    opacity: 0.8,
    fade: 1,
    colors: [
      { pos: 0, color: { r: 245, g: 245, b: 245, a: 255 } },
      { pos: 1, color: { r: 140, g: 140, b: 140, a: 255 } },
    ],
    brush: 'soft-round',
    stretch: false,
    front: false,
    copies: 5,
    gap: 2,
    seed,
    keys: [],
  };
}

export function cloneTrail(t: Trail): Trail {
  return { ...t, emitter: { ...t.emitter }, colors: t.colors.map((s) => ({ pos: s.pos, color: { ...s.color } })), keys: t.keys.map((k) => ({ ...k })) };
}

/** How much the trail emits at `frame` (0 … 1): from its keys, held before the first and after the last; fully with none. */
export function emissionAt(t: Pick<Trail, 'keys'>, frame: number): number {
  const keys = t.keys;
  if (!keys.length) return 1;
  if (frame <= keys[0].frame) return keys[0].amount;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.amount;
  let i = 0;
  while (keys[i + 1].frame <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  // Hold: off then on (or on then off) switches right at the key.
  return a.amount + (b.amount - a.amount) * ease(a.easing, (frame - a.frame) / (b.frame - a.frame));
}

/** A seeded number in [0, 1) for (seed, a, b): the same inputs always give the same number. */
export function trailRandom(seed: number, a: number, b: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The colour at `u` of the way through a puff's life (stops in order of pos). */
export function colorAt(stops: readonly TrailStop[], u: number): RGBA {
  if (!stops.length) return { r: 255, g: 255, b: 255, a: 255 };
  if (u <= stops[0].pos) return { ...stops[0].color };
  const last = stops[stops.length - 1];
  if (u >= last.pos) return { ...last.color };
  let i = 0;
  while (stops[i + 1].pos <= u) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const k = b.pos > a.pos ? (u - a.pos) / (b.pos - a.pos) : 0;
  const mix = (p: number, q: number) => Math.round(p + (q - p) * k);
  return { r: mix(a.color.r, b.color.r), g: mix(a.color.g, b.color.g), b: mix(a.color.b, b.color.b), a: mix(a.color.a, b.color.a) };
}

/** One puff as it is at a frame. */
export interface Puff {
  /** Where its middle is in 3D (as the piece's frames place points; z is depth behind the canvas). */
  readonly at: Vec3;
  /** Width in document pixels at that depth's scale, before perspective. */
  readonly size: number;
  /** Length ÷ width (1 unless stretched along the motion). */
  readonly stretch: number;
  /** Which way it's turned (radians on the canvas). */
  readonly angle: number;
  readonly opacity: number;
  readonly color: RGBA;
}

/** One copy of an echo: the piece as it was at `frame`, at this opacity. */
export interface EchoCopy {
  readonly frame: number;
  readonly opacity: number;
}

/**
 * Where the emitter is (in 3D) at time `t` in frames, fractions included; times before the first
 * frame hold the piece where it is there.
 */
export type EmitterPath = (t: number) => Vec3;

/** Slices a frame is split into for births, at most (fewer for long lifetimes). */
const SLICES = 8;
/** Most slices one frame's puffs can come from. */
const MAX_SLICES = 4096;

/** How many slices per frame a trail is worked out in (fixed for a trail and frame rate, so births never move). */
export function slicesPerFrame(t: Pick<Trail, 'lifetime'>, fps: number): number {
  const window = Math.max(1, t.lifetime * fps);
  return Math.max(1, Math.min(SLICES, Math.floor(MAX_SLICES / window)));
}

/** A puff's own numbers, from the seed: which way it scatters, how far, and how it's turned. */
interface Birth {
  /** Frame (fractions included) it's born at. */
  readonly born: number;
  /** Where it's born. */
  readonly p: Vec3;
  /** Which way, and how fast (pixels a frame), the emitter was going. */
  readonly heading: number;
  readonly speed: number;
  /** Seeded numbers for it (0 … 1): scatter direction, scatter amount, turn. */
  readonly r: readonly [number, number, number];
}

/** Seed stream for births by time (apart from births by distance). */
const TIME_STREAM = 0x5bd1e995;

/**
 * The puffs of a trail alive at `frame`, oldest first, with the emitter's path and the frame
 * rate. Births are on fixed times, so the same frame always gives the same puffs.
 */
export function trailPuffs(t: Trail, at: EmitterPath, frame: number, fps: number): Puff[] {
  if (t.kind !== 'puffs' || t.lifetime <= 0 || !Number.isFinite(frame) || fps <= 0) return [];
  const per = slicesPerFrame(t, fps);
  const dt = 1 / per;
  const life = t.lifetime * fps;
  // The emitter at the ends of every slice a puff still alive could have been born in.
  const first = Math.floor((frame - life) * per);
  const last = Math.floor(frame * per);
  const pos: Vec3[] = [];
  for (let i = first; i <= last + 1; i++) pos.push(at(i * dt));
  const slice = (time: number): { i: number; f: number } => {
    const x = time * per;
    const i = Math.min(last, Math.max(first, Math.floor(x)));
    return { i, f: x - i };
  };
  const motion = (i: number): { heading: number; speed: number } => {
    const a = pos[i - first];
    const b = pos[i - first + 1];
    return { heading: Math.atan2(b[1] - a[1], b[0] - a[0]), speed: Math.hypot(b[0] - a[0], b[1] - a[1]) * per };
  };
  const place = (i: number, f: number): Vec3 => {
    const a = pos[i - first];
    const b = pos[i - first + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  };
  const births: Birth[] = [];
  // By time: one every 1/rate seconds.
  if (t.rate > 0) {
    const step = fps / Math.min(MAX_RATE, t.rate);
    const k0 = Math.ceil((frame - life) / step);
    const k1 = Math.floor(frame / step);
    for (let k = Math.max(k0, k1 - MAX_LIVE_PUFFS * 2); k <= k1; k++) {
      const born = k * step;
      if (frame - born >= life || born > frame) continue;
      const amount = emissionAt(t, born);
      if (amount <= 0 || (amount < 1 && trailRandom(t.seed ^ TIME_STREAM, k, -1) >= amount)) continue;
      const { i, f } = slice(born);
      births.push({ born, p: place(i, f), ...motion(i), r: [trailRandom(t.seed ^ TIME_STREAM, k, 1), trailRandom(t.seed ^ TIME_STREAM, k, 2), trailRandom(t.seed ^ TIME_STREAM, k, 3)] });
    }
  }
  // By distance: in each slice, the distance moved over the spacing.
  if (t.spacing > 0) {
    for (let i = first; i <= last; i++) {
      const a = pos[i - first];
      const b = pos[i - first + 1];
      const amount = emissionAt(t, (i + 0.5) * dt);
      if (amount <= 0) continue;
      const due = (amount * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) / t.spacing;
      const n = Math.min(MAX_LIVE_PUFFS, Math.floor(due) + (trailRandom(t.seed, i, -1) < due - Math.floor(due) ? 1 : 0));
      const m = motion(i);
      for (let j = 0; j < n; j++) {
        const f = (j + trailRandom(t.seed, i, j * 4)) / n;
        const born = (i + f) * dt;
        if (frame - born >= life || born > frame) continue;
        births.push({ born, p: place(i, f), ...m, r: [trailRandom(t.seed, i, j * 4 + 1), trailRandom(t.seed, i, j * 4 + 2), trailRandom(t.seed, i, j * 4 + 3)] });
      }
    }
  }
  births.sort((x, y) => x.born - y.born);
  const kept = births.length > MAX_LIVE_PUFFS ? births.slice(births.length - MAX_LIVE_PUFFS) : births;
  return kept.map((b) => {
    const age = frame - b.born;
    const u = age / life;
    const secs = age / fps;
    // Drifting, and scattered its own way.
    const dir = b.r[0] * Math.PI * 2;
    const scatter = t.spread * b.r[1];
    const vx = Math.cos(t.driftAngle) * t.drift + Math.cos(dir) * scatter;
    const vy = Math.sin(t.driftAngle) * t.drift + Math.sin(dir) * scatter;
    return {
      at: [b.p[0] + vx * secs, b.p[1] + vy * secs, b.p[2]],
      size: t.size * (1 + (t.growth - 1) * u),
      stretch: t.stretch ? 1 + Math.min(20, (b.speed * fps * 0.08) / Math.max(1, t.size)) : 1,
      angle: t.stretch ? b.heading : b.r[2] * Math.PI * 2,
      opacity: Math.max(0, t.opacity * (1 - t.fade * u)),
      color: colorAt(t.colors, u),
    };
  });
}

/**
 * The copies of an echo at `frame`, furthest back first: the piece as it was `gap` frames ago,
 * twice that, and so on, fainter each time; none before the first frame or while not emitting.
 */
export function echoCopies(t: Trail, frame: number): EchoCopy[] {
  if (t.kind !== 'echo' || t.copies < 1 || t.gap <= 0) return [];
  const out: EchoCopy[] = [];
  for (let i = t.copies; i >= 1; i--) {
    const f = frame - i * t.gap;
    if (f < 0) continue;
    const amount = emissionAt(t, f);
    const opacity = t.opacity * amount * (1 - (t.fade * i) / (t.copies + 1));
    if (opacity > 0) out.push({ frame: f, opacity });
  }
  return out;
}
