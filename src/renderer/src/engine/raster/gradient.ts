import type { RGBA } from '../core/color';
import type { Point, Rect } from '../core/geometry';
import type { ImageBuf } from './transform';

export type GradientType = 'linear' | 'radial' | 'angular' | 'diamond';
export type GradientRepeat = 'none' | 'repeat' | 'reflect';

export const GRADIENT_TYPES: readonly GradientType[] = ['linear', 'radial', 'angular', 'diamond'];

/** A colour at a position (0 = start, 1 = end). Straight alpha. */
export interface GradientStop {
  pos: number;
  color: RGBA;
}

export interface GradientSpec {
  type: GradientType;
  stops: GradientStop[];
  start: Point;
  end: Point;
  reverse: boolean;
  repeat: GradientRepeat;
}

/** Most stops a gradient may have (the editor stops adding beyond this). */
export const MAX_STOPS = 16;

/** Stops sorted, clamped to 0…1, at least two (a single colour becomes a flat gradient). */
export function normalizeStops(stops: readonly GradientStop[]): GradientStop[] {
  const s = stops
    .filter((x) => Number.isFinite(x.pos))
    .map((x) => ({ pos: Math.max(0, Math.min(1, x.pos)), color: { ...x.color } }))
    .sort((a, b) => a.pos - b.pos)
    .slice(0, MAX_STOPS);
  if (s.length === 0) return [
    { pos: 0, color: { r: 0, g: 0, b: 0, a: 255 } },
    { pos: 1, color: { r: 255, g: 255, b: 255, a: 255 } },
  ];
  if (s.length === 1) return [{ pos: 0, color: s[0].color }, { pos: 1, color: { ...s[0].color } }];
  return s;
}

const LUT_SIZE = 1024;

/**
 * Colour lookup table (LUT_SIZE entries, premultiplied floats so fades to transparent don't
 * darken): r·a, g·a, b·a, a with a in 0…1.
 */
export function gradientLut(stops: readonly GradientStop[]): Float32Array {
  const s = normalizeStops(stops);
  const lut = new Float32Array(LUT_SIZE * 4);
  let k = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    while (k < s.length - 2 && t > s[k + 1].pos) k++;
    const a = s[k];
    const b = s[k + 1];
    const span = b.pos - a.pos;
    const f = t <= a.pos ? 0 : t >= b.pos ? 1 : span > 0 ? (t - a.pos) / span : 1;
    const aa = a.color.a / 255;
    const ba = b.color.a / 255;
    const alpha = aa + (ba - aa) * f;
    lut[i * 4] = a.color.r * aa + (b.color.r * ba - a.color.r * aa) * f;
    lut[i * 4 + 1] = a.color.g * aa + (b.color.g * ba - a.color.g * aa) * f;
    lut[i * 4 + 2] = a.color.b * aa + (b.color.b * ba - a.color.b * aa) * f;
    lut[i * 4 + 3] = alpha;
  }
  return lut;
}

/** Gradient position before repeat/reverse, for document point (x, y). */
export function gradientParam(type: GradientType, start: Point, end: Point, x: number, y: number): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return 0;
  const px = x - start.x;
  const py = y - start.y;
  switch (type) {
    case 'linear':
      return (px * dx + py * dy) / len2;
    case 'radial':
      return Math.sqrt((px * px + py * py) / len2);
    case 'angular': {
      const t = (Math.atan2(py, px) - Math.atan2(dy, dx)) / (2 * Math.PI);
      return t - Math.floor(t);
    }
    case 'diamond': {
      const len = Math.sqrt(len2);
      const u = (px * dx + py * dy) / len;
      const v = (py * dx - px * dy) / len;
      return (Math.abs(u) + Math.abs(v)) / len;
    }
  }
}

/** Apply repeat and reverse to a raw position, giving 0…1. */
export function wrapParam(t: number, repeat: GradientRepeat, reverse: boolean): number {
  let u: number;
  if (repeat === 'repeat') u = t - Math.floor(t);
  else if (repeat === 'reflect') {
    const m = t - 2 * Math.floor(t / 2);
    u = m > 1 ? 2 - m : m;
  } else u = Math.max(0, Math.min(1, t));
  return reverse ? 1 - u : u;
}

