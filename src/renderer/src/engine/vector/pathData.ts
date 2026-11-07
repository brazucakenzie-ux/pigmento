import type { Point, Rect } from '../core/geometry';
import type { Mat } from '../core/matrix';
import { pathBounds, PathBuilder, type PathCmd } from '../shapes/path';

/**
 * Free-form outlines (pen paths and shapes converted to paths): subpaths of anchor points, each
 * with optional Bézier handles. Handles are absolute positions; a missing handle is a corner on
 * that side. Everything here is immutable: edits return new lists.
 */
export interface PathAnchor {
  readonly x: number;
  readonly y: number;
  /** Handle towards the previous anchor. */
  readonly in: Point | null;
  /** Handle towards the next anchor. */
  readonly out: Point | null;
  /** Smooth points keep their two handles in line. */
  readonly smooth: boolean;
}

export interface SubPath {
  readonly anchors: readonly PathAnchor[];
  readonly closed: boolean;
}

export type SubPaths = readonly SubPath[];

export function corner(x: number, y: number): PathAnchor {
  return { x, y, in: null, out: null, smooth: false };
}

/** The segments of a subpath as anchor index pairs (with the closing one). */
export function segmentsOf(sub: SubPath): [number, number][] {
  const n = sub.anchors.length;
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) out.push([i, i + 1]);
  if (sub.closed && n > 1) out.push([n - 1, 0]);
  return out;
}

const same = (a: Point | null, b: Point) => !a || (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);

export function toCmds(subs: SubPaths): PathCmd[] {
  const b = new PathBuilder();
  for (const sub of subs) {
    const a = sub.anchors;
    if (!a.length) continue;
    b.m(a[0].x, a[0].y);
    for (const [i, j] of segmentsOf(sub)) {
      const p = a[i];
      const q = a[j];
      if (same(p.out, p) && same(q.in, q)) b.l(q.x, q.y);
      else b.c(p.out?.x ?? p.x, p.out?.y ?? p.y, q.in?.x ?? q.x, q.in?.y ?? q.y, q.x, q.y);
    }
    if (sub.closed) b.z();
  }
  return b.cmds;
}

/** Path commands (from the shape library or SVG) as editable subpaths. */
export function fromCmds(cmds: readonly PathCmd[]): SubPath[] {
  const subs: { anchors: PathAnchor[]; closed: boolean }[] = [];
  let cur: { anchors: PathAnchor[]; closed: boolean } | null = null;
  const last = () => cur!.anchors[cur!.anchors.length - 1];
  const setLast = (a: PathAnchor) => (cur!.anchors[cur!.anchors.length - 1] = a);
  for (const c of cmds) {
    if (c.op === 'M') {
      cur = { anchors: [corner(c.x, c.y)], closed: false };
      subs.push(cur);
      continue;
    }
    if (!cur) continue;
    if (c.op === 'Z') {
      cur.closed = true;
      // A closing point on top of the first one is the same point.
      const a = cur.anchors;
      if (a.length > 1 && Math.abs(a[0].x - last().x) < 1e-6 && Math.abs(a[0].y - last().y) < 1e-6) {
        const end = a.pop()!;
        a[0] = { ...a[0], in: end.in };
      }
      // The next drawing command (if any) starts where this subpath started.
      const start: PathAnchor = cur.anchors[0];
      cur = { anchors: [corner(start.x, start.y)], closed: false };
      subs.push(cur);
      continue;
    }
    if (c.op === 'L') cur.anchors.push(corner(c.x, c.y));
    else {
      const p = last();
      const [c1, c2] =
        c.op === 'C'
          ? [
              { x: c.x1, y: c.y1 },
              { x: c.x2, y: c.y2 },
            ]
          : [
              { x: p.x + ((c.x1 - p.x) * 2) / 3, y: p.y + ((c.y1 - p.y) * 2) / 3 },
              { x: c.x + ((c.x1 - c.x) * 2) / 3, y: c.y + ((c.y1 - c.y) * 2) / 3 },
            ];
      setLast({ ...p, out: c1 });
      cur.anchors.push({ x: c.x, y: c.y, in: c2, out: null, smooth: false });
    }
  }
  return subs
    .filter((s) => s.anchors.length > 1 || s.closed)
    .map((s) => ({ closed: s.closed, anchors: s.anchors.map(markSmooth) }));
}

