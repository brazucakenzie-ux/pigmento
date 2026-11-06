import { describe, expect, it } from 'vitest';
import { matRotate, matChain, matTranslate, matScale } from '@engine/core/matrix';
import { affineTransform } from '@engine/raster/transform';
import {
  affineFromParams,
  applyHomography,
  fitAffine,
  homographyFromQuad,
  invertHomography,
  paramsFromAffine,
  perspectiveWarp,
  quadContains,
  quadIsAffine,
  quadIsConvex,
  quadToAffine,
  quadWithParams,
  rectQuad,
  type Quad,
} from '@engine/raster/warp';
import { dragHandle, flipQuad, quadCentre, rotateQuad, scaleQuad } from '@engine/live/quadEdit';

const close = (a: { x: number; y: number }, b: { x: number; y: number }, d = 6) => {
  expect(a.x).toBeCloseTo(b.x, d);
  expect(a.y).toBeCloseTo(b.y, d);
};

/** w×h image whose pixel (x, y) is (x, y, 0, 255) — easy to read back after warping. */
function coords(w: number, h: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x, y, 0, 255], (y * w + x) * 4);
  return { w, h, data };
}

const trapezoid: Quad = [
  { x: 40, y: 10 },
  { x: 160, y: 10 },
  { x: 190, y: 110 },
  { x: 10, y: 110 },
];

describe('homography', () => {
  it('maps the source corners onto the quad, and back', () => {
    const m = homographyFromQuad(100, 50, trapezoid);
    const src = [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
    ];
    src.forEach(([x, y], i) => close(applyHomography(m, x, y), trapezoid[i]));
    const inv = invertHomography(m)!;
    close(applyHomography(inv, 190, 110), { x: 100, y: 50 });
  });

  it('is affine for parallelograms and agrees with the affine path', () => {
    const q = rectQuad({ x: 5, y: 7, w: 20, h: 10 });
    expect(quadIsAffine(q)).toBe(true);
    expect(quadIsAffine(trapezoid)).toBe(false);
    const m = homographyFromQuad(20, 10, q);
    close(applyHomography(m, 10, 5), { x: 15, y: 12 });
    expect(quadToAffine(20, 10, q)).toEqual([1, 0, 0, 1, 5, 7]);
  });

  it('checks convexity and containment', () => {
    expect(quadIsConvex(trapezoid)).toBe(true);
    const bowtie: Quad = [trapezoid[0], trapezoid[2], trapezoid[1], trapezoid[3]];
    expect(quadIsConvex(bowtie)).toBe(false);
    expect(quadContains(trapezoid, { x: 100, y: 60 })).toBe(true);
    expect(quadContains(trapezoid, { x: 15, y: 15 })).toBe(false);
  });
});

describe('perspective warp', () => {
  it('reproduces the image exactly when the quad is its own rectangle', () => {
    const img = coords(16, 9);
    const out = perspectiveWarp(img, rectQuad({ x: 0, y: 0, w: 16, h: 9 }), true);
    expect([out.x, out.y, out.w, out.h]).toEqual([0, 0, 16, 9]);
    expect([...out.data]).toEqual([...img.data]);
  });

  it('matches the affine warp for a parallelogram', () => {
    const img = coords(30, 20);
    const m = matChain(matTranslate(-15, -10), matRotate(0.4), matScale(1.5, 0.8), matTranslate(60, 40));
    const q: Quad = [
      { x: m[4], y: m[5] },
      { x: m[0] * 30 + m[4], y: m[1] * 30 + m[5] },
      { x: m[0] * 30 + m[2] * 20 + m[4], y: m[1] * 30 + m[3] * 20 + m[5] },
      { x: m[2] * 20 + m[4], y: m[3] * 20 + m[5] },
    ];
    const a = affineTransform(img, m, true);
    const p = perspectiveWarp(img, q, true);
    expect([p.x, p.y, p.w, p.h]).toEqual([a.x, a.y, a.w, a.h]);
    let worst = 0;
    for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - p.data[i]));
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('samples along the perspective: the centre lands where the diagonals cross', () => {
    const img = coords(100, 50);
    const out = perspectiveWarp(img, trapezoid, false);
    const c = quadCentre(trapezoid, 100, 50);
    const px = Math.floor(c.x) - out.x;
    const py = Math.floor(c.y) - out.y;
    const i = (py * out.w + px) * 4;
    expect(Math.abs(out.data[i] - 50)).toBeLessThanOrEqual(1);
    expect(Math.abs(out.data[i + 1] - 25)).toBeLessThanOrEqual(1);
    // Outside the quad (left of its slanted side) stays transparent.
    expect(out.data[((15 - out.y) * out.w + (15 - out.x)) * 4 + 3]).toBe(0);
  });

  it('clips to a rectangle', () => {
    const out = perspectiveWarp(coords(100, 50), trapezoid, true, { x: 0, y: 0, w: 50, h: 50 });
    expect([out.x, out.y, out.w, out.h]).toEqual([10, 10, 40, 40]);
  });
});

