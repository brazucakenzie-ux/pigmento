import { describe, expect, it } from 'vitest';
import { identityState, stateMatrix, type PieceState } from '@engine/anim/interpolate';
import { defaultCamera, FLAT_SPACE, placementBounds, placementOf, placementOutline, project, spaceOf, unproject, type Space } from '@engine/anim/space';
import { matApply } from '@engine/core/matrix';
import { PaintDocument } from '@engine/doc/Document';

/** A 100 × 60 piece with its pivot in the middle, shown at (400, 300) in a 800 × 600 picture. */
const W = 100;
const H = 60;
const pivot = { x: 50, y: 30 };
const space: Space = { cx: 400, cy: 300, f: 1000 };
const at = (change: Partial<PieceState>): PieceState => ({ ...identityState(400, 300), ...change });
const close = (p: { x: number; y: number } | null, x: number, y: number) => {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 6);
  expect(p!.y).toBeCloseTo(y, 6);
};

describe('the camera', () => {
  it('starts in the middle at 50 %, which puts it a diagonal in front of the canvas', () => {
    expect(defaultCamera(800, 600)).toEqual({ x: 400, y: 300, strength: 50 });
    expect(spaceOf(defaultCamera(800, 600), 800, 600)).toEqual({ cx: 400, cy: 300, f: 1000 });
    // Stronger perspective is a closer camera; it keeps to 1–100 %.
    expect(spaceOf({ x: 0, y: 0, strength: 100 }, 800, 600).f).toBe(500);
    expect(spaceOf({ x: 0, y: 0, strength: 5000 }, 800, 600).f).toBe(500);
    expect(spaceOf({ x: 0, y: 0, strength: 0 }, 800, 600).f).toBe(50000);
    // A picture has one, and resizing the picture keeps its look (the camera scales with it).
    const doc = new PaintDocument({ width: 800, height: 600 });
    expect(doc.space.f).toBe(1000);
    doc.width = 1600;
    doc.height = 1200;
    expect(doc.space.f).toBe(2000);
  });
});

