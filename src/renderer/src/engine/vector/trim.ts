import type { Point } from '../core/geometry';
import type { PathCmd } from '../shapes/path';
import { segmentsOf, type SubPath } from './pathData';

/**
 * Trim: how much of a shape's outline shows, from Start to End (shares of its whole length,
 * 0 … 1), both slid along by Offset. A shape with several outlines is trimmed across all of them
 * in turn, as one long line. On a shape whose outlines are all closed, Offset wraps round; on an
 * open one the visible part stops at the ends. Only the outline is trimmed: the fill stays whole.
 */
export interface Trim {
  readonly start: number;
  readonly end: number;
  readonly offset: number;
}

/** The whole outline. */
export const FULL_TRIM: Trim = { start: 0, end: 1, offset: 0 };

/** One visible stretch of an outline: its path, and how far along its own outline it starts (so dashes stay put). */
export interface TrimPiece {
  readonly cmds: PathCmd[];
  /** Distance from the start of the outline it's on, in document pixels. */
  readonly from: number;
}

interface Seg {
  readonly a: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly b: Point;
  readonly straight: boolean;
  readonly len: number;
  /** Lengths up to each of the steps it's measured in (curves only). */
  readonly table: Float64Array | null;
}

interface Outline {
  readonly segs: Seg[];
  readonly len: number;
  readonly closed: boolean;
}

/** An outline measured along its length, ready to be trimmed. */
export interface MeasuredOutline {
  readonly outlines: Outline[];
  readonly total: number;
}

const EPS = 1e-9;

function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const s = 1 - t;
  return s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
}

function pointAt(s: Seg, t: number): Point {
  if (s.straight) return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
  return { x: cubic(s.a.x, s.c1.x, s.c2.x, s.b.x, t), y: cubic(s.a.y, s.c1.y, s.c2.y, s.b.y, t) };
}

function measureSeg(a: Point, c1: Point, c2: Point, b: Point): Seg {
  const straight = c1.x === a.x && c1.y === a.y && c2.x === b.x && c2.y === b.y;
  if (straight) return { a, c1, c2, b, straight, len: Math.hypot(b.x - a.x, b.y - a.y), table: null };
  const hull = Math.hypot(c1.x - a.x, c1.y - a.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(b.x - c2.x, b.y - c2.y);
  const n = Math.max(16, Math.min(512, Math.ceil(hull / 2)));
  const table = new Float64Array(n + 1);
  const seg = { a, c1, c2, b, straight, len: 0, table };
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const p = pointAt(seg, i / n);
    table[i] = table[i - 1] + Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return { ...seg, len: table[n] };
}

/** The curve parameter at distance d along a segment. */
function tAt(s: Seg, d: number): number {
  if (s.len <= EPS) return 0;
  if (!s.table) return Math.min(1, Math.max(0, d / s.len));
  const t = s.table;
  const n = t.length - 1;
  if (d <= 0) return 0;
  if (d >= t[n]) return 1;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = t[hi] - t[lo];
  return (lo + (span > 0 ? (d - t[lo]) / span : 0)) / n;
}

const lerp = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });

/** The part of a segment between parameters t0 and t1, as one path command (after a move to its start). */
function part(s: Seg, t0: number, t1: number): PathCmd {
  if (s.straight) {
    const q = pointAt(s, t1);
    return { op: 'L', x: q.x, y: q.y };
  }
  // De Casteljau: the curve up to t1, then that one's part from t0 / t1.
  const split = (p0: Point, p1: Point, p2: Point, p3: Point, t: number): [Point, Point, Point, Point, Point, Point, Point] => {
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const c = lerp(p2, p3, t);
    const d = lerp(a, b, t);
    const e = lerp(b, c, t);
    const f = lerp(d, e, t);
    return [p0, a, d, f, e, c, p3];
  };
  const left = split(s.a, s.c1, s.c2, s.b, t1);
  const u = t1 > EPS ? t0 / t1 : 0;
  const r = split(left[0], left[1], left[2], left[3], u);
  return { op: 'C', x1: r[4].x, y1: r[4].y, x2: r[5].x, y2: r[5].y, x: r[6].x, y: r[6].y };
}

