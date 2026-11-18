import { describe, expect, it } from 'vitest';
import { matApply, matChain, matRotate, matScale, matTranslate, type Mat } from '@engine/core/matrix';
import { makePiece, piecePlacementAt, setKey, type Piece } from '@engine/anim/piece';
import { keepsDepth, transformCamera, transformPieces } from '@engine/anim/pieceTransform';
import { project, spaceOf, type Camera } from '@engine/anim/space';

const W = 800;
const H = 600;

/** A piece tilted, turned, spun, stretched and pushed back, keyed at two frames. */
function piece3d(): Piece {
  const p = makePiece('p', '', 'l', { w: 120, h: 80, data: new Uint8ClampedArray(120 * 80 * 4) }, { x: 300, y: 200, w: 120, h: 80 }, 0);
  p.keyframes = setKey(p.keyframes, 0, { tilt: 0.6, turn: -0.9, angle: 0.4, sx: 1.3, sy: 0.8, depth: 250 });
  p.keyframes = setKey(p.keyframes, 10, { tilt: 2.5, turn: 7, angle: -3, depth: -100, x: 500 });
  return p;
}

/** Does the piece land, at both keyframes, where m puts every point of it? */
function follows(m: Mat, nw: number, nh: number): void {
  const cam: Camera = { x: 350, y: 280, strength: 60 };
  const p = piece3d();
  const [q] = transformPieces([p], m);
  const cam2 = transformCamera(cam, m, W, H, nw, nh);
  for (const frame of [0, 10]) {
    const before = piecePlacementAt(p, frame, spaceOf(cam, W, H));
    const after = piecePlacementAt(q, frame, spaceOf(cam2, nw, nh));
    for (const pt of [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 37, y: 61 }, { x: 120, y: 80 }]) {
      const a = project(before, pt);
      const b = project(after, pt);
      if (!a) {
        expect(b).toBeNull();
        continue;
      }
      const want = matApply(m, a.x, a.y);
      expect(b!.x).toBeCloseTo(want.x, 5);
      expect(b!.y).toBeCloseTo(want.y, 5);
    }
    // Which side faces the camera is kept (a flip is a mirror image, not a turn round).
    expect(after.front).toBe(before.front);
  }
}

describe('3D pieces follow the whole picture', () => {
  it('through quarter turns, as Image → Rotate does them', () => {
    follows([0, 1, -1, 0, H, 0], H, W);
    follows([-1, 0, 0, -1, W, H], W, H);
    follows([0, -1, 1, 0, 0, W], H, W);
  });

  it('through flips', () => {
    follows([-1, 0, 0, 1, W, 0], W, H);
    follows([1, 0, 0, -1, 0, H], W, H);
  });

  it('through a free rotation, an even resize and a crop', () => {
    follows(matChain(matTranslate(-W / 2, -H / 2), matRotate(0.37), matTranslate(W / 2 + 60, H / 2 + 20)), W + 120, H + 40);
    follows(matScale(1.5), W * 1.5, H * 1.5);
    follows(matTranslate(-100, -50), W - 200, H - 150);
  });

  it('keeps tilts and turns going the same way between keyframes', () => {
    const [q] = transformPieces([piece3d()], [-1, 0, 0, 1, W, 0]);
    const [k0, k1] = q.keyframes;
    // 0.6 → 2.5 tilts on by 1.9; −0.9 → 7 turns on by 7.9 (flipped: by −7.9).
    expect(k1.tilt - k0.tilt).toBeCloseTo(1.9, 6);
    expect(k1.turn - k0.turn).toBeCloseTo(-7.9, 6);
  });

  it('grows depth and the camera with the picture, and a crop leaves the look alone', () => {
    const [q] = transformPieces([piece3d()], matScale(2));
    expect(q.keyframes[0].depth).toBeCloseTo(500, 9);
    const cam: Camera = { x: 400, y: 300, strength: 50 };
    expect(transformCamera(cam, matScale(2), W, H, 2 * W, 2 * H)).toEqual({ x: 800, y: 600, strength: 50 });
    // Cropped to half the size: the camera stays as far away, so it's half as strong.
    const cropped = transformCamera(cam, matTranslate(-200, -150), W, H, W / 2, H / 2);
    expect(cropped.x).toBe(200);
    expect(cropped.strength).toBeCloseTo(25, 9);
  });

  it('knows which picture changes a camera can’t follow', () => {
    expect(keepsDepth(matRotate(0.3))).toBe(true);
    expect(keepsDepth([-1, 0, 0, 1, 0, 0])).toBe(true);
    expect(keepsDepth([1, 0, 0.4, 1, 0, 0])).toBe(false);
    expect(keepsDepth(matScale(2, 1))).toBe(false);
  });
});
