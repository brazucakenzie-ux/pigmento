import { describe, expect, it } from 'vitest';
import {
  borderMask,
  colorRangeMask,
  combineMasks,
  ellipseMask,
  ellipseOutline,
  featherMask,
  growMask,
  selectionOutlines,
  shrinkMask,
  tighten,
  traceOutlines,
  type PlacedMask,
} from '@engine/doc/selectionMath';

/** A solid rectangle mask. */
const box = (x: number, y: number, w: number, h: number, v = 255): PlacedMask => ({
  bounds: { x, y, w, h },
  mask: new Uint8Array(w * h).fill(v),
});

const at = (m: PlacedMask | null, x: number, y: number): number => {
  if (!m) return 0;
  const lx = x - m.bounds.x;
  const ly = y - m.bounds.y;
  if (lx < 0 || ly < 0 || lx >= m.bounds.w || ly >= m.bounds.h) return 0;
  return m.mask[ly * m.bounds.w + lx];
};

const areaOf = (m: PlacedMask | null): number => (m ? m.mask.reduce((n, v) => n + (v >= 128 ? 1 : 0), 0) : 0);

describe('combining selections', () => {
  const a = box(0, 0, 10, 10);
  const b = box(5, 5, 10, 10);

  it('replace takes the new selection', () => {
    expect(combineMasks(a, b, 'replace')).toBe(b);
  });

  it('add covers both areas', () => {
    const r = combineMasks(a, b, 'add')!;
    expect(r.bounds).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(areaOf(r)).toBe(100 + 100 - 25);
    expect(at(r, 2, 12)).toBe(0);
    expect(at(r, 12, 12)).toBe(255);
  });

  it('subtract removes the overlap and keeps the rest', () => {
    const r = combineMasks(a, b, 'subtract')!;
    expect(areaOf(r)).toBe(75);
    expect(at(r, 7, 7)).toBe(0);
    expect(at(r, 2, 7)).toBe(255);
  });

  it('intersect keeps only the overlap', () => {
    const r = combineMasks(a, b, 'intersect')!;
    expect(r.bounds).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(areaOf(r)).toBe(25);
  });

  it('handles missing selections', () => {
    expect(combineMasks(null, b, 'add')).toBe(b);
    expect(combineMasks(null, b, 'subtract')).toBeNull();
    expect(combineMasks(null, b, 'intersect')).toBeNull();
    expect(combineMasks(a, box(50, 50, 2, 2), 'intersect')).toBeNull();
  });

  it('uses fuzzy logic for soft masks', () => {
    const soft = box(0, 0, 1, 1, 100);
    const half = box(0, 0, 1, 1, 200);
    expect(at(combineMasks(soft, half, 'add'), 0, 0)).toBe(200);
    expect(at(combineMasks(soft, half, 'intersect'), 0, 0)).toBe(100);
    expect(at(combineMasks(half, soft, 'subtract'), 0, 0)).toBe(155);
  });

  it('tightens to the remaining pixels', () => {
    const m = box(0, 0, 10, 10, 0);
    m.mask[3 * 10 + 4] = 255;
    expect(tighten(m)!.bounds).toEqual({ x: 4, y: 3, w: 1, h: 1 });
    expect(tighten(box(0, 0, 3, 3, 0))).toBeNull();
  });
});

describe('ellipse selection', () => {
  it('covers π·a·b pixels with soft edges', () => {
    const m = ellipseMask({ x: 10, y: 20, w: 100, h: 60 }, 500, 500)!;
    const total = m.mask.reduce((n, v) => n + v / 255, 0);
    expect(total).toBeGreaterThan(Math.PI * 50 * 30 * 0.995);
    expect(total).toBeLessThan(Math.PI * 50 * 30 * 1.005);
    expect(at(m, 60, 50)).toBe(255);
    expect(at(m, 11, 21)).toBe(0);
    // Some edge pixels are partial (anti-aliased).
    expect(m.mask.some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('is clipped to the canvas', () => {
    const m = ellipseMask({ x: -50, y: -50, w: 100, h: 100 }, 30, 30)!;
    expect(m.bounds.x).toBe(0);
    expect(m.bounds.y).toBe(0);
    expect(m.bounds.w).toBeLessThanOrEqual(30);
    expect(ellipseMask({ x: 100, y: 100, w: 10, h: 10 }, 30, 30)).toBeNull();
  });

  it('has an outline on the ellipse', () => {
    const pts = ellipseOutline({ x: 0, y: 0, w: 200, h: 100 });
    for (const p of pts) expect(((p.x - 100) / 100) ** 2 + ((p.y - 50) / 50) ** 2).toBeCloseTo(1, 6);
  });
});

describe('outline tracing', () => {
  it('traces a rectangle as four corners', () => {
    expect(traceOutlines(box(3, 4, 5, 2))).toEqual([
      [
        { x: 3, y: 4 },
        { x: 8, y: 4 },
        { x: 8, y: 6 },
        { x: 3, y: 6 },
      ],
    ]);
  });

  it('traces holes and separate parts as their own loops', () => {
    const ring = box(0, 0, 5, 5);
    ring.mask[2 * 5 + 2] = 0; // hole in the middle
    const loops = traceOutlines(ring);
    expect(loops).toHaveLength(2);
    expect(loops[1]).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
    ]);

    // Two pixels touching only at a corner are separate regions.
    const diag = box(0, 0, 2, 2, 0);
    diag.mask[0] = 255;
    diag.mask[3] = 255;
    expect(traceOutlines(diag)).toHaveLength(2);
  });

  it('ignores coverage below half', () => {
    expect(traceOutlines(box(0, 0, 4, 4, 127))).toEqual([]);
    expect(traceOutlines(box(0, 0, 4, 4, 128))).toHaveLength(1);
  });

  it('traces busy masks from a coarser copy so the ants stay drawable', () => {
    const w = 600;
    const h = 400;
    const noisy = box(10, 20, w, h, 0);
    let seed = 7;
    for (let i = 0; i < noisy.mask.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 3 === 0) noisy.mask[i] = 255;
    }
    const full = traceOutlines(noisy).reduce((n, l) => n + l.length, 0);
    const limited = selectionOutlines(noisy, 20_000);
    const pts = limited.flat();
    expect(pts.length).toBeLessThan(20_000);
    expect(pts.length).toBeLessThan(full / 5);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(10 + w);
      expect(p.y).toBeGreaterThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(20 + h);
    }
    // Ordinary masks are traced exactly.
    expect(selectionOutlines(box(3, 4, 5, 2), 20_000)).toEqual(traceOutlines(box(3, 4, 5, 2)));
  });

  it('traces an L shape with six corners', () => {
    const l = box(0, 0, 3, 3, 0);
    for (const i of [0, 3, 6, 7, 8]) l.mask[i] = 255;
    const [loop] = traceOutlines(l);
    expect(loop).toHaveLength(6);
  });
});

