import type { Point } from '../core/geometry';
import type { Mat } from '../core/matrix';
import { invertHomography, type Homography } from '../raster/warp';
import { stateMatrix, type PieceState } from './interpolate';
import { NEAR, rotation, type Placement, type Space, type Vec3 } from './space';

/**
 * Pieces linked in 3D (see links.ts). Each piece has a frame: where its own pixels (x, y) and a
 * distance z along its normal land in 3D (document pixels, z behind the canvas). A free piece's
 * frame comes from its state as in space.ts; a piece that follows another has a state relative to
 * that piece's own pixels, and a hinged one hangs off an edge of its parent, folded round it.
 * Frames compose up the tree.
 */

/** A 3 × 4 matrix, row-major: X = A0·x + A1·y + A2·z + A3, then Y (A4 … A7) and Z (A8 … A11). */
export type Frame = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** One side of a piece's box, named by the way it faces: top, right, bottom, left. */
export type Edge = 'n' | 'e' | 's' | 'w';
export const EDGES: readonly Edge[] = ['n', 'e', 's', 'w'];

/**
 * How a piece hangs off its parent: its own `childEdge` lies along the parent's `edge`, starting
 * `offset` parent pixels from that edge's start (edges run clockwise round a box), and it folds
 * round that line by its keyframes' fold angle. `along` and `across` are parent pixels per piece
 * pixel, along the edge and away from it.
 */
export interface Hinge {
  edge: Edge;
  childEdge: Edge;
  offset: number;
  along: number;
  across: number;
}

export function frameApply(A: Readonly<Frame>, x: number, y: number, z = 0): Vec3 {
  return [
    A[0] * x + A[1] * y + A[2] * z + A[3],
    A[4] * x + A[5] * y + A[6] * z + A[7],
    A[8] * x + A[9] * y + A[10] * z + A[11],
  ];
}

/** Column i (0: the x axis, 1: the y axis, 2: the z axis, 3: where the origin goes). */
export function frameColumn(A: Readonly<Frame>, i: number): Vec3 {
  return [A[i], A[4 + i], A[8 + i]];
}

/** A after B: points go through B, then A. */
export function frameChain(A: Readonly<Frame>, B: Readonly<Frame>): Frame {
  const out = new Array<number>(12) as Frame;
  for (let r = 0; r < 3; r++) {
    const a0 = A[r * 4];
    const a1 = A[r * 4 + 1];
    const a2 = A[r * 4 + 2];
    for (let c = 0; c < 4; c++)
      out[r * 4 + c] = a0 * B[c] + a1 * B[4 + c] + a2 * B[8 + c] + (c === 3 ? A[r * 4 + 3] : 0);
  }
  return out;
}

/** The frame undone, or null when it squashes space flat. */
export function frameInvert(A: Readonly<Frame>): Frame | null {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = A;
  const A0 = e * i - f * h;
  const B0 = -(d * i - f * g);
  const C0 = d * h - e * g;
  const det = a * A0 + b * B0 + c * C0;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const k = 1 / det;
  const m = [
    A0 * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B0 * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C0 * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
  return [
    m[0],
    m[1],
    m[2],
    -(m[0] * tx + m[1] * ty + m[2] * tz),
    m[3],
    m[4],
    m[5],
    -(m[3] * tx + m[4] * ty + m[5] * tz),
    m[6],
    m[7],
    m[8],
    -(m[6] * tx + m[7] * ty + m[8] * tz),
  ];
}

export const IDENTITY_FRAME: Readonly<Frame> = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/**
 * The frame state s gives about `pivot`, with (x, y, depth) taken as a point in 3D: a piece's
 * place relative to the piece it follows (in that piece's own pixels). z is scaled with the
 * piece's area, so depth looks the same size as the sheet.
 */
export function localFrame(s: PieceState, pivot: Point): Frame {
  return frameAt(s, pivot, [s.x, s.y, s.depth]);
}

/** A free piece's frame: its pivot shows at (x, y) on the canvas, pushed back to its depth (as placementOf). */
export function rootFrame(s: PieceState, pivot: Point, space: Space): Frame {
  const { cx, cy, f } = space;
  const depth = Math.max(s.depth, -f * (1 - NEAR));
  const g = (f + depth) / f;
  return frameAt(s, pivot, [cx + (s.x - cx) * g, cy + (s.y - cy) * g, depth]);
}

function frameAt(s: PieceState, pivot: Point, P: Vec3): Frame {
  const m = stateMatrix(s, pivot);
  const [a, b, c, d, e, ff] = m;
  const { c0, c1, c2 } = rotation(s.tilt, s.turn);
  const sz = Math.sqrt(Math.abs(a * d - b * c));
  // u(q) = m(q) − (x, y): the piece in its own plane, about the pivot; W = P + c0·u.x + c1·u.y.
  const ex = e - s.x;
  const fy = ff - s.y;
  const row = (i: number): [number, number, number, number] => [
    c0[i] * a + c1[i] * b,
    c0[i] * c + c1[i] * d,
    c2[i] * sz,
    P[i] + c0[i] * ex + c1[i] * fy,
  ];
  return [...row(0), ...row(1), ...row(2)] as Frame;
}

/** An edge of a w × h box: where it starts, which way it runs (clockwise), which way is inward, and how long it is. */
export function edgeOf(
  edge: Edge,
  w: number,
  h: number,
): { a: Point; u: Point; v: Point; len: number } {
  switch (edge) {
    case 'n':
      return { a: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 }, len: w };
    case 'e':
      return { a: { x: w, y: 0 }, u: { x: 0, y: 1 }, v: { x: -1, y: 0 }, len: h };
    case 's':
      return { a: { x: w, y: h }, u: { x: -1, y: 0 }, v: { x: 0, y: -1 }, len: w };
    case 'w':
      return { a: { x: 0, y: h }, u: { x: 0, y: -1 }, v: { x: 1, y: 0 }, len: h };
  }
}