/** An anchor whose handles point in opposite directions is a smooth point. */
function markSmooth(a: PathAnchor): PathAnchor {
  if (!a.in || !a.out) return a;
  const ix = a.in.x - a.x;
  const iy = a.in.y - a.y;
  const ox = a.out.x - a.x;
  const oy = a.out.y - a.y;
  const li = Math.hypot(ix, iy);
  const lo = Math.hypot(ox, oy);
  if (li < 1e-9 || lo < 1e-9) return a;
  return { ...a, smooth: (ix * ox + iy * oy) / (li * lo) < -0.999 };
}

const applyPt = (m: Mat, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

export function transformSubpaths(subs: SubPaths, m: Mat): SubPath[] {
  return subs.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => {
      const p = applyPt(m, a);
      return { x: p.x, y: p.y, in: a.in ? applyPt(m, a.in) : null, out: a.out ? applyPt(m, a.out) : null, smooth: a.smooth };
    }),
  }));
}

/** Bounds of the drawn outline (curves followed, handles ignored). */
export function subpathBounds(subs: SubPaths): Rect | null {
  return pathBounds(toCmds(subs));
}

/** Every anchor and handle, in order (for moving them together, e.g. with a transform box). */
export function allPoints(subs: SubPaths): Point[] {
  const out: Point[] = [];
  for (const s of subs) for (const a of s.anchors) out.push({ x: a.x, y: a.y }, a.in ?? { x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y });
  return out;
}

/** The reverse of allPoints: the same structure with new positions. */
export function withPoints(subs: SubPaths, pts: readonly Point[]): SubPath[] {
  let k = 0;
  return subs.map((s) => ({
    closed: s.closed,
    anchors: s.anchors.map((a) => {
      const p = pts[k];
      const i = pts[k + 1];
      const o = pts[k + 2];
      k += 3;
      return { x: p.x, y: p.y, in: a.in ? { ...i } : null, out: a.out ? { ...o } : null, smooth: a.smooth };
    }),
  }));
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function segmentPoints(sub: SubPath, i: number, j: number): [Point, Point, Point, Point] {
  const p = sub.anchors[i];
  const q = sub.anchors[j];
  return [p, p.out ?? p, q.in ?? q, q];
}

/** The segment nearest to p: which subpath and segment, where along it (t) and how far. */
export function nearestSegment(subs: SubPaths, p: Point): { sub: number; seg: number; t: number; dist: number } | null {
  let best: { sub: number; seg: number; t: number; dist: number } | null = null;
  subs.forEach((s, si) => {
    segmentsOf(s).forEach(([i, j], seg) => {
      const c = segmentPoints(s, i, j);
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        const q = bezier(...c, t);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.dist) best = { sub: si, seg, t, dist: d };
      }
    });
  });
  return best;
}

/** Add a point on a segment without changing the outline's shape (de Casteljau split). */
export function insertAnchor(subs: SubPaths, si: number, seg: number, t: number): { subs: SubPath[]; index: number } {
  const s = subs[si];
  const [i, j] = segmentsOf(s)[seg];
  const [p0, p1, p2, p3] = segmentPoints(s, i, j);
  const lerp = (a: Point, b: Point): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const a = lerp(p0, p1);
  const b = lerp(p1, p2);
  const c = lerp(p2, p3);
  const d = lerp(a, b);
  const e = lerp(b, c);
  const m = lerp(d, e);
  const curved = !!(s.anchors[i].out || s.anchors[j].in);
  const anchors = [...s.anchors];
  anchors[i] = { ...anchors[i], out: curved ? a : null };
  anchors[j] = { ...anchors[j], in: curved ? c : null };
  const mid: PathAnchor = { x: m.x, y: m.y, in: curved ? d : null, out: curved ? e : null, smooth: curved };
  const index = j === 0 ? anchors.length : j;
  anchors.splice(index, 0, mid);
  return { subs: subs.map((x, k) => (k === si ? { ...x, anchors } : x)), index };
}

