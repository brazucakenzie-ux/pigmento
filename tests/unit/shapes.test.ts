import { describe, expect, it } from 'vitest';
import { en } from '../../src/renderer/src/i18n/en';
import { pathBounds, PathBuilder, toSvgPath, type PathCmd } from '@engine/shapes/path';
import {
  defaultParams,
  resolveParams,
  shapePath,
  shapeRegistry,
  SHAPE_CATEGORIES,
  type ShapeDef,
} from '@engine/shapes/ShapeRegistry';
import { BUILTIN_SHAPES } from '@engine/shapes/library';

const all = shapeRegistry.all();

function finite(cmds: readonly PathCmd[]): boolean {
  return cmds.every((c) =>
    Object.values(c).every((v) => typeof v === 'string' || Number.isFinite(v)),
  );
}

/** Parameter sets worth trying: defaults, every slider at its min and at its max. */
function paramSets(def: ShapeDef): Record<string, number>[] {
  const sets = [defaultParams(def)];
  for (const p of def.params) {
    sets.push({ ...defaultParams(def), [p.key]: p.min });
    sets.push({ ...defaultParams(def), [p.key]: p.max });
  }
  return sets;
}

describe('shape library', () => {
  it('registers 150+ shapes in 11 categories, all with unique ids', () => {
    expect(all.length).toBeGreaterThanOrEqual(150);
    expect(all.length).toBe(BUILTIN_SHAPES.length);
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
    expect(SHAPE_CATEGORIES).toHaveLength(11);
    for (const cat of SHAPE_CATEGORIES)
      expect(shapeRegistry.byCategory(cat).length, cat).toBeGreaterThanOrEqual(5);
  });

  it('has a name for every shape, slider and category', () => {
    const keys = en as Record<string, string>;
    for (const d of all) {
      expect(keys[d.labelKey], d.labelKey).toBeTruthy();
      for (const p of d.params) expect(keys[p.labelKey], p.labelKey).toBeTruthy();
    }
    for (const c of SHAPE_CATEGORIES) expect(keys[`shapecat.${c}`], c).toBeTruthy();
  });

  it('keeps sliders sensible', () => {
    for (const d of all) {
      for (const p of d.params) {
        expect(p.min, `${d.id}.${p.key}`).toBeLessThan(p.max);
        expect(p.default, `${d.id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(p.default, `${d.id}.${p.key}`).toBeLessThanOrEqual(p.max);
        expect(p.step).toBeGreaterThan(0);
      }
    }
  });

  it('draws every shape inside its box, at any size and slider value', () => {
    const boxes: [number, number][] = [
      [100, 100],
      [240, 60],
      [30, 180],
      [2, 2],
    ];
    for (const d of all) {
      for (const params of paramSets(d)) {
        for (const [w, h] of boxes) {
          const cmds = shapePath(d, w, h, params);
          const at = `${d.id} ${w}×${h} ${JSON.stringify(params)}`;
          expect(cmds.length, at).toBeGreaterThan(1);
          expect(cmds[0].op, at).toBe('M');
          expect(finite(cmds), at).toBe(true);
          const b = pathBounds(cmds)!;
          const tol = Math.max(w, h) * 0.01 + 1e-6;
          expect(b.x, at).toBeGreaterThanOrEqual(-tol);
          expect(b.y, at).toBeGreaterThanOrEqual(-tol);
          expect(b.x + b.w, at).toBeLessThanOrEqual(w + tol);
          expect(b.y + b.h, at).toBeLessThanOrEqual(h + tol);
        }
      }
    }
  });

  it('fills most of the box (no shape is a speck in a corner)', () => {
    for (const d of all) {
      const b = pathBounds(shapePath(d, 100, 100))!;
      expect(Math.max(b.w, b.h), d.id).toBeGreaterThan(80);
    }
  });

  it('changes the outline when a slider moves', () => {
    for (const d of all) {
      for (const p of d.params) {
        const lo = toSvgPath(shapePath(d, 100, 100, { ...defaultParams(d), [p.key]: p.min }));
        const hi = toSvgPath(shapePath(d, 100, 100, { ...defaultParams(d), [p.key]: p.max }));
        expect(lo, `${d.id}.${p.key}`).not.toBe(hi);
      }
    }
  });

  it('clamps and completes parameters', () => {
    const star = shapeRegistry.get('star-5')!;
    const inner = star.params.find((p) => p.key === 'inner')!;
    expect(resolveParams(star, { inner: 1e9 }).inner).toBe(inner.max);
    expect(resolveParams(star, { inner: Number.NaN }).inner).toBe(inner.default);
    expect(resolveParams(star, {})).toEqual(defaultParams(star));
  });

  it('searches names, ids and keywords', () => {
    const name = (d: ShapeDef) => (en as Record<string, string>)[d.labelKey];
    expect(shapeRegistry.search('heart', name).map((d) => d.id)).toContain('heart');
    expect(shapeRegistry.search('right arrow', name).map((d) => d.id)).toContain('arrow-right');
    expect(shapeRegistry.search('database', name).map((d) => d.id)).toContain('flow-disk');
    expect(shapeRegistry.search('', name)).toHaveLength(all.length);
    expect(shapeRegistry.search('zzzz-nothing', name)).toHaveLength(0);
  });

  it('refuses a second shape with the same id', () => {
    expect(() => shapeRegistry.register(all[0])).toThrow();
  });
});

describe('path builder', () => {
  it('writes SVG path data and finds bounds', () => {
    const b = new PathBuilder().m(0, 0).l(10, 0).l(10, 5).z();
    expect(toSvgPath(b.cmds)).toBe('M0 0L10 0L10 5Z');
    expect(pathBounds(b.cmds)).toEqual({ x: 0, y: 0, w: 10, h: 5 });
  });

  it('draws ellipses through their extremes', () => {
    const b = new PathBuilder().ellipse(50, 40, 30, 20);
    const r = pathBounds(b.cmds)!;
    expect(r.x).toBeCloseTo(20, 1);
    expect(r.y).toBeCloseTo(20, 1);
    expect(r.w).toBeCloseTo(60, 1);
    expect(r.h).toBeCloseTo(40, 1);
  });

  it('makes stars with alternating radii', () => {
    const pts = PathBuilder.star(0, 0, 10, 10, 5, 0.5);
    expect(pts).toHaveLength(10);
    expect(Math.hypot(...pts[0])).toBeCloseTo(10);
    expect(Math.hypot(...pts[1])).toBeCloseTo(5);
  });
});
