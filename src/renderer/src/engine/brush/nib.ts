import type { Point } from '../core/geometry';
import type { BrushSettings } from './types';

/** Tips at most this thick for their width are flat nibs. */
const FLAT = 0.25;

/**
 * A flat nib held at a fixed angle, like a broad-edge pen: strokes are thick across the nib and
 * thin along it. The Brush tool lets you set its angle, and the cursor shows it as a line.
 */
export function isFlatNib(s: BrushSettings): boolean {
  const turns =
    s.followStroke ||
    s.angleJitter > 0 ||
    (s.dynamics.angle !== undefined && s.dynamics.angle.source !== 'off');
  return s.tip.kind !== 'image' && !s.pixel && s.roundness <= FLAT && !turns;
}

/**
 * The nib angle the options bar shows: 0–179°, anticlockwise from horizontal, so 45° leans
 * like "/". Tip angles turn clockwise (the image's y axis points down).
 */
export function nibAngleOf(s: BrushSettings): number {
  return ((-Math.round(s.angle) % 180) + 180) % 180;
}

/** The tip angle for a nib angle from the options bar. */
export function tipAngleForNib(deg: number): number {
  return -deg;
}

/** The ends of a nib `size` px wide at `tipAngle`, centred on p. */
export function nibEnds(p: Point, size: number, tipAngle: number): [Point, Point] {
  const a = (tipAngle * Math.PI) / 180;
  const dx = (Math.cos(a) * size) / 2;
  const dy = (Math.sin(a) * size) / 2;
  return [
    { x: p.x - dx, y: p.y - dy },
    { x: p.x + dx, y: p.y + dy },
  ];
}
