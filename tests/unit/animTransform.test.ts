import { describe, expect, it } from 'vitest';
import { matChain, matRotate, matScale, matSkew, matTranslate, type Mat } from '@engine/core/matrix';
import { makePiece, pieceCorners, setKey, type Piece } from '@engine/anim/piece';
import { transformPieces } from '@engine/anim/pieceTransform';
import { stateAt } from '@engine/anim/interpolate';

const img = { w: 30, h: 12, data: new Uint8ClampedArray(30 * 12 * 4) };

function sample(): Piece {
  const p = makePiece('p', '', 'l', img, { x: 40, y: 50, w: 30, h: 12 }, 0);
  p.keyframes = setKey(p.keyframes, 10, { x: 200, y: 80, angle: 4 * Math.PI + 0.3, sx: 1.5, sy: 0.6, skew: 0.2, out: null });
  p.keyframes = setKey(p.keyframes, 0, { out: { x: 30, y: -40 } });
  return p;
}

/** Corners of the piece at a frame, through m (what the transformed piece must match). */
function expectMatches(before: Piece, after: Piece, m: Mat, frames: number[]): void {
  for (const f of frames) {
    const want = pieceCorners(before, f).map((c) => ({ x: m[0] * c.x + m[2] * c.y + m[4], y: m[1] * c.x + m[3] * c.y + m[5] }));
    const got = pieceCorners(after, f);
    for (let i = 0; i < 4; i++) {
      expect(got[i].x).toBeCloseTo(want[i].x, 5);
      expect(got[i].y).toBeCloseTo(want[i].y, 5);
    }
  }
}

describe('pieces follow the picture', () => {
  const cases: [string, Mat][] = [
    ['crop or canvas size', matTranslate(-25, 13)],
    ['resize', matScale(0.5, 0.5)],
    ['uneven resize', matScale(2, 0.75)],
    ['flip horizontally', matChain(matScale(-1, 1), matTranslate(640, 0))],
    ['flip vertically', matChain(matScale(1, -1), matTranslate(0, 480))],
    ['quarter turn', matChain(matRotate(Math.PI / 2), matTranslate(480, 0))],
    ['free rotation', matChain(matTranslate(-320, -240), matRotate(0.4), matTranslate(330, 250))],
    ['skew', matSkew(0.3, 0.1)],
  ];

  for (const [name, m] of cases) {
    it(`keeps every keyframe in place under ${name}`, () => {
      const before = sample();
      const [after] = transformPieces([before], m);
      // Exact at the keyframes (positions, size, turn and skew all mapped).
      expectMatches(before, after, m, [0, 10]);
      // The pixels, pivot and keyframe timing don't change.
      expect(after.src).toBe(before.src);
      expect(after.pivot).toEqual(before.pivot);
      expect(after.keyframes.map((k) => k.frame)).toEqual([0, 10]);
    });
  }

  it('keeps the spins between keyframes (a flip runs them backwards)', () => {
    const before = sample();
    const spin = before.keyframes[1].angle - before.keyframes[0].angle;
    const [turned] = transformPieces([before], matChain(matRotate(Math.PI / 2), matTranslate(480, 0)));
    expect(turned.keyframes[1].angle - turned.keyframes[0].angle).toBeCloseTo(spin, 6);
    const [flipped] = transformPieces([before], matChain(matScale(-1, 1), matTranslate(640, 0)));
    expect(flipped.keyframes[1].angle - flipped.keyframes[0].angle).toBeCloseTo(-spin, 6);
  });

  it('carries motion-path handles, and in-between frames stay on the mapped path when it only moves', () => {
    const before = sample();
    const m = matTranslate(10, -5);
    const [after] = transformPieces([before], m);
    expect(after.keyframes[0].out).toEqual({ x: 30, y: -40 });
    const a = stateAt(before.keyframes, 4)!;
    const b = stateAt(after.keyframes, 4)!;
    expect(b.x).toBeCloseTo(a.x + 10, 6);
    expect(b.y).toBeCloseTo(a.y - 5, 6);
  });

  it('does nothing with the identity and doesn’t touch the originals', () => {
    const before = sample();
    const copy = JSON.stringify(before.keyframes);
    const [after] = transformPieces([before], [1, 0, 0, 1, 0, 0]);
    expectMatches(before, after, [1, 0, 0, 1, 0, 0], [0, 5, 10]);
    expect(JSON.stringify(before.keyframes)).toBe(copy);
  });
});
