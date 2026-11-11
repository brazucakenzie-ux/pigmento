/**
 * A brush is data: a tip, how dabs are placed along the stroke, and how input (pressure, tilt,
 * speed, randomness) changes them. The same settings drive Brush, Pencil, Eraser and the
 * pixel tools, and are what the Brush Designer edits and brush packs store.
 */
export const DYNAMIC_SOURCES = ['off', 'pressure', 'tilt', 'speed', 'random'] as const;
export type DynamicSource = (typeof DYNAMIC_SOURCES)[number];

/** Parameters a dynamic can drive. */
export const DYNAMIC_TARGETS = ['size', 'opacity', 'flow', 'angle', 'roundness', 'scatter', 'hardness'] as const;
export type DynamicTarget = (typeof DYNAMIC_TARGETS)[number];

/**
 * An input mapped through a curve (points from (0, a) to (1, b), x ascending). The result
 * scales the parameter between `min` (curve at 0) and full (curve at 1). For angle it turns
 * the tip by up to a full circle instead.
 */
export interface Dynamic {
  source: DynamicSource;
  curve: readonly (readonly [number, number])[];
  min: number;
}

export type TipSpec =
  /** Anti-aliased ellipse with a hardness falloff. */
  | { kind: 'round' }
  /** Square with a hardness falloff. */
  | { kind: 'square' }
  /** A greyscale mask (built-in procedural tip or a user's image), by id. */
  | { kind: 'image'; id: string };

export const TEXTURE_MODES = ['multiply', 'subtract'] as const;
export type TextureMode = (typeof TEXTURE_MODES)[number];

/** Paper grain fixed to the image: where the grain is low, less paint lands. */
export interface TextureSpec {
  id: string;
  /** Size of the grain, 0.25–8 (1 = the texture's own pixels). */
  scale: number;
  /** How much the grain shows, 0–1. */
  depth: number;
  mode: TextureMode;
}

export interface BrushSettings {
  tip: TipSpec;
  /** Diameter in px when the brush is picked (the tool's size slider overrides it). */
  size: number;
  /** Most the whole stroke covers, 0–1 (overlapping dabs never go past it). */
  opacity: number;
  /** How much each dab adds, 0–1 (dabs build up toward the stroke's opacity). */
  flow: number;
  /** Edge softness of procedural tips: 1 = crisp, 0 = soft to the centre. */
  hardness: number;
  /** Distance between dabs as a fraction of the diameter. */
  spacing: number;
  /** Tip angle in degrees. */
  angle: number;
  /** Height ÷ width of the tip, 0.05–1. */
  roundness: number;
  /** How far dabs wander from the stroke, as a fraction of the diameter. */
  scatter: number;
  /** Dabs at each place along the stroke, 1–16. */
  count: number;
  /** Random variation, 0–1, per dab. */
  sizeJitter: number;
  opacityJitter: number;
  /** 1 = any angle. */
  angleJitter: number;
  hueJitter: number;
  lightJitter: number;
  /** The tip turns with the stroke's direction. */
  followStroke: boolean;
  /** Hard pixels with no anti-aliasing, placed pixel by pixel (pixel art, Paint's pencil). */
  pixel: boolean;
  /** Keeps adding paint while the pointer is held still. */
  airbrush: boolean;
  /** Picks up colour from the image under each dab, 0–1 (wet paint). */
  mix: number;
  texture: TextureSpec | null;
  dynamics: Partial<Record<DynamicTarget, Dynamic>>;
}

export const LINEAR: Dynamic['curve'] = [
  [0, 0],
  [1, 1],
];

export function defaultBrush(over: Partial<BrushSettings> = {}): BrushSettings {
  return {
    tip: { kind: 'round' },
    size: 12,
    opacity: 1,
    flow: 1,
    hardness: 0.8,
    spacing: 0.12,
    angle: 0,
    roundness: 1,
    scatter: 0,
    count: 1,
    sizeJitter: 0,
    opacityJitter: 0,
    angleJitter: 0,
    hueJitter: 0,
    lightJitter: 0,
    followStroke: false,
    pixel: false,
    airbrush: false,
    mix: 0,
    texture: null,
    dynamics: {},
    ...over,
  };
}

/** The curve's value at x (straight lines between its points). */
export function curveAt(curve: Dynamic['curve'], x: number): number {
  if (!curve.length) return x;
  const t = Math.min(1, Math.max(0, x));
  if (t <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (t <= x1) {
      const [x0, y0] = curve[i - 1];
      return x1 === x0 ? y1 : y0 + ((t - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

/** What the input devices say at one point of a stroke (all 0–1 but the tilt direction). */
export interface StrokeInput {
  /** Pen pressure; mice and touch report 1. */
  pressure: number;
  /** Pen tilt away from upright; 0 without a pen. */
  tilt: number;
  /** Pointer speed (0 still, 1 fast). */
  speed: number;
}

/**
 * A dynamic's value for this input: between its `min` and 1. With no dynamic (or `off`) the
 * parameter is unchanged (1).
 */
export function dynamicValue(d: Dynamic | undefined, input: StrokeInput, random: () => number): number {
  if (!d || d.source === 'off') return 1;
  const x = d.source === 'pressure' ? input.pressure : d.source === 'tilt' ? input.tilt : d.source === 'speed' ? input.speed : random();
  const min = Math.min(1, Math.max(0, d.min));
  return min + (1 - min) * Math.min(1, Math.max(0, curveAt(d.curve, x)));
}

/** A small, fast, seeded random generator (mulberry32): the same seed gives the same stroke. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
