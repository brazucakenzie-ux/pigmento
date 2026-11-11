import type { RGBA } from '../core/color';
import { Surface } from '../raster/Surface';
import { BrushStroke } from './BrushStroke';
import { dabShapeOf, paintDabInto } from './dab';
import type { BrushSettings } from './types';

/** Brush previews are painted in Pigmento's ultramarine. */
export const PREVIEW_COLOR: RGBA = { r: 75, g: 75, b: 224, a: 255 };

/**
 * A sample stroke with a brush: an S-curve across a w×h box whose pressure swells and tapers,
 * so size and opacity dynamics show. Same brush, same picture (the stroke is seeded).
 */
export function brushPreview(settings: BrushSettings, w: number, h: number, color: RGBA = PREVIEW_COLOR): { w: number; h: number; data: Uint8ClampedArray } {
  const surface = new Surface(w, h);
  const shape = dabShapeOf(settings);
  const size = Math.max(1, Math.min(settings.size, h * 0.42));
  const stroke = new BrushStroke({ settings, size, color, seed: 1, emit: (d) => paintDabInto(surface, d, shape) });
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = {
      x: w * (0.08 + 0.84 * t),
      y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.2,
      pressure: Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.85 + 0.15,
      tilt: 0,
      speed: 0.3,
    };
    if (i === 0) stroke.begin(p);
    else stroke.to(p);
  }
  return { w, h, data: surface.readRect({ x: 0, y: 0, w, h }) };
}
