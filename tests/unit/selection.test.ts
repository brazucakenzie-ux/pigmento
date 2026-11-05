import { describe, expect, it } from 'vitest';
import { Selection, rasterizePolygon } from '@engine/doc/Selection';

describe('Selection', () => {
  it('builds a rectangular selection clipped to the document', () => {
    const s = Selection.fromRect({ x: -5, y: 10, w: 20, h: 15 }, 100, 100)!;
    expect(s.bounds).toEqual({ x: 0, y: 10, w: 15, h: 15 });
    expect(s.area()).toBe(15 * 15);
    expect(s.contains(0, 10)).toBe(true);
    expect(s.contains(14.9, 24.9)).toBe(true);
    expect(s.contains(15, 10)).toBe(false);
    expect(Selection.fromRect({ x: 200, y: 0, w: 5, h: 5 }, 100, 100)).toBeNull();
  });

  it('rounds fractional rects outward', () => {
    const s = Selection.fromRect({ x: 1.5, y: 2.2, w: 3, h: 3 }, 100, 100)!;
    expect(s.bounds).toEqual({ x: 1, y: 2, w: 4, h: 4 });
  });

  it('rasterises polygons by pixel centres', () => {
    // Right triangle with legs of 10 px.
    const mask = rasterizePolygon(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ],
      { x: 0, y: 0, w: 10, h: 10 },
    );
    let n = 0;
    for (const v of mask) if (v) n++;
    expect(n).toBe(55 - 10); // pixel centres strictly inside x+y<10
    expect(mask[0]).toBe(255);
    expect(mask[9]).toBe(0);
    expect(mask[9 * 10]).toBe(0);
  });

  it('builds free-form selections with tight bounds', () => {
    const s = Selection.fromPolygon(
      [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 20 },
        { x: 10, y: 20 },
      ],
      100,
      100,
    )!;
    expect(s.bounds).toEqual({ x: 10, y: 10, w: 20, h: 10 });
    expect(s.area()).toBe(200);
    expect(s.kind).toBe('polygon');
  });

  it('translates and inverts', () => {
    const s = Selection.fromRect({ x: 10, y: 10, w: 10, h: 10 }, 50, 50)!;
    const t = s.translated(5, -3);
    expect(t.bounds).toEqual({ x: 15, y: 7, w: 10, h: 10 });
    expect(t.outlines[0][0]).toEqual({ x: 15, y: 7 });
    const inv = s.inverted(50, 50)!;
    expect(inv.area()).toBe(2500 - 100);
    expect(inv.contains(12, 12)).toBe(false);
    expect(inv.contains(0, 0)).toBe(true);
    expect(Selection.all(50, 50).inverted(50, 50)).toBeNull();
  });

  it('clips a translated selection back into the document', () => {
    const s = Selection.fromRect({ x: 0, y: 0, w: 10, h: 10 }, 20, 20)!.translated(15, 15);
    const c = s.clipped(20, 20)!;
    expect(c.bounds).toEqual({ x: 15, y: 15, w: 5, h: 5 });
    expect(c.area()).toBe(25);
  });
});