/**
 * A hinged piece's frame in its parent's own pixels. Unfolded, the piece lies flat outside the
 * parent's edge, its own edge running the other way along it (as two faces of a box share an
 * edge); folding turns it round that edge, back (away from the viewer) for a positive fold, so
 * a front face with its sides folded by 90° makes a box going back from it, fronts outward.
 */
export function hingeFrame(
  parentW: number,
  parentH: number,
  w: number,
  h: number,
  hinge: Hinge,
  fold: number,
): Frame {
  const P = edgeOf(hinge.edge, parentW, parentH);
  const C = edgeOf(hinge.childEdge, w, h);
  const cos = Math.cos(fold);
  const sin = Math.sin(fold);
  const { along: ka, across: kc, offset } = hinge;
  // Away from the edge, and the normal, after folding (3D, in the parent's own space).
  const A: Vec3 = [-cos * P.v.x, -cos * P.v.y, sin];
  const N: Vec3 = [sin * P.v.x, sin * P.v.y, cos];
  // A piece point q is s = (b − q)·u along its edge from its end b, and t = (q − a)·v in from it.
  const bx = C.a.x + C.u.x * C.len;
  const by = C.a.y + C.u.y * C.len;
  const sb = bx * C.u.x + by * C.u.y;
  const ta = C.a.x * C.v.x + C.a.y * C.v.y;
  // Parent point = a + u·(offset + along·s) + across·t·A, plus across·z·N.
  const u3: Vec3 = [P.u.x, P.u.y, 0];
  const a3: Vec3 = [P.a.x, P.a.y, 0];
  const out = new Array<number>(12) as Frame;
  for (let i = 0; i < 3; i++) {
    out[i * 4] = -ka * C.u.x * u3[i] + kc * C.v.x * A[i];
    out[i * 4 + 1] = -ka * C.u.y * u3[i] + kc * C.v.y * A[i];
    out[i * 4 + 2] = kc * N[i];
    out[i * 4 + 3] = a3[i] + u3[i] * (offset + ka * sb) - kc * ta * A[i];
  }
  return out;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The sheet's normal in 3D (unit length): square to its plane, on the side its z axis points to,
 * so it points away from the camera while the camera sees its front.
 */
export function frameNormal(A: Readonly<Frame>): Vec3 {
  const c0 = frameColumn(A, 0);
  const c1 = frameColumn(A, 1);
  const c2 = frameColumn(A, 2);
  let n = cross(c0, c1);
  if (dot(n, c2) < 0) n = [-n[0], -n[1], -n[2]];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len > 1e-300) return [n[0] / len, n[1] / len, n[2] / len];
  const l2 = Math.hypot(c2[0], c2[1], c2[2]);
  return l2 > 1e-300 ? [c2[0] / l2, c2[1] / l2, c2[2] / l2] : [0, 0, 1];
}

/** True when the frame's sheet faces the camera square on (its depth is the same all over). */
export function frameFlat(A: Readonly<Frame>): boolean {
  return A[8] === 0 && A[9] === 0;
}

