import { describe, expect, it } from 'vitest';
import { brushRegistry } from '@engine/brush/BrushRegistry';
import '@engine/brush/library';
import { BrushStroke } from '@engine/brush/BrushStroke';
import { dabShapeOf, paintDabInto } from '@engine/brush/dab';
import { isFlatNib, nibAngleOf, nibEnds, tipAngleForNib } from '@engine/brush/nib';
import { defaultBrush, type BrushSettings } from '@engine/brush/types';
import { Surface } from '@engine/raster/Surface';
import { brushOptionsFor } from '@engine/tools/brushTool';

const calligraphy = brushRegistry.get('calligraphy')!;
const still = { pressure: 1, tilt: 0, speed: 0 };

/** Upward to the right on screen (y points down), and downward to the right. */
const UP: [[number, number], [number, number]] = [
  [60, 140],
  [140, 60],
];
const DOWN: [[number, number], [number, number]] = [
  [60, 60],
  [140, 140],
];
const LENGTH = Math.hypot(80, 80);

/** A 20 px stroke's average width: the pixels it covers at least half, over its length. */
function width(settings: BrushSettings, [a, b]: [[number, number], [number, number]]): number {
  const surface = new Surface(200, 200);
  const shape = dabShapeOf(settings);
  const s = new BrushStroke({
    settings,
    size: 20,
    color: { r: 0, g: 0, b: 0, a: 255 },
    seed: 1,
    emit: (d) => paintDabInto(surface, d, shape),
  });
  s.begin({ x: a[0], y: a[1], ...still });
  s.to({ x: b[0], y: b[1], ...still });
  const px = surface.readRect({ x: 0, y: 0, w: 200, h: 200 });
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] >= 128) n++;
  return n / LENGTH;
}

describe('flat nibs (calligraphy)', () => {
  it('draws thin along the nib and thick across it', () => {
    const s = calligraphy.settings;
    // The nib leans like "/": a hairline going up to the right, full width coming down.
    expect(width(s, UP)).toBeLessThan(5);
    expect(width(s, DOWN)).toBeGreaterThan(15);
  });

  it('turns with the nib angle option', () => {
    const s = { ...calligraphy.settings, angle: tipAngleForNib(135) };
    expect(width(s, DOWN)).toBeLessThan(5);
    expect(width(s, UP)).toBeGreaterThan(15);
  });

  it('counts only thin tips at a fixed angle as flat nibs', () => {
    expect(isFlatNib(calligraphy.settings)).toBe(true);
    for (const id of ['round', 'marker', 'highlighter', 'oil', 'confetti', 'pixel-1'])
      expect(isFlatNib(brushRegistry.get(id)!.settings), id).toBe(false);
    const flat = defaultBrush({ roundness: 0.1, angle: 30 });
    expect(isFlatNib(flat)).toBe(true);
    expect(isFlatNib({ ...flat, followStroke: true })).toBe(false);
    expect(isFlatNib({ ...flat, angleJitter: 0.1 })).toBe(false);
    expect(isFlatNib({ ...flat, dynamics: { angle: { source: 'tilt', curve: [], min: 0 } } })).toBe(
      false,
    );
  });

  it('shows the nib angle anticlockwise, 0–179°, and loads it with the brush', () => {
    expect(nibAngleOf(calligraphy.settings)).toBe(45);
    expect(brushOptionsFor(calligraphy).nibAngle).toBe(45);
    for (const deg of [0, 30, 90, 135, 179])
      expect(nibAngleOf({ ...calligraphy.settings, angle: tipAngleForNib(deg) })).toBe(deg);
    expect(nibAngleOf(defaultBrush({ angle: 45 }))).toBe(135);
    expect(nibAngleOf(defaultBrush({ angle: 180 }))).toBe(0);
  });

  it('puts the cursor line across the nib', () => {
    const [a, b] = nibEnds({ x: 100, y: 100 }, 20, tipAngleForNib(45));
    expect(a.x).toBeCloseTo(100 - Math.SQRT1_2 * 10);
    expect(a.y).toBeCloseTo(100 + Math.SQRT1_2 * 10);
    expect(b.x).toBeCloseTo(100 + Math.SQRT1_2 * 10);
    expect(b.y).toBeCloseTo(100 - Math.SQRT1_2 * 10);
  });
});