/** Measure outlines (subpaths in document coordinates) for trimming. */
export function measureOutline(subpaths: readonly SubPath[]): MeasuredOutline {
  const outlines: Outline[] = [];
  for (const sub of subpaths) {
    const a = sub.anchors;
    if (a.length < 2) continue;
    const segs = segmentsOf(sub).map(([i, j]) => measureSeg(a[i], a[i].out ?? a[i], a[j].in ?? a[j], a[j]));
    outlines.push({ segs, len: segs.reduce((n, s) => n + s.len, 0), closed: sub.closed });
  }
  return { outlines, total: outlines.reduce((n, o) => n + o.len, 0) };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * The stretches of the whole outline (shares of its length) that show under a trim, in order;
 * null when all of it shows.
 */
export function trimSpans(t: Trim, wraps: boolean): [number, number][] | null {
  const s = clamp01(t.start);
  const e = clamp01(t.end);
  const lo = Math.min(s, e);
  const hi = Math.max(s, e);
  const off = Number.isFinite(t.offset) ? t.offset : 0;
  if (hi - lo >= 1 - EPS && (wraps || Math.abs(off) < EPS)) return null;
  if (hi - lo <= EPS) return [];
  if (!wraps) {
    const a = Math.max(0, lo + off);
    const b = Math.min(1, hi + off);
    return b - a > EPS ? [[a, b]] : [];
  }
  const a = lo + off - Math.floor(lo + off);
  const b = a + (hi - lo);
  return b <= 1 + EPS ? [[a, Math.min(1, b)]] : [
    [a, 1],
    [0, b - 1],
  ];
}

/** The part of one outline from distance u0 to u1 along it. */
function piece(o: Outline, u0: number, u1: number): TrimPiece {
  const cmds: PathCmd[] = [];
  let at = 0;
  for (const s of o.segs) {
    const s0 = at;
    const s1 = at + s.len;
    at = s1;
    if (s1 < u0 - EPS || s0 > u1 + EPS) continue;
    const t0 = tAt(s, u0 - s0);
    const t1 = tAt(s, u1 - s0);
    if (!cmds.length) {
      const p = pointAt(s, t0);
      cmds.push({ op: 'M', x: p.x, y: p.y });
    }
    if (t1 > t0 || s.len <= EPS) cmds.push(part(s, t0, t1));
  }
  // The whole of a closed outline joins up at its start.
  if (o.closed && u0 <= EPS && u1 >= o.len - EPS) cmds.push({ op: 'Z' });
  return { cmds, from: u0 };
}

/**
 * What of a measured outline shows under a trim, as path pieces (each with where it starts, for
 * dashes); null when all of it shows (draw it as it is). With dashes, a stretch that wraps past
 * the start of a closed outline is drawn as two pieces, so the dashes after the start sit where
 * they do on the whole outline; without them it's drawn as one, so its corner there joins.
 */
export function trimPieces(m: MeasuredOutline, t: Trim, dashed: boolean): TrimPiece[] | null {
  if (m.total <= EPS) return [];
  const spans = trimSpans(t, m.outlines.length > 0 && m.outlines.every((o) => o.closed));
  if (spans === null) return null;
  const out: { o: number; p: TrimPiece; to: number }[] = [];
  for (const [a, b] of spans) {
    const d0 = a * m.total;
    const d1 = b * m.total;
    let start = 0;
    m.outlines.forEach((o, i) => {
      const lo = Math.max(d0, start) - start;
      const hi = Math.min(d1, start + o.len) - start;
      start += o.len;
      if (hi - lo > EPS) out.push({ o: i, p: piece(o, lo, hi), to: hi });
    });
  }
  // A stretch that runs on past the start of a closed outline (its tail comes first, then its
  // head): one piece, unless it's dashed.
  if (!dashed && out.length >= 2) {
    const tail = out[0];
    const head = out[out.length - 1];
    const o = m.outlines[tail.o];
    if (tail.o === head.o && o.closed && tail.to >= o.len - EPS && head.p.from <= EPS) {
      out[0] = { o: tail.o, to: head.to, p: { from: tail.p.from, cmds: [...tail.p.cmds, ...head.p.cmds.slice(1)] } };
      out.pop();
    }
  }
  return out.map((x) => x.p);
}

/** A piece's points, for a line or curve drawn with arrowheads: [start, end] or a curve's four. */
export function piecePoints(p: TrimPiece): Point[] | null {
  const [m, c] = p.cmds;
  if (m?.op !== 'M' || !c) return null;
  if (c.op === 'L') return [{ x: m.x, y: m.y }, { x: c.x, y: c.y }];
  if (c.op === 'C') return [{ x: m.x, y: m.y }, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }];
  return null;
}
