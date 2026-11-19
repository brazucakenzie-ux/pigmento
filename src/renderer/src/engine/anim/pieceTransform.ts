import type { Point } from '../core/geometry';
import { matApply, matApplyRect, matChain, matRotate, matScale, type Mat } from '../core/matrix';
import type { Keyframe } from './interpolate';
import { cloneKeyframe, type Piece } from './piece';
import { MAX_STRENGTH, MIN_STRENGTH, type Camera } from './space';

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

type V3 = [number, number, number];

/** Columns of the tilt-then-turn rotation (as in space.ts): the sheet's x and y axes, and its normal. */
function axes(tilt: number, turn: number): [V3, V3, V3] {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cr = Math.cos(turn);
  const sr = Math.sin(turn);
  return [
    [cr, 0, sr],
    [sr * st, ct, -cr * st],
    [-sr * ct, st, cr * ct],
  ];
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A keyframe tilted or turned in 3D after the picture is turned (and maybe flipped) by q2, a 2×2
 * rotation or reflection [a, b, c, d] (x' = a·x + c·y): the camera rolls round its axis, so the
 * sheet's normal turns with the picture. Its tilt and turn are found again from the new normal
 * (the pair nearest to `expected`), and what's left over turns its flat part (scale, skew, spin).
 */
function rolled(k: Keyframe, q2: readonly [number, number, number, number], expected: { tilt: number; turn: number }): { tilt: number; turn: number; lin: Mat } {
  const q = (v: V3): V3 => [q2[0] * v[0] + q2[2] * v[1], q2[1] * v[0] + q2[3] * v[1], v[2]];
  const [c0, c1, c2] = axes(k.tilt, k.turn);
  const n = q(c2);
  const b = Math.asin(Math.max(-1, Math.min(1, n[1])));
  const a = Math.abs(Math.cos(b)) > 1e-9 ? Math.atan2(-n[0], n[2]) : k.turn;
  // Two tilt-and-turn pairs give this normal; keep the one nearest to what's expected, unwrapped.
  const pick = [
    { tilt: b, turn: a },
    { tilt: Math.PI - b, turn: a + Math.PI },
  ]
    .map((c) => ({ tilt: nearTurn(c.tilt, expected.tilt), turn: nearTurn(c.turn, expected.turn) }))
    .sort((x, y) => Math.abs(x.tilt - expected.tilt) + Math.abs(x.turn - expected.turn) - (Math.abs(y.tilt - expected.tilt) + Math.abs(y.turn - expected.turn)))[0];
  // What the roll does within the sheet's own plane: rows of the new axes against the rolled old ones.
  const [d0, d1] = axes(pick.tilt, pick.turn);
  const r0 = q(c0);
  const r1 = q(c1);
  const pz: Mat = [dot(d0, r0), dot(d1, r0), dot(d0, r1), dot(d1, r1), 0, 0];
  return { ...pick, lin: pz };
}

/**
 * Pieces after the whole picture is transformed by `m` (resize, crop, canvas size, flip, turn,
 * free rotate, skew): every keyframe lands where m puts it, looking as m makes it look. Spins
 * between keyframes are kept (a flip runs them the other way). In 3D, depth grows with the
 * picture, and a tilted or turned piece rolls with the camera (only the even part of m reaches
 * it: an uneven resize moves it but keeps its shape in depth).
 */
export function transformPieces(pieces: readonly Piece[], m: Mat): Piece[] {
  const lin: Mat = [m[0], m[1], m[2], m[3], 0, 0];
  const det = m[0] * m[3] - m[1] * m[2];
  const flips = det < 0;
  const turn = Math.atan2(m[1], m[0]);
  const scale = Math.sqrt(Math.abs(det));
  // The even part of m: a turn, and a flip if it flips (x' = a·x + c·y).
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const q2: [number, number, number, number] = flips ? [ct, st, st, -ct] : [ct, st, -st, ct];
  const vec = (v: Point | null): Point | null => (v ? linear(lin, v) : null);
  return pieces.map((p) => {
    // A linked piece is placed in its parent's pixels, so it goes wherever its parent goes.
    if (p.link)
      return {
        ...p,
        home: matApplyRect(m, p.home),
        pivot: { ...p.pivot },
        keyframes: p.keyframes.map(cloneKeyframe),
      };
    let prevOld = 0;
    let prevNew = 0;
    let prev3d = { tilt: 0, turn: 0, oldTilt: 0, oldTurn: 0 };
    const keyframes = p.keyframes.map((k, i): Keyframe => {
      let parts: ReturnType<typeof decompose>;
      let tilt = k.tilt;
      let kturn = k.turn;
      if (k.tilt !== 0 || k.turn !== 0) {
        // Tilts and turns between keyframes are kept, as spins are (a flip runs turns the other way).
        const expected =
          i === 0 || (prev3d.oldTilt === 0 && prev3d.oldTurn === 0)
            ? { tilt: k.tilt, turn: flips ? -k.turn : k.turn }
            : { tilt: prev3d.tilt + (k.tilt - prev3d.oldTilt), turn: prev3d.turn + (flips ? -1 : 1) * (k.turn - prev3d.oldTurn) };
        const r = rolled(k, q2, expected);
        tilt = r.tilt;
        kturn = r.turn;
        const s: Mat = [scale, 0, 0, scale, 0, 0];
        parts = decompose(matChain(linearOf(k), r.lin, s));
      } else parts = decompose(matChain(linearOf(k), lin));
      prev3d = { tilt, turn: kturn, oldTilt: k.tilt, oldTurn: k.turn };
      const pos = matApply(m, k.x, k.y);
      const expected = i === 0 ? (flips ? -k.angle : k.angle) + turn : prevNew + (flips ? -1 : 1) * (k.angle - prevOld);
      const angle = nearTurn(parts.angle, expected);
      prevOld = k.angle;
      prevNew = angle;
      return {
        ...cloneKeyframe(k),
        x: pos.x,
        y: pos.y,
        sx: parts.sx,
        sy: parts.sy,
        skew: parts.skew,
        angle,
        tilt,
        turn: kturn,
        depth: k.depth * scale,
        in: vec(k.in),
        out: vec(k.out),
      };
    });
    return { ...p, home: matApplyRect(m, p.home), pivot: { ...p.pivot }, keyframes };
  });
}

/** True if a picture transform by m keeps 3D pieces right (it's even: no skew or uneven stretch). */
export function keepsDepth(m: Mat): boolean {
  const [a, b, c, d] = m;
  const s1 = Math.hypot(a, b);
  const s2 = Math.hypot(c, d);
  return Math.abs(s1 - s2) <= 1e-6 * Math.max(s1, s2) && Math.abs(a * c + b * d) <= 1e-6 * s1 * s2;
}

/**
 * The camera after the picture is transformed by m, from w × h to nw × nh: its vanishing point
 * goes where m puts it and its distance grows with the picture (strength is distance against the
 * diagonal, so it changes when only the canvas size does).
 */
export function transformCamera(cam: Camera, m: Mat, w: number, h: number, nw: number, nh: number): Camera {
  const p = matApply(m, cam.x, cam.y);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const f = (50 * Math.hypot(w, h)) / cam.strength;
  const strength = (50 * Math.hypot(nw, nh)) / (f * scale);
  return { x: p.x, y: p.y, strength: Math.min(MAX_STRENGTH, Math.max(MIN_STRENGTH, strength)) };
}
