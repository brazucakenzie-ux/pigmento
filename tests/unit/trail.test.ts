import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { emitterPath } from '@engine/anim/follow';
import { makePiece, setKey } from '@engine/anim/piece';
import { Scene } from '@engine/anim/scene';
import {
  colorAt,
  echoCopies,
  emissionAt,
  makeTrail,
  MAX_LIVE_PUFFS,
  slicesPerFrame,
  trailPuffs,
  trailRandom,
  type EmitterPath,
  type Trail,
} from '@engine/anim/trail';
import type { Vec3 } from '@engine/anim/space';

const FPS = 24;
const still: EmitterPath = () => [100, 200, 0];
/** Moving right at `speed` pixels a frame from x = 0 (held before the first frame). */
const moving = (speed: number): EmitterPath => (t) => [Math.max(0, t) * speed, 50, 0];

function trail(change: Partial<Trail> = {}): Trail {
  return { ...makeTrail('t', 'puffs', { x: 0, y: 0 }, 7), drift: 0, spread: 0, ...change };
}

describe('puffs', () => {
  it('come out the same at a frame however it is reached (scrubbing back and forth)', () => {
    const t = trail({ spread: 30, drift: 12, rate: 40, spacing: 5 });
    const path = moving(7);
    const direct = trailPuffs(t, path, 40, FPS);
    // Back and forth over the timeline first, then the same frame again.
    for (const f of [0, 55, 12, 39, 41, 3, 70]) trailPuffs(t, path, f, FPS);
    expect(trailPuffs(t, path, 40, FPS)).toEqual(direct);
    expect(direct.length).toBeGreaterThan(20);
    // And a puff seen on one frame is the same puff on the next, a frame older: risen by its drift.
    const s = trail({ rate: 24, spacing: 0, drift: 12 });
    const ys = (f: number) => trailPuffs(s, still, f, FPS).map((p: { at: Vec3 }) => p.at[1]);
    const now = ys(40);
    const next = ys(41).map((y) => y + 12 / FPS);
    const still40 = now.filter((y) => next.some((z) => Math.abs(z - y) < 1e-9));
    expect(still40.length).toBeGreaterThanOrEqual(now.length - 1);
  });

  it('are born at their rate while still, and live their lifetime', () => {
    const t = trail({ rate: 24, spacing: 0, lifetime: 1 });
    // 24 alive at once, evenly spaced through their lives (a chimney is already smoking at the first frame).
    for (const f of [0, 10, 50.5]) {
      const puffs = trailPuffs({ ...t, drift: 24 }, still, f, FPS);
      expect(puffs.length).toBeGreaterThanOrEqual(24);
      expect(puffs.length).toBeLessThanOrEqual(25);
      const ages = puffs.map((p) => (200 - p.at[1]) / 24).sort((x, y) => x - y);
      for (let i = 1; i < ages.length; i++) expect(ages[i] - ages[i - 1]).toBeCloseTo(1 / 24, 9);
    }
    expect(trailPuffs({ ...t, rate: 0 }, still, 50, FPS)).toEqual([]);
  });

  it('are born by distance travelled too, so a fast piece leaves no gaps', () => {
    const t = trail({ rate: 0, spacing: 10, lifetime: 0.5 });
    // 100 px a frame for 12 frames: 1,200 px, a puff every 10.
    const puffs = trailPuffs(t, moving(100), 30, FPS);
    expect(puffs.length).toBeGreaterThan(110);
    expect(puffs.length).toBeLessThan(130);
    // Spread along the way it went, no gap wider than a few spacings.
    const xs = puffs.map((p) => p.at[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThan(40);
  });

  it('drift and scatter as they age, grow, fade and change colour', () => {
    const t = trail({
      rate: 48,
      spacing: 0,
      lifetime: 2,
      drift: 24,
      driftAngle: -Math.PI / 2,
      size: 10,
      growth: 3,
      opacity: 0.8,
      fade: 1,
      colors: [
        { pos: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { pos: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
      ],
    });
    for (const p of trailPuffs(t, still, 30, FPS)) {
      // Risen 24 px a second for its age, straight up.
      const secs = (200 - p.at[1]) / 24;
      const u = secs / 2;
      expect(p.at[0]).toBeCloseTo(100, 9);
      expect(u).toBeGreaterThanOrEqual(-1e-9);
      expect(u).toBeLessThan(1);
      expect(p.size).toBeCloseTo(10 * (1 + 2 * u), 6);
      expect(p.opacity).toBeCloseTo(0.8 * (1 - u), 6);
      expect(Math.abs(p.color.r - 255 * (1 - u))).toBeLessThanOrEqual(1);
    }
    // Scatter stays within its speed.
    const s = trail({ rate: 48, spacing: 0, lifetime: 1, spread: 30 });
    for (const p of trailPuffs(s, still, 30, FPS)) expect(Math.hypot(p.at[0] - 100, p.at[1] - 200)).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('start and stop with their keyed emission (ignition, burn-out)', () => {
    const t = trail({
      rate: 48,
      spacing: 0,
      lifetime: 1,
      keys: [
        { frame: 20, amount: 0, easing: 'hold' },
        { frame: 30, amount: 1, easing: 'linear' },
        { frame: 60, amount: 0, easing: 'linear' },
      ],
    });
    expect(emissionAt(t, 0)).toBe(0);
    expect(emissionAt(t, 29.9)).toBe(0);
    expect(emissionAt(t, 30)).toBe(1);
    expect(emissionAt(t, 45)).toBeCloseTo(0.5, 12);
    expect(trailPuffs(t, still, 29, FPS)).toEqual([]);
    // Lit at frame 30: five frames on, none older than five frames.
    const lit = trailPuffs({ ...t, drift: 24 }, still, 35, FPS);
    expect(lit.length).toBeGreaterThan(5);
    for (const p of lit) expect(200 - p.at[1]).toBeLessThanOrEqual(24 * (5 / FPS) + 1e-9);
    // Long after burn-out, nothing.
    expect(trailPuffs(t, still, 90, FPS)).toEqual([]);
    expect(emissionAt({ keys: [] }, 5)).toBe(1);
  });

  it('stretch along the way they were going (speed lines), and stop at the most there can be', () => {
    const lines = trailPuffs(trail({ rate: 0, spacing: 20, stretch: true }), moving(30), 20, FPS);
    expect(lines.length).toBeGreaterThan(0);
    for (const p of lines) {
      expect(p.angle).toBeCloseTo(0, 9);
      expect(p.stretch).toBeGreaterThan(1);
    }
    const many = trailPuffs(trail({ rate: 1000, spacing: 0.5, lifetime: 30 }), moving(50), 700, FPS);
    expect(many).toHaveLength(MAX_LIVE_PUFFS);
    // A long lifetime is worked out in fewer slices a frame.
    expect(slicesPerFrame({ lifetime: 30 }, FPS)).toBeLessThan(slicesPerFrame({ lifetime: 1 }, FPS));
  });
});

describe('echoes', () => {
  it('are the piece as it was a gap of frames back, fainter each copy, while emitting', () => {
    const t = { ...makeTrail('e', 'echo', { x: 0, y: 0 }, 1), copies: 3, gap: 2, opacity: 0.9, fade: 1 };
    expect(echoCopies(t, 10)).toEqual([
      { frame: 4, opacity: expect.closeTo(0.9 * 0.25, 9) },
      { frame: 6, opacity: expect.closeTo(0.9 * 0.5, 9) },
      { frame: 8, opacity: expect.closeTo(0.9 * 0.75, 9) },
    ]);
    // None before the first frame.
    expect(echoCopies(t, 3).map((c) => c.frame)).toEqual([1]);
    expect(echoCopies({ ...t, keys: [{ frame: 0, amount: 0, easing: 'linear' }] }, 10)).toEqual([]);
    expect(trailPuffs(t, still, 10, FPS)).toEqual([]);
  });
});

describe('a trail on a piece', () => {
  it('comes from its emitter point, which moves and turns with the piece', () => {
    const doc = new PaintDocument({ width: 400, height: 300 });
    const p = makePiece('p', '', doc.layers[0].id, { w: 40, h: 20, data: new Uint8ClampedArray(3200) }, { x: 0, y: 0, w: 40, h: 20 }, 0);
    p.keyframes = setKey(setKey(p.keyframes, 0, { x: 100, y: 100, angle: 0, easing: 'linear' }), 10, { x: 300, y: 100, angle: Math.PI / 2 });
    doc.pieces = [p];
    // The nozzle: the middle of its left edge.
    const path = emitterPath(doc, 'p', { x: 0, y: 10 });
    expect(path(0)).toEqual([80, 100, 0]);
    const mid = path(5);
    const scene = new Scene(doc.pieces, 5, doc.space);
    expect(mid).toEqual(scene.worldOf(p, { x: 0, y: 10 }));
    // Turned a quarter by frame 10: the nozzle is above the pivot.
    const end = path(10);
    expect(end[0]).toBeCloseTo(300, 9);
    expect(end[1]).toBeCloseTo(80, 9);
    // Before the first frame it holds.
    expect(path(-5)).toEqual(path(0));
  });

  it('uses seeded numbers that are the same every time and spread evenly', () => {
    expect(trailRandom(3, 10, 2)).toBe(trailRandom(3, 10, 2));
    expect(trailRandom(3, 10, 2)).not.toBe(trailRandom(4, 10, 2));
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const r = trailRandom(9, i, 0);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      sum += r;
    }
    expect(sum / 10000).toBeCloseTo(0.5, 1);
    const stops = [
      { pos: 0.2, color: { r: 0, g: 0, b: 0, a: 255 } },
      { pos: 0.6, color: { r: 200, g: 100, b: 0, a: 55 } },
    ];
    expect(colorAt(stops, 0)).toEqual({ r: 0, g: 0, b: 0, a: 255 });
    expect(colorAt(stops, 0.4)).toEqual({ r: 100, g: 50, b: 0, a: 155 });
    expect(colorAt(stops, 1)).toEqual({ r: 200, g: 100, b: 0, a: 55 });
  });
});
