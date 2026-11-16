import { describe, expect, it } from 'vitest';
import { matApply } from '@engine/core/matrix';
import {
  bezierPoint,
  ease,
  EASINGS,
  identityState,
  movePivot,
  pointAlongCurve,
  stateAt,
  stateMatrix,
  type Keyframe,
} from '@engine/anim/interpolate';
import { advance, clampFrame, clampFps, clampLength, type PlayState } from '@engine/anim/timeline';

const key = (frame: number, change: Partial<Keyframe> = {}): Keyframe => ({
  ...identityState(0, 0),
  frame,
  easing: 'linear',
  out: null,
  in: null,
  ...change,
});

describe('easing', () => {
  it('starts at 0, ends at 1 and stays in range for every easing', () => {
    for (const e of EASINGS) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBe(1);
      for (let u = 0; u <= 1; u += 0.05) {
        expect(ease(e, u)).toBeGreaterThanOrEqual(0);
        expect(ease(e, u)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has the expected shapes', () => {
    expect(ease('linear', 0.25)).toBe(0.25);
    expect(ease('easeIn', 0.5)).toBeCloseTo(0.125);
    expect(ease('easeOut', 0.5)).toBeCloseTo(0.875);
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('easeInOut', 0.25)).toBeCloseTo(0.0625);
    expect(ease('hold', 0.99)).toBe(0);
    // Out of range progress is clamped.
    expect(ease('linear', -1)).toBe(0);
    expect(ease('linear', 2)).toBe(1);
  });
});

describe('stateAt', () => {
  const keys = [key(0, { x: 0, y: 0 }), key(10, { x: 100, y: 50, sx: 2, sy: 0.5, angle: 4 * Math.PI, opacity: 0, easing: 'easeIn' }), key(20, { x: 100, y: 50 })];

  it('holds the first keyframe before it and the last after it', () => {
    expect(stateAt(keys, -5)).toMatchObject({ x: 0, y: 0, sx: 1 });
    expect(stateAt(keys, 99)).toMatchObject({ x: 100, y: 50, sx: 1 });
    expect(stateAt([], 3)).toBeNull();
  });

  it('blends every value linearly, without wrapping rotation', () => {
    const s = stateAt(keys, 5)!;
    expect(s.x).toBeCloseTo(50);
    expect(s.y).toBeCloseTo(25);
    expect(s.sx).toBeCloseTo(1.5);
    expect(s.sy).toBeCloseTo(0.75);
    // Two whole turns over ten frames: one turn by frame 5.
    expect(s.angle).toBeCloseTo(2 * Math.PI);
    expect(s.opacity).toBeCloseTo(0.5);
  });

  it('uses the easing of the keyframe a segment starts from', () => {
    const s = stateAt(keys, 15)!;
    // easeIn at u = 0.5 → 0.125 of the way from keyframe 10 back to scale 1.
    expect(s.sx).toBeCloseTo(2 - 0.125);
  });

  it('works on fractional frames and on exact keyframes', () => {
    expect(stateAt(keys, 2.5)!.x).toBeCloseTo(25);
    expect(stateAt(keys, 10)).toMatchObject({ x: 100, sx: 2 });
  });

  it('jumps at the end of a held segment', () => {
    const held = [key(0, { x: 0, easing: 'hold' }), key(4, { x: 40 })];
    expect(stateAt(held, 3.9)!.x).toBe(0);
    expect(stateAt(held, 4)!.x).toBe(40);
  });
});

describe('motion paths', () => {
  it('follows the Bézier curve when keyframes have handles', () => {
    const keys = [key(0, { x: 0, y: 0, out: { x: 0, y: -100 } }), key(10, { x: 100, y: 0, in: { x: 0, y: -100 } })];
    const mid = stateAt(keys, 5)!;
    // Symmetric arch: the middle is at x = 50, bent upwards by 3/4 of the handle length.
    expect(mid.x).toBeCloseTo(50, 3);
    expect(mid.y).toBeCloseTo(-75, 3);
  });

  it('moves at an even speed along the curve with linear easing', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 90, y: 0 },
      { x: 100, y: 0 },
    ] as const;
    // Raw parameter t bunches points up; distance along the curve stays even.
    expect(bezierPoint(c, 0.5).x).not.toBeCloseTo(50, 0);
    expect(pointAlongCurve(c, 0.5).x).toBeCloseTo(50, 0);
    expect(pointAlongCurve(c, 0.25).x).toBeCloseTo(25, 0);
    expect(pointAlongCurve(c, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongCurve(c, 1)).toEqual({ x: 100, y: 0 });
  });
});