/** Remove a point (a subpath left with one point goes too). */
export function removeAnchor(subs: SubPaths, si: number, index: number): SubPath[] {
  return subs
    .map((s, k) => (k === si ? { ...s, anchors: s.anchors.filter((_, i) => i !== index) } : s))
    .filter((s) => s.anchors.length > 1);
}

/** Smooth: handles in line, a third of the way to the neighbours. Corner: no handles. */
export function setSmooth(subs: SubPaths, si: number, index: number, smooth: boolean): SubPath[] {
  return subs.map((s, k) => {
    if (k !== si) return s;
    const n = s.anchors.length;
    const a = s.anchors[index];
    if (!smooth) return { ...s, anchors: s.anchors.map((x, i) => (i === index ? { ...x, in: null, out: null, smooth: false } : x)) };
    const prev = index > 0 ? s.anchors[index - 1] : s.closed ? s.anchors[n - 1] : null;
    const next = index < n - 1 ? s.anchors[index + 1] : s.closed ? s.anchors[0] : null;
    const from = prev ?? a;
    const to = next ?? a;
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const li = prev ? Math.hypot(a.x - prev.x, a.y - prev.y) / 3 : 0;
    const lo = next ? Math.hypot(next.x - a.x, next.y - a.y) / 3 : 0;
    const anchor: PathAnchor = {
      x: a.x,
      y: a.y,
      in: prev ? { x: a.x - dx * li, y: a.y - dy * li } : null,
      out: next ? { x: a.x + dx * lo, y: a.y + dy * lo } : null,
      smooth: true,
    };
    return { ...s, anchors: s.anchors.map((x, i) => (i === index ? anchor : x)) };
  });
}

/** Move one anchor (its handles go with it). */
export function moveAnchor(subs: SubPaths, si: number, index: number, to: Point): SubPath[] {
  return subs.map((s, k) => {
    if (k !== si) return s;
    return {
      ...s,
      anchors: s.anchors.map((a, i) => {
        if (i !== index) return a;
        const dx = to.x - a.x;
        const dy = to.y - a.y;
        return { ...a, x: to.x, y: to.y, in: a.in ? { x: a.in.x + dx, y: a.in.y + dy } : null, out: a.out ? { x: a.out.x + dx, y: a.out.y + dy } : null };
      }),
    };
  });
}

/**
 * Move a handle. On a smooth point the other handle turns to stay in line (keeping its
 * length); `breakSmooth` (Alt) moves this handle alone and makes the point a corner.
 */
export function moveHandle(subs: SubPaths, si: number, index: number, which: 'in' | 'out', to: Point, breakSmooth = false): SubPath[] {
  return subs.map((s, k) => {
    if (k !== si) return s;
    return {
      ...s,
      anchors: s.anchors.map((a, i) => {
        if (i !== index) return a;
        const other = which === 'in' ? 'out' : 'in';
        const next: { -readonly [K in keyof PathAnchor]: PathAnchor[K] } = { ...a, [which]: { ...to } };
        if (breakSmooth) next.smooth = false;
        else if (a.smooth) {
          const o = a[other];
          const len = o ? Math.hypot(o.x - a.x, o.y - a.y) : Math.hypot(to.x - a.x, to.y - a.y);
          const dx = a.x - to.x;
          const dy = a.y - to.y;
          const d = Math.hypot(dx, dy) || 1;
          next[other] = { x: a.x + (dx / d) * len, y: a.y + (dy / d) * len };
        }
        return next;
      }),
    };
  });
}

export function setClosed(subs: SubPaths, si: number, closed: boolean): SubPath[] {
  return subs.map((s, k) => (k === si ? { ...s, closed } : s));
}

/** The outline scaled into a unit box (0–1 on both axes) and the box's proportions. */
export function toUnitBox(subs: SubPaths): { subs: SubPath[]; aspect: number } | null {
  const b = subpathBounds(subs);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const m: Mat = [1 / b.w, 0, 0, 1 / b.h, -b.x / b.w, -b.y / b.h];
  return { subs: transformSubpaths(subs, m), aspect: b.w / b.h };
}

/** Commands for a unit-box outline drawn into a w×h box. */
export function unitCmds(subs: SubPaths, w: number, h: number): PathCmd[] {
  return toCmds(transformSubpaths(subs, [w, 0, 0, h, 0, 0]));
}