/** 4×4 ordered dither, −0.5…0.5 levels, so smooth gradients don't band in 8 bits. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

/** Render the gradient over r (document coordinates, sampling pixel centres), straight alpha. */
export function renderGradient(spec: GradientSpec, r: Rect, dither = true): ImageBuf {
  const lut = gradientLut(spec.stops);
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  const last = LUT_SIZE - 1;
  for (let y = 0; y < r.h; y++) {
    const dy = r.y + y + 0.5;
    for (let x = 0; x < r.w; x++) {
      const dx = r.x + x + 0.5;
      const t = wrapParam(gradientParam(spec.type, spec.start, spec.end, dx, dy), spec.repeat, spec.reverse);
      const fi = t * last;
      const i0 = Math.floor(fi);
      const i1 = Math.min(last, i0 + 1);
      const f = fi - i0;
      const a = lut[i0 * 4 + 3] + (lut[i1 * 4 + 3] - lut[i0 * 4 + 3]) * f;
      const o = (y * r.w + x) * 4;
      if (a <= 0) continue;
      const d = dither ? BAYER[((r.y + y) & 3) * 4 + ((r.x + x) & 3)] : 0;
      for (let c = 0; c < 3; c++) {
        const pm = lut[i0 * 4 + c] + (lut[i1 * 4 + c] - lut[i0 * 4 + c]) * f;
        out[o + c] = Math.round(pm / a + d);
      }
      out[o + 3] = Math.round(a * 255 + d);
    }
  }
  return { w: r.w, h: r.h, data: out };
}

/** Built-in gradients (original colour choices). `null` colours mean "the primary/secondary colour". */
export interface GradientPreset {
  id: string;
  labelKey: string;
  stops: { pos: number; color: RGBA | 'primary' | 'secondary' | 'clear-primary' }[];
}

const hex = (h: string): RGBA => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 255 });

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { id: 'colors', labelKey: 'gradient.preset.colors', stops: [{ pos: 0, color: 'primary' }, { pos: 1, color: 'secondary' }] },
  { id: 'fade', labelKey: 'gradient.preset.fade', stops: [{ pos: 0, color: 'primary' }, { pos: 1, color: 'clear-primary' }] },
  { id: 'mono', labelKey: 'gradient.preset.mono', stops: [{ pos: 0, color: hex('#000000') }, { pos: 1, color: hex('#ffffff') }] },
  {
    id: 'dusk',
    labelKey: 'gradient.preset.dusk',
    stops: [
      { pos: 0, color: hex('#1b1f4b') },
      { pos: 0.45, color: hex('#8a3f8f') },
      { pos: 0.75, color: hex('#ff7a59') },
      { pos: 1, color: hex('#ffd27a') },
    ],
  },
  {
    id: 'lagoon',
    labelKey: 'gradient.preset.lagoon',
    stops: [
      { pos: 0, color: hex('#0b3a53') },
      { pos: 0.5, color: hex('#1f9aa8') },
      { pos: 1, color: hex('#bff3e4') },
    ],
  },
  {
    id: 'spectrum',
    labelKey: 'gradient.preset.spectrum',
    stops: [
      { pos: 0, color: hex('#e5243b') },
      { pos: 0.17, color: hex('#f5a623') },
      { pos: 0.33, color: hex('#f8e71c') },
      { pos: 0.5, color: hex('#4caf50') },
      { pos: 0.67, color: hex('#1e88e5') },
      { pos: 0.83, color: hex('#5e35b1') },
      { pos: 1, color: hex('#c2185b') },
    ],
  },
  {
    id: 'chrome',
    labelKey: 'gradient.preset.chrome',
    stops: [
      { pos: 0, color: hex('#5f6670') },
      { pos: 0.35, color: hex('#e9edf2') },
      { pos: 0.5, color: hex('#9aa3ad') },
      { pos: 0.65, color: hex('#f7f9fb') },
      { pos: 1, color: hex('#4c525a') },
    ],
  },
  {
    id: 'ember',
    labelKey: 'gradient.preset.ember',
    stops: [
      { pos: 0, color: hex('#2b0a05') },
      { pos: 0.4, color: hex('#b3260e') },
      { pos: 0.75, color: hex('#ff8a3d') },
      { pos: 1, color: hex('#ffe29a') },
    ],
  },
];

/** Concrete stops of a preset for the current colours. */
export function presetStops(p: GradientPreset, primary: RGBA, secondary: RGBA): GradientStop[] {
  return p.stops.map((s) => ({
    pos: s.pos,
    color: s.color === 'primary' ? { ...primary } : s.color === 'secondary' ? { ...secondary } : s.color === 'clear-primary' ? { ...primary, a: 0 } : { ...s.color },
  }));
}

/** Colour of the gradient at position t (0…1), straight alpha (for the editor's new stops). */
export function colorAt(stops: readonly GradientStop[], t: number): RGBA {
  const lut = gradientLut(stops);
  const i = Math.round(Math.max(0, Math.min(1, t)) * (LUT_SIZE - 1)) * 4;
  const a = lut[i + 3];
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: Math.round(lut[i] / a), g: Math.round(lut[i + 1] / a), b: Math.round(lut[i + 2] / a), a: Math.round(a * 255) };
}