describe('pivot', () => {
  it('turns and scales the piece about its pivot', () => {
    const pivot = { x: 10, y: 10 };
    const m = stateMatrix({ ...identityState(110, 60), angle: Math.PI / 2, sx: 2, sy: 2 }, pivot);
    // The pivot lands on the state's position.
    expect(matApply(m, 10, 10).x).toBeCloseTo(110);
    expect(matApply(m, 10, 10).y).toBeCloseTo(60);
    // A point 5 px right of the pivot: doubled and turned a quarter turn clockwise (y down).
    const p = matApply(m, 15, 10);
    expect(p.x).toBeCloseTo(110);
    expect(p.y).toBeCloseTo(70);
  });

  it('stretches along the piece’s own axes and skews', () => {
    const m = stateMatrix({ ...identityState(0, 0), sx: 3, sy: 1, skew: Math.PI / 4 }, { x: 0, y: 0 });
    expect(matApply(m, 1, 0)).toEqual({ x: 3, y: 0 });
    const p = matApply(m, 0, 1);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
  });

  it('moving the pivot keeps the piece where it is on every keyframe', () => {
    const pivot = { x: 20, y: 10 };
    const keys = [key(0, { x: 50, y: 50 }), key(8, { x: 200, y: 90, angle: 1.2, sx: 1.5, sy: 0.7, skew: 0.3 })];
    const next = { x: 0, y: 40 };
    const moved = movePivot(keys, pivot, next);
    for (let i = 0; i < keys.length; i++) {
      const before = stateMatrix(keys[i], pivot);
      const after = stateMatrix(moved[i], next);
      for (const [x, y] of [
        [0, 0],
        [40, 0],
        [40, 20],
        [13, 7],
      ]) {
        expect(matApply(after, x, y).x).toBeCloseTo(matApply(before, x, y).x, 6);
        expect(matApply(after, x, y).y).toBeCloseTo(matApply(before, x, y).y, 6);
      }
      // Everything else about the keyframe is untouched.
      expect(moved[i]).toMatchObject({ frame: keys[i].frame, angle: keys[i].angle, sx: keys[i].sx, easing: 'linear' });
    }
  });
});

describe('timeline', () => {
  const run = (loop: 'loop' | 'once' | 'pingpong', length: number, steps: number[]): (number | null)[] => {
    let s: PlayState | null = { frame: 0, dir: 1 };
    const out: (number | null)[] = [];
    for (const n of steps) {
      s = s && advance(s, n, { length, loop });
      out.push(s ? s.frame : null);
    }
    return out;
  };

  it('loops, plays once and ping-pongs', () => {
    expect(run('loop', 4, [1, 1, 1, 1, 1])).toEqual([1, 2, 3, 0, 1]);
    expect(run('once', 4, [1, 1, 1, 1])).toEqual([1, 2, null, null]);
    expect(run('pingpong', 4, [1, 1, 1, 1, 1, 1, 1])).toEqual([1, 2, 3, 2, 1, 0, 1]);
  });

  it('skips frames when the screen falls behind', () => {
    expect(run('loop', 5, [3, 3])).toEqual([3, 1]);
    expect(run('pingpong', 4, [5])).toEqual([1]);
  });

  it('keeps single-frame timelines still', () => {
    expect(advance({ frame: 0, dir: 1 }, 1, { length: 1, loop: 'loop' })).toEqual({ frame: 0, dir: 1 });
    expect(advance({ frame: 0, dir: 1 }, 1, { length: 1, loop: 'once' })).toBeNull();
  });

  it('clamps frames, frame rates and lengths', () => {
    expect(clampFrame(7.6, 5)).toBe(4);
    expect(clampFrame(-2, 5)).toBe(0);
    expect(clampFrame(Number.NaN, 5)).toBe(0);
    expect(clampFps(0)).toBe(1);
    expect(clampFps(240)).toBe(60);
    expect(clampLength(5000)).toBe(2000);
    expect(clampLength(0)).toBe(1);
  });
});