describe('placing a piece in 3D', () => {
  it('is the 1.1 transform while it has no depth, tilt or turn', () => {
    const s = at({ sx: 1.5, angle: 0.3, skew: 0.1 });
    const pl = placementOf(s, pivot, W, H, space);
    expect(pl.affine).toEqual(stateMatrix(s, pivot));
    expect(pl.front).toBe(true);
    const q = { x: 12, y: 47 };
    const m = matApply(pl.affine!, q.x, q.y);
    close(project(pl, q), m.x, m.y);
  });

  it('pushed back by its depth, it shrinks towards where its pivot shows', () => {
    // As far behind the canvas as the camera is in front: half the size.
    const pl = placementOf(at({ depth: 1000 }), pivot, W, H, space);
    expect(pl.affine).not.toBeNull();
    close(project(pl, { x: 0, y: 0 }), 400 - 25, 300 - 15);
    close(project(pl, pivot), 400, 300);
    expect(pl.depth).toBe(1000);
    // Pulled in front of the canvas it grows, but never past the camera.
    expect(placementOf(at({ depth: -500 }), pivot, W, H, space).affine![0]).toBeCloseTo(2, 9);
    expect(Number.isFinite(placementOf(at({ depth: -5000 }), pivot, W, H, space).affine![0])).toBe(true);
  });

  it('tilted back 60°, its top edge goes away and shrinks; the pivot stays put', () => {
    const t = Math.PI / 3;
    const pl = placementOf(at({ tilt: t }), pivot, W, H, space);
    expect(pl.affine).toBeNull();
    close(project(pl, pivot), 400, 300);
    // The middle of the top edge: 30 px up the sheet becomes 15 px up and 26 px back.
    const z = 30 * Math.sin(t);
    close(project(pl, { x: 50, y: 0 }), 400, 300 - (30 * Math.cos(t) * 1000) / (1000 + z));
    // The top corners close in towards the vanishing point, the bottom ones spread out.
    const topLeft = project(pl, { x: 0, y: 0 })!;
    const bottomLeft = project(pl, { x: 0, y: 60 })!;
    expect(400 - topLeft.x).toBeCloseTo((50 * 1000) / (1000 + z), 6);
    expect(400 - bottomLeft.x).toBeCloseTo((50 * 1000) / (1000 - z), 6);
    expect(pl.depth).toBeCloseTo(0, 9);
    expect(pl.front).toBe(true);
  });

  it('turned like a door, the right edge goes back', () => {
    const pl = placementOf(at({ turn: Math.PI / 4, x: 400, y: 300 }), pivot, W, H, space);
    const right = project(pl, { x: 100, y: 30 })!;
    const left = project(pl, { x: 0, y: 30 })!;
    const zr = 50 * Math.sin(Math.PI / 4);
    expect(right.x - 400).toBeCloseTo((50 * Math.cos(Math.PI / 4) * 1000) / (1000 + zr), 6);
    expect(400 - left.x).toBeCloseTo((50 * Math.cos(Math.PI / 4) * 1000) / (1000 - zr), 6);
    // The right edge is further away, so it's shorter on screen than the left.
    const rightH = project(pl, { x: 100, y: 60 })!.y - project(pl, { x: 100, y: 0 })!.y;
    const leftH = project(pl, { x: 0, y: 60 })!.y - project(pl, { x: 0, y: 0 })!.y;
    expect(rightH).toBeLessThan(leftH);
  });

  it('turned or tilted past edge-on, the camera sees its back', () => {
    expect(placementOf(at({ turn: Math.PI }), pivot, W, H, space).front).toBe(false);
    expect(placementOf(at({ tilt: (2 * Math.PI) / 3 }), pivot, W, H, space).front).toBe(false);
    expect(placementOf(at({ turn: 2 * Math.PI + 0.2 }), pivot, W, H, space).front).toBe(true);
    // Spin and flips don't turn it round: a mirror image still faces the camera.
    expect(placementOf(at({ sx: -1, angle: 2, tilt: 0.1 }), pivot, W, H, space).front).toBe(true);
  });

  it('finds the piece point under a canvas point again', () => {
    const pl = placementOf(at({ tilt: 0.7, turn: -0.4, depth: 300, angle: 0.5, sx: 1.2 }), pivot, W, H, space);
    for (const q of [{ x: 0, y: 0 }, { x: 73.2, y: 11.5 }, { x: 100, y: 60 }]) {
      const back = unproject(pl, project(pl, q)!);
      close(back, q.x, q.y);
    }
  });

  it('cuts a sheet reaching behind the camera off just in front of it', () => {
    // Tilted nearly flat and pulled towards the camera, the bottom edge passes behind it.
    const pl = placementOf(at({ tilt: 1.4, depth: -980, sy: 100 }), pivot, W, H, space);
    expect(project(pl, { x: 50, y: 60 })).toBeNull();
    const outline = placementOutline(pl, W, H, space);
    expect(outline.length).toBeGreaterThanOrEqual(3);
    for (const p of outline) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    const b = placementBounds(pl, W, H, space)!;
    expect(b.w).toBeGreaterThan(0);
    // The pivot itself is always kept in front of the camera, however far forward it's pulled.
    close(project(placementOf(at({ depth: -5000 }), pivot, W, H, space), pivot), 400, 300);
  });

  it('a repeating plane runs on to the horizon: a floor’s far-off points rise towards the vanishing point', () => {
    // A floor: tilted back flat, below the vanishing point.
    const pl = placementOf(at({ tilt: Math.PI / 2, y: 500 }), pivot, W, H, space);
    const far = project(pl, { x: 50, y: -1e6 })!;
    expect(far.y).toBeGreaterThan(300);
    expect(far.y).toBeLessThan(301);
    // Not quite flat, its horizon is f·cot(tilt) above the vanishing point.
    const leaning = placementOf(at({ tilt: 1.5, y: 500 }), pivot, W, H, space);
    expect(project(leaning, { x: 50, y: -1e9 })!.y).toBeCloseTo(300 - 1000 / Math.tan(1.5), 1);
    // With no camera to speak of, depth changes nothing.
    expect(placementOf(at({ depth: 1000 }), pivot, W, H, FLAT_SPACE).affine![0]).toBeCloseTo(1, 6);
  });
});
