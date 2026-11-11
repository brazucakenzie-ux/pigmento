import type { RGBA } from '../core/color';
import { rectUnion, type Rect } from '../core/geometry';
import type { Dab } from './dab';
import { dynamicValue, seededRandom, type BrushSettings, type StrokeInput } from './types';

/** One input point of a stroke, in document coordinates. */
export interface StrokeSample extends StrokeInput {
  x: number;
  y: number;
}

export interface BrushStrokeOptions {
  settings: BrushSettings;
  /** Diameter in px (the tool's size, before dynamics). */
  size: number;
  color: RGBA;
  /** Same seed, same input → the same dabs. */
  seed: number;
  /** The colour under a point, for wet mixing (null if there's nothing to mix with). */
  pickColor?: (x: number, y: number, radius: number) => RGBA | null;
  /** Receives every dab; returns the pixels it changed. */
  emit: (d: Dab) => Rect | null;
}

function rgbToHsl(c: RGBA): [number, number, number] {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number, a: number): RGBA {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v = u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
    return Math.round(v * 255);
  };
  return { r: ch(h + 1 / 3), g: ch(h), b: ch(h - 1 / 3), a };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Turns input points into dabs: evenly spaced along the stroke (whole pixels for pixel
 * brushes), with dynamics, jitter, scatter, rotation and colour applied to each.
 */
export class BrushStroke {
  private last: StrokeSample | null = null;
  /** Distance moved since the last stamp. */
  private since = 0;
  /** Direction of travel (radians), for tips that follow the stroke. */
  private dir = 0;
  private readonly random: () => number;
  private readonly s: BrushSettings;

  constructor(private readonly o: BrushStrokeOptions) {
    this.s = o.settings;
    this.random = seededRandom(o.seed);
  }

  /** Diameter at this point before jitter (spacing follows it, so pressure changes stay even). */
  private baseSize(p: StrokeInput): number {
    const v = dynamicValue(this.s.dynamics.size, p, () => 0.5);
    return Math.max(this.s.pixel ? 1 : 0.5, this.o.size * v);
  }

  begin(p: StrokeSample): Rect | null {
    this.last = p;
    this.since = 0;
    return this.stamp(p);
  }

  /** Continue the stroke to p. */
  to(p: StrokeSample): Rect | null {
    const a = this.last;
    if (!a) return this.begin(p);
    if (this.s.pixel) return this.pixelsTo(a, p);
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    this.dir = Math.atan2(dy, dx);
    let dirty: Rect | null = null;
    let pos = 0;
    for (;;) {
      const here = this.mix(a, p, pos / len);
      const step = Math.max(0.5, this.s.spacing * this.baseSize(here));
      const need = step - this.since;
      if (pos + need > len) {
        this.since += len - pos;
        break;
      }
      pos += Math.max(0, need);
      this.since = 0;
      dirty = rectUnion(dirty, this.stamp(this.mix(a, p, pos / len)));
    }
    this.last = p;
    return dirty;
  }

  /** Pixel brushes step pixel by pixel (Bresenham), so lines are exactly one footprint wide. */
  private pixelsTo(a: StrokeSample, p: StrokeSample): Rect | null {
    let x = Math.floor(a.x);
    let y = Math.floor(a.y);
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    if (x === bx && y === by) {
      this.last = p;
      return null;
    }
    this.dir = Math.atan2(p.y - a.y, p.x - a.x);
    const dx = Math.abs(bx - x);
    const dy = -Math.abs(by - y);
    const sx = x < bx ? 1 : -1;
    const sy = y < by ? 1 : -1;
    const total = Math.max(dx, -dy) || 1;
    let err = dx + dy;
    let dirty: Rect | null = null;
    let step = 0;
    while (x !== bx || y !== by) {
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
      step++;
      dirty = rectUnion(dirty, this.stamp({ ...this.mix(a, p, step / total), x: x + 0.5, y: y + 0.5 }));
    }
    this.last = p;
    return dirty;
  }

  /** Airbrush: more paint at the last point while the pointer is held still. */
  hold(): Rect | null {
    return this.last ? this.stamp(this.last) : null;
  }

  private mix(a: StrokeSample, b: StrokeSample, t: number): StrokeSample {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), pressure: lerp(a.pressure, b.pressure, t), tilt: lerp(a.tilt, b.tilt, t), speed: lerp(a.speed, b.speed, t) };
  }

  private stamp(p: StrokeSample): Rect | null {
    const s = this.s;
    const rnd = this.random;
    const d = s.dynamics;
    const base = this.baseSize(p);
    let dirty: Rect | null = null;
    const count = Math.max(1, Math.min(16, Math.round(s.count)));
    for (let k = 0; k < count; k++) {
      // Every random draw happens on every dab, so a setting never shifts the others' sequence.
      const rSize = rnd();
      const rOpacity = rnd();
      const rAngle = rnd();
      const rScatterR = rnd();
      const rScatterA = rnd();
      const rHue = rnd();
      const rLight = rnd();
      const size = Math.max(s.pixel ? 1 : 0.5, base * (1 - s.sizeJitter * rSize));
      const alpha = s.flow * dynamicValue(d.flow, p, rnd) * dynamicValue(d.opacity, p, rnd) * (1 - s.opacityJitter * rOpacity);
      let angle = (s.angle * Math.PI) / 180 + (s.followStroke ? this.dir : 0) + s.angleJitter * (rAngle * 2 - 1) * Math.PI;
      if (d.angle && d.angle.source !== 'off') angle += dynamicValue(d.angle, p, rnd) * Math.PI * 2;
      const roundness = Math.max(0.05, s.roundness * dynamicValue(d.roundness, p, rnd));
      const hardness = s.hardness * dynamicValue(d.hardness, p, rnd);
      const spread = s.scatter * dynamicValue(d.scatter, p, rnd) * base;
      const r = spread * Math.sqrt(rScatterR);
      const t = rScatterA * Math.PI * 2;
      const x = p.x + Math.cos(t) * r;
      const y = p.y + Math.sin(t) * r;
      let color = this.o.color;
      if (s.hueJitter > 0 || s.lightJitter > 0) {
        const [h, sat, l] = rgbToHsl(color);
        color = hslToRgb((h + s.hueJitter * (rHue - 0.5) + 1) % 1, sat, Math.min(1, Math.max(0, l + s.lightJitter * (rLight - 0.5))), color.a);
      }
      if (s.mix > 0 && this.o.pickColor) {
        const under = this.o.pickColor(x, y, Math.max(1, size / 4));
        if (under && under.a > 0) {
          const m = s.mix * (under.a / 255);
          color = { r: lerp(color.r, under.r, m), g: lerp(color.g, under.g, m), b: lerp(color.b, under.b, m), a: color.a };
        }
      }
      if (alpha <= 0) continue;
      dirty = rectUnion(dirty, this.o.emit({ x, y, size, angle, roundness, hardness, alpha: Math.min(1, alpha), color }));
    }
    return dirty;
  }
}

/** A stroke's seed from where it starts, so the same stroke drawn again looks the same. */
export function strokeSeed(x: number, y: number, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (const v of [Math.round(x * 16), Math.round(y * 16)]) {
    h ^= v;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