describe('grow, shrink, feather and border', () => {
  it('grows by a radius with rounded corners', () => {
    const g = growMask(box(50, 50, 10, 10), 5, 200, 200)!;
    expect(g.bounds).toEqual({ x: 45, y: 45, w: 20, h: 20 });
    expect(at(g, 45, 55)).toBe(255); // straight out from an edge
    expect(at(g, 45, 45)).toBe(0); // the corner is rounded off
    expect(areaOf(g)).toBeGreaterThan(100 + 4 * 50);
    expect(areaOf(g)).toBeLessThan(400);
  });

  it('grows only inside the canvas', () => {
    const g = growMask(box(0, 0, 10, 10), 4, 12, 12)!;
    expect(g.bounds).toEqual({ x: 0, y: 0, w: 12, h: 12 });
  });

  it('shrinks by a radius and can vanish', () => {
    const s = shrinkMask(box(50, 50, 20, 20), 3, 200, 200, false)!;
    expect(s.bounds).toEqual({ x: 53, y: 53, w: 14, h: 14 });
    expect(shrinkMask(box(50, 50, 4, 4), 3, 200, 200, false)).toBeNull();
  });

  it('treats the canvas edge as a selection edge only when asked', () => {
    const all = box(0, 0, 40, 30);
    expect(shrinkMask(all, 5, 40, 30, false)!.bounds).toEqual({ x: 0, y: 0, w: 40, h: 30 });
    expect(shrinkMask(all, 5, 40, 30, true)!.bounds).toEqual({ x: 5, y: 5, w: 30, h: 20 });
  });

  it('feathers into a soft edge that keeps the area', () => {
    const f = featherMask(box(50, 50, 40, 40), 8, 200, 200, false)!;
    const total = f.mask.reduce((n, v) => n + v / 255, 0);
    expect(total).toBeGreaterThan(1600 * 0.97);
    expect(total).toBeLessThan(1600 * 1.03);
    expect(at(f, 70, 70)).toBe(255);
    const edge = at(f, 50, 70);
    expect(edge).toBeGreaterThan(90);
    expect(edge).toBeLessThan(165);
    expect(f.bounds.x).toBeLessThan(50);
  });

  it('keeps the canvas edge sharp when feathering a full selection', () => {
    const f = featherMask(box(0, 0, 30, 30), 6, 30, 30, false)!;
    expect(at(f, 0, 0)).toBe(255);
    const soft = featherMask(box(0, 0, 30, 30), 6, 30, 30, true)!;
    expect(at(soft, 0, 0)).toBeLessThan(200);
  });

  it('borders the edge with a band', () => {
    const b = borderMask(box(50, 50, 40, 40), 6, 200, 200, false)!;
    expect(at(b, 70, 70)).toBe(0); // the middle is gone
    expect(at(b, 50, 70)).toBe(255); // on the old edge
    expect(at(b, 47, 70)).toBe(255); // just outside it
    expect(at(b, 40, 70)).toBe(0);
    expect(borderMask(box(0, 0, 30, 30), 6, 30, 30, false)).toBeNull();
  });
});

describe('colour range', () => {
  const img = (pixels: [number, number, number, number][]) => new Uint8ClampedArray(pixels.flat());

  it('selects exact matches at zero tolerance', () => {
    const d = img([
      [255, 0, 0, 255],
      [254, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    const m = colorRangeMask(d, 3, 1, { r: 255, g: 0, b: 0, a: 255 }, 0)!;
    expect([...m.mask]).toEqual([255, 0, 255]);
  });

  it('fades out towards the tolerance', () => {
    const d = img([
      [200, 0, 0, 255],
      [190, 0, 0, 255],
      [180, 0, 0, 255],
      [150, 0, 0, 255],
    ]);
    // Tolerance 10% ≈ 25.5 levels: full up to ~12.75, then fading to 0.
    const m = colorRangeMask(d, 4, 1, { r: 200, g: 0, b: 0, a: 255 }, 10)!;
    expect(m.mask[0]).toBe(255);
    expect(m.mask[1]).toBe(255);
    expect(m.mask[2]).toBeGreaterThan(0);
    expect(m.mask[2]).toBeLessThan(255);
    expect(m.bounds.w).toBe(3);
  });

  it('returns null when nothing matches', () => {
    expect(colorRangeMask(img([[0, 0, 0, 255]]), 1, 1, { r: 255, g: 255, b: 255, a: 255 }, 20)).toBeNull();
  });
});
