import type { RGBA } from '../core/color';
import { rectUnion, type Point, type Rect } from '../core/geometry';
import type { Surface } from '../raster/Surface';
import type { PathCmd } from '../shapes/path';
import { BrushStroke, strokeSeed } from './BrushStroke';
import { dabShapeOf, paintDabInto } from './dab';
import { LINEAR, type BrushSettings } from './types';

/**
 * Stroking outlines with a brush (the selection's edge, a path, a shape): the lines are walked
 * as if drawn by hand, so spacing, scatter, jitter and dynamics all apply.
 */
export interface Polyline {
  points: Point[];
  closed: boolean;
}

function bezierAt(c: readonly Point[], t: number): Point {
  let pts = c.slice();
  while (pts.length > 1) pts = pts.slice(1).map((p, i) => ({ x: pts[i].x + (p.x - pts[i].x) * t, y: pts[i].y + (p.y - pts[i].y) * t }));
  return pts[0];
}

/** A path as polylines, curves split about every `step` px (closed ones end at their start). */
export function flattenPath(cmds: readonly PathCmd[], step = 2): Polyline[] {
  const out: Polyline[] = [];
  let cur: Point[] = [];
  let start: Point | null = null;
  const flush = (closed: boolean) => {
    if (cur.length > 1) out.push({ points: cur, closed });
    cur = [];
  };
  for (const c of cmds) {
    if (c.op === 'M') {
      flush(false);
      start = { x: c.x, y: c.y };
      cur = [start];
    } else if (c.op === 'L') {
      cur.push({ x: c.x, y: c.y });
    } else if (c.op === 'C' || c.op === 'Q') {
      const p0 = cur[cur.length - 1] ?? start ?? { x: 0, y: 0 };
      if (!cur.length) cur.push(p0);
      const ctrl = c.op === 'C' ? [p0, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }] : [p0, { x: c.x1, y: c.y1 }, { x: c.x, y: c.y }];
      let len = 0;
      for (let i = 1; i < ctrl.length; i++) len += Math.hypot(ctrl[i].x - ctrl[i - 1].x, ctrl[i].y - ctrl[i - 1].y);
      const n = Math.max(2, Math.min(2000, Math.ceil(len / step)));
      for (let i = 1; i <= n; i++) cur.push(bezierAt(ctrl, i / n));
    } else if (start) {
      // Z: back to the start; a following segment carries on from there.
      const last = cur[cur.length - 1];
      if (last && (last.x !== start.x || last.y !== start.y)) cur.push({ ...start });
      flush(true);
      cur = [start];
    }
  }
  flush(false);
  return out;
}

/** Outlines of a selection (closed point lists) as polylines. */
export function outlinesToLines(outlines: readonly (readonly Point[])[]): Polyline[] {
  return outlines.filter((o) => o.length > 1).map((o) => ({ points: [...o, o[0]], closed: true }));
}

/** Simulated pen pressure along a line (t from 0 to 1): it swells in and fades out. */
export function taperAt(t: number): number {
  const ramp = 0.2;
  const k = Math.min(1, Math.max(0, Math.min(t, 1 - t) / ramp));
  return 0.05 + 0.95 * k * k * (3 - 2 * k);
}

export interface PathBrush {
  settings: BrushSettings;
  size: number;
  color: RGBA;
}

/**
 * The brush for stroking a path. With `taper`, a brush that ignores pressure gets its size
 * following it, so the ends always thin out; without, pressure stays full.
 */
export function pathBrushSettings(s: BrushSettings, taper: boolean): BrushSettings {
  if (!taper) return s;
  const usesPressure = Object.values(s.dynamics).some((d) => d?.source === 'pressure');
  return usesPressure ? s : { ...s, dynamics: { ...s.dynamics, size: { source: 'pressure', curve: LINEAR, min: 0 } } };
}

/**
 * Paint lines with a brush into `surface` (a stroke being built), at a steady speed and, with
 * `taper`, simulated pressure. Each line is seeded by where it starts, so the result repeats.
 * Returns the area painted.
 */
export function strokeLines(surface: Surface, lines: readonly Polyline[], b: PathBrush, taper: boolean, pickColor?: (x: number, y: number, r: number) => RGBA | null): Rect | null {
  const settings = pathBrushSettings(b.settings, taper);
  const shape = dabShapeOf(settings);
  let dirty: Rect | null = null;
  for (const line of lines) {
    const pts = line.points;
    if (pts.length < 2) continue;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const stroke = new BrushStroke({ settings, size: b.size, color: b.color, seed: strokeSeed(pts[0].x, pts[0].y), pickColor, emit: (d) => paintDabInto(surface, d, shape) });
    const sample = (p: Point, along: number) => ({ x: p.x, y: p.y, pressure: taper && total > 0 ? taperAt(along / total) : 1, tilt: 0, speed: 0.4 });
    dirty = rectUnion(dirty, stroke.begin(sample(pts[0], 0)));
    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const len = Math.hypot(pts[i].x - a.x, pts[i].y - a.y);
      // Long segments go in short steps, so the simulated pressure follows the taper.
      const n = taper ? Math.max(1, Math.ceil(len / 4)) : 1;
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        dirty = rectUnion(dirty, stroke.to(sample({ x: a.x + (pts[i].x - a.x) * f, y: a.y + (pts[i].y - a.y) * f }, run + len * f)));
      }
      run += len;
    }
  }
  return dirty;
}