describe('transform parameters', () => {
  it('round-trips position, scale, rotation and skew', () => {
    const p = { cx: 120, cy: 80, sx: 1.5, sy: -0.75, angle: 0.6, skew: 0.2 };
    const back = paramsFromAffine(affineFromParams(p, 40, 30), 40, 30);
    for (const k of Object.keys(p) as (keyof typeof p)[]) expect(back[k]).toBeCloseTo(p[k], 9);
  });

  it('fits the affine exactly for parallelograms', () => {
    const m = affineFromParams({ cx: 10, cy: 20, sx: 2, sy: 1, angle: 0.3, skew: -0.1 }, 50, 40);
    const q: Quad = [
      { x: m[4], y: m[5] },
      { x: m[0] * 50 + m[4], y: m[1] * 50 + m[5] },
      { x: m[0] * 50 + m[2] * 40 + m[4], y: m[1] * 50 + m[3] * 40 + m[5] },
      { x: m[2] * 40 + m[4], y: m[3] * 40 + m[5] },
    ];
    fitAffine(50, 40, q).forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
  });

  it('edits one field and keeps the rest', () => {
    const q = rectQuad({ x: 0, y: 0, w: 40, h: 20 });
    const turned = quadWithParams(q, 40, 20, { angle: Math.PI / 2 });
    const p = paramsFromAffine(fitAffine(40, 20, turned), 40, 20);
    expect(p.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(p.sx).toBeCloseTo(1, 9);
    expect([p.cx, p.cy]).toEqual([20, 10].map((v) => expect.closeTo(v, 9)));
    const wide = quadWithParams(q, 40, 20, { sx: 2 });
    close(wide[0], { x: -20, y: 0 });
    close(wide[1], { x: 60, y: 0 });
  });
});

describe('handle editing', () => {
  const q = rectQuad({ x: 100, y: 100, w: 200, h: 100 });

  it('scales from the opposite corner, or uniformly with Shift', () => {
    const s = scaleQuad(q, 200, 100, 'se', { x: 500, y: 300 }, { shift: false, alt: false });
    close(s[0], { x: 100, y: 100 });
    close(s[2], { x: 500, y: 300 });
    const u = scaleQuad(q, 200, 100, 'se', { x: 500, y: 220 }, { shift: true, alt: false });
    close(u[2], { x: 500, y: 300 }); // 2× in both directions
    const fromCentre = scaleQuad(q, 200, 100, 'e', { x: 400, y: 150 }, { shift: false, alt: true });
    close(fromCentre[0], { x: 0, y: 100 });
    close(fromCentre[1], { x: 400, y: 100 });
  });

  it('scales a rotated image along its own sides', () => {
    const turned = rotateQuad(q, 200, 100, { x: 400, y: 150 }, { x: 200, y: 350 }, false); // 90°
    const centre = quadCentre(turned, 200, 100);
    close(centre, { x: 200, y: 150 });
    // The "e" handle now points down (at y 250); dragging it to 450 doubles the width.
    const e = scaleQuad(turned, 200, 100, 'e', { x: 200, y: 450 }, { shift: false, alt: false });
    const p = paramsFromAffine(fitAffine(200, 100, e), 200, 100);
    expect(p.sx).toBeCloseTo(2, 6);
    expect(p.sy).toBeCloseTo(1, 6);
  });

  it('rotates in 15° steps with Shift', () => {
    const r = rotateQuad(q, 200, 100, { x: 400, y: 150 }, { x: 400, y: 160 }, true);
    expect(r).toEqual(q.map((pt) => ({ x: expect.closeTo(pt.x, 9), y: expect.closeTo(pt.y, 9) })));
  });

  it('distorts a corner with Ctrl, skews a side, and makes symmetric perspective', () => {
    const d = dragHandle(q, 200, 100, 'ne', { x: 300, y: 100 }, { x: 330, y: 80 }, 'free', { shift: false, alt: false, ctrl: true });
    close(d[1], { x: 330, y: 80 });
    close(d[0], q[0]);
    const k = dragHandle(q, 200, 100, 'n', { x: 200, y: 100 }, { x: 240, y: 130 }, 'skew', { shift: false, alt: false, ctrl: false });
    close(k[0], { x: 140, y: 100 });
    close(k[1], { x: 340, y: 100 });
    close(k[3], q[3]);
    const p = dragHandle(q, 200, 100, 'nw', { x: 100, y: 100 }, { x: 130, y: 104 }, 'perspective', { shift: false, alt: false, ctrl: false });
    close(p[0], { x: 130, y: 100 });
    close(p[1], { x: 270, y: 100 });
    close(p[2], q[2]);
    expect(quadIsAffine(p)).toBe(false);
  });

  it('refuses edits that would fold the image over itself', () => {
    const folded = dragHandle(q, 200, 100, 'ne', { x: 300, y: 100 }, { x: 50, y: 250 }, 'distort', { shift: false, alt: false, ctrl: false });
    expect(folded).toBe(q);
  });

  it('flips content within the same outline', () => {
    const f = flipQuad(q, 'h');
    expect(f[0]).toEqual(q[1]);
    expect(flipQuad(f, 'h')).toEqual(q);
  });
});