/** Where a w × h sheet with frame A shows, seen by `space` (as placementOf does for a free piece). */
export function placementFromFrame(A: Readonly<Frame>, w: number, h: number, space: Space): Placement {
  const { cx, cy, f, px, py, pz } = space;
  const n = frameNormal(A);
  const mid = frameApply(A, w / 2, h / 2);
  // The camera: at rest at (cx, cy, −f), moved by (px, py, pz).
  const toCam: Vec3 = [cx + px - mid[0], cy + py - mid[1], pz - f - mid[2]];
  const front = dot(n, toCam) < 0;
  if (frameFlat(A)) {
    // A depth at or past the camera can't be seen: keep it just in front.
    const z = Math.max(A[11] - pz, -f * (1 - NEAR));
    const k = f / (f + z);
    const affine: Mat = k === 1 && px === 0 && py === 0 ? [A[0], A[4], A[1], A[5], A[3], A[7]] : [A[0] * k, A[4] * k, A[1] * k, A[5] * k, cx + (A[3] - cx - px) * k, cy + (A[7] - cy - py) * k];
    const hm: Homography = [affine[0], affine[2], affine[4], affine[1], affine[3], affine[5], 0, 0, 1];
    return { affine, h: hm, inv: invertHomography(hm), depth: z, front };
  }
  // Seen from the camera: x' = cx + f·(X − cx − px) / (Z + f − pz), and likewise y'.
  const hm: Homography = [f * A[0] + cx * A[8], f * A[1] + cx * A[9], f * (A[3] - px) + cx * (A[11] - pz), f * A[4] + cy * A[8], f * A[5] + cy * A[9], f * (A[7] - py) + cy * (A[11] - pz), A[8], A[9], A[11] + f - pz];
  return { affine: null, h: hm, inv: invertHomography(hm), depth: mid[2], front };
}

const TAU = Math.PI * 2;

/** The nearest value to `target` that differs from `raw` by whole turns. */
export function nearTurn(raw: number, target: number): number {
  return raw + TAU * Math.round((target - raw) / TAU);
}

/** Split a 2D linear map [a, b, c, d] (x' = a·x + c·y) into spin, scale and skew (as stateMatrix builds it). */
export function decompose2(m: readonly number[]): {
  angle: number;
  sx: number;
  sy: number;
  skew: number;
} {
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

/** The parts of a state a frame decides (everything but opacity, scroll and fold). */
export type FrameParts = Pick<
  PieceState,
  'x' | 'y' | 'depth' | 'sx' | 'sy' | 'angle' | 'skew' | 'tilt' | 'turn'
>;

/**
 * The state that gives frame A about `pivot` as localFrame does, choosing the tilt, turn and spin
 * nearest to `near` (frames that aren't a tilted, turned, scaled and skewed sheet, from a parent
 * stretched unevenly in 3D, come out as the nearest that is).
 */
export function localParts(
  A: Readonly<Frame>,
  pivot: Point,
  near: Pick<PieceState, 'tilt' | 'turn' | 'angle'>,
): FrameParts {
  const n = frameNormal(A);
  const b = Math.asin(Math.max(-1, Math.min(1, n[1])));
  const a = Math.abs(Math.cos(b)) > 1e-9 ? Math.atan2(-n[0], n[2]) : near.turn;
  // Two tilt-and-turn pairs give this normal: keep the one nearest to `near`, unwrapped.
  const pick = [
    { tilt: b, turn: a },
    { tilt: Math.PI - b, turn: a + Math.PI },
  ]
    .map((c) => ({ tilt: nearTurn(c.tilt, near.tilt), turn: nearTurn(c.turn, near.turn) }))
    .sort(
      (x, y) =>
        Math.abs(x.tilt - near.tilt) +
        Math.abs(x.turn - near.turn) -
        (Math.abs(y.tilt - near.tilt) + Math.abs(y.turn - near.turn)),
    )[0];
  const { c0: d0, c1: d1 } = rotation(pick.tilt, pick.turn);
  const k0 = frameColumn(A, 0);
  const k1 = frameColumn(A, 1);
  // The sheet's own axes against the rotation's: what's left is its flat scale, skew and spin.
  const parts = decompose2([dot(d0, k0), dot(d1, k0), dot(d0, k1), dot(d1, k1)]);
  const P = frameApply(A, pivot.x, pivot.y);
  return {
    x: P[0],
    y: P[1],
    depth: P[2],
    sx: parts.sx,
    sy: parts.sy,
    skew: parts.skew,
    angle: nearTurn(parts.angle, near.angle),
    tilt: pick.tilt,
    turn: pick.turn,
  };
}

/** The same for a free piece: x and y are where its pivot shows on the canvas (as rootFrame). */
export function rootParts(
  A: Readonly<Frame>,
  pivot: Point,
  space: Space,
  near: Pick<PieceState, 'tilt' | 'turn' | 'angle'>,
): FrameParts {
  const p = localParts(A, pivot, near);
  const { cx, cy, f } = space;
  const depth = Math.max(p.depth, -f * (1 - NEAR));
  const g = (f + depth) / f;
  return { ...p, depth, x: cx + (p.x - cx) / g, y: cy + (p.y - cy) / g };
}
