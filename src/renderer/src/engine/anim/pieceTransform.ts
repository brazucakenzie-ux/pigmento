import type { Point } from '../core/geometry';
import { matApply, matApplyRect, matChain, matRotate, matScale, type Mat } from '../core/matrix';
import type { Keyframe } from './interpolate';
import { cloneKeyframe, type Piece } from './piece';

const TAU = Math.PI * 2;

/** Scale, then skew, then rotate: a keyframe's linear part (no translation). */
function linearOf(k: Keyframe): Mat {
  return matChain(matScale(k.sx, k.sy), [1, 0, Math.tan(k.skew), 1, 0, 0], matRotate(k.angle));
}

/** Split a linear map back into rotation, scale and skew (the inverse of linearOf). */
function decompose(m: Mat): { angle: number; sx: number; sy: number; skew: number } {
  const [a, b, c, d] = m;
  const angle = Math.atan2(b, a);
  const sx = Math.hypot(a, b);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const p = cos * c + sin * d;
  const sy = -sin * c + cos * d;
  const skew = Math.abs(sy) < 1e-12 ? 0 : Math.atan(p / sy);
  return { angle, sx, sy, skew };
}

function linear(m: Mat, v: Point): Point {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

/** The nearest value to `target` that differs from `raw` by whole turns. */
function nearTurn(raw: number, target: number): number {
  return raw + TAU * Math.round((target - raw) / TAU);
}

/**
 * Pieces after the whole picture is transformed by `m` (resize, crop, canvas size, flip, turn,
 * free rotate, skew): every keyframe lands where m puts it, looking as m makes it look. Spins
 * between keyframes are kept (a flip runs them the other way).
 */
export function transformPieces(pieces: readonly Piece[], m: Mat): Piece[] {
  const lin: Mat = [m[0], m[1], m[2], m[3], 0, 0];
  const flips = m[0] * m[3] - m[1] * m[2] < 0;
  const turn = Math.atan2(m[1], m[0]);
  const vec = (v: Point | null): Point | null => (v ? linear(lin, v) : null);
  return pieces.map((p) => {
    let prevOld = 0;
    let prevNew = 0;
    const keyframes = p.keyframes.map((k, i): Keyframe => {
      const parts = decompose(matChain(linearOf(k), lin));
      const pos = matApply(m, k.x, k.y);
      const expected = i === 0 ? (flips ? -k.angle : k.angle) + turn : prevNew + (flips ? -1 : 1) * (k.angle - prevOld);
      const angle = nearTurn(parts.angle, expected);
      prevOld = k.angle;
      prevNew = angle;
      return { ...cloneKeyframe(k), x: pos.x, y: pos.y, sx: parts.sx, sy: parts.sy, skew: parts.skew, angle, in: vec(k.in), out: vec(k.out) };
    });
    return { ...p, home: matApplyRect(m, p.home), pivot: { ...p.pivot }, keyframes };
  });
}
