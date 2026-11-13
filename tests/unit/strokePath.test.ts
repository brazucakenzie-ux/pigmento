import { describe, expect, it } from 'vitest';
import { flattenPath, outlinesToLines, pathBrushSettings, strokeLines, taperAt } from '@engine/brush/strokePath';
import { defaultBrush } from '@engine/brush/types';
import { Surface } from '@engine/raster/Surface';

const RED = { r: 200, g: 0, b: 0, a: 255 };

describe('stroking paths with a brush', () => {
  it('flattens lines and curves, closing closed subpaths', () => {
    const [open, closed] = flattenPath([
      { op: 'M', x: 0, y: 0 },
      { op: 'C', x1: 0, y1: 40, x2: 40, y2: 40, x: 40, y: 0 },
      { op: 'M', x: 100, y: 100 },
      { op: 'L', x: 120, y: 100 },
      { op: 'L', x: 120, y: 120 },
      { op: 'Z' },
    ]);
    expect(open.closed).toBe(false);
    expect(open.points.length).toBeGreaterThan(10);
    expect(open.points[open.points.length - 1]).toEqual({ x: 40, y: 0 });
    // The curve bulges down to y = 30 at its middle.
    expect(Math.max(...open.points.map((p) => p.y))).toBeCloseTo(30, 0);
    expect(closed.closed).toBe(true);
    expect(closed.points[closed.points.length - 1]).toEqual({ x: 100, y: 100 });
    expect(outlinesToLines([[{ x: 0, y: 0 }, { x: 5, y: 0 }], [{ x: 1, y: 1 }]])).toEqual([
      {
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 0, y: 0 },
        ],
        closed: true,
      },
    ]);
  });

  it('tapers pressure in and out, and makes plain brushes follow it', () => {
    expect(taperAt(0)).toBeCloseTo(0.05);
    expect(taperAt(0.5)).toBe(1);
    expect(taperAt(1)).toBeCloseTo(0.05);
    expect(taperAt(0.1)).toBeGreaterThan(0.05);
    expect(taperAt(0.1)).toBeLessThan(1);
    const plain = defaultBrush();
    expect(pathBrushSettings(plain, false)).toBe(plain);
    expect(pathBrushSettings(plain, true).dynamics.size?.source).toBe('pressure');
    const own = defaultBrush({ dynamics: { opacity: { source: 'pressure', curve: [[0, 0], [1, 1]], min: 0.2 } } });
    expect(pathBrushSettings(own, true)).toBe(own);
  });

  it('paints along the line and nowhere else, thinner at tapered ends', () => {
    const s = new Surface(200, 60);
    const brush = { settings: defaultBrush({ hardness: 1 }), size: 10, color: RED };
    const dirty = strokeLines(s, [{ points: [{ x: 20, y: 30 }, { x: 180, y: 30 }], closed: false }], brush, false);
    expect(dirty).not.toBeNull();
    expect(s.getPixel(100, 30).a).toBe(255);
    expect(s.getPixel(100, 33).a).toBe(255);
    expect(s.getPixel(100, 40).a).toBe(0);
    const t = new Surface(200, 60);
    strokeLines(t, [{ points: [{ x: 20, y: 30 }, { x: 180, y: 30 }], closed: false }], brush, true);
    // Full width in the middle, a thin point near the start.
    expect(t.getPixel(100, 33).a).toBe(255);
    expect(t.getPixel(22, 33).a).toBe(0);
  });
});
