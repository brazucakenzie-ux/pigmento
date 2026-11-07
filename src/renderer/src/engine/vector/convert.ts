import type { Mat } from '../core/matrix';
import { PathBuilder, type PathCmd } from '../shapes/path';
import { shapePath } from '../shapes/ShapeRegistry';
import { corner, fromCmds, transformSubpaths, type SubPath } from './pathData';
import { shapeDefOf, type ShapeGeom } from './render';

/**
 * Any shape as an editable path (Convert to path, Save as my shape): the same outline it is
 * drawn with, in document coordinates.
 */
export function shapeOutline(g: ShapeGeom): { subpaths: SubPath[]; fillRule: 'evenodd' | 'nonzero' } | null {
  if (g.shape === 'path') return g.subpaths?.length ? { subpaths: [...g.subpaths], fillRule: g.fillRule ?? 'evenodd' } : null;
  if (g.box) {
    const b = g.box;
    const def = shapeDefOf(g);
    // Outlines are drawn inset so they stay inside the box; the path keeps that outline.
    const inset = g.style.mode === 'fill' && !def?.strokeOnly ? 0 : g.style.width / 2;
    const hw = Math.max(0.5, Math.abs(b.w) / 2 - inset);
    const hh = Math.max(0.5, Math.abs(b.h) / 2 - inset);
    let cmds: PathCmd[];
    if (g.shape === 'parametric' && def) {
      cmds = shapePath(def, hw * 2, hh * 2, g.params).map((c) => shift(c, -hw, -hh));
    } else if (g.shape === 'ellipse') cmds = new PathBuilder().ellipse(0, 0, hw, hh).cmds;
    else if (g.shape === 'roundRect') cmds = new PathBuilder().roundRect(-hw, -hh, hw * 2, hh * 2, Math.max(0, Math.min(g.style.radius - inset, hw, hh))).cmds;
    else cmds = new PathBuilder().rect(-hw, -hh, hw * 2, hh * 2).cmds;
    const c = Math.cos(b.angle);
    const s = Math.sin(b.angle);
    const sx = g.shape === 'parametric' ? Math.sign(b.w) || 1 : 1;
    const sy = g.shape === 'parametric' ? Math.sign(b.h) || 1 : 1;
    const m: Mat = [c * sx, s * sx, -s * sy, c * sy, b.cx, b.cy];
    return { subpaths: transformSubpaths(fromCmds(cmds), m), fillRule: def?.fillRule ?? 'nonzero' };
  }
  const p = g.points;
  if (p.length < 2) return null;
  if (g.shape === 'curve' && p.length === 4) {
    return {
      subpaths: [
        {
          closed: false,
          anchors: [
            { x: p[0].x, y: p[0].y, in: null, out: { ...p[1] }, smooth: false },
            { x: p[3].x, y: p[3].y, in: { ...p[2] }, out: null, smooth: false },
          ],
        },
      ],
      fillRule: 'nonzero',
    };
  }
  return { subpaths: [{ closed: g.shape === 'polygon', anchors: p.map((q) => corner(q.x, q.y)) }], fillRule: 'nonzero' };
}

function shift(c: PathCmd, dx: number, dy: number): PathCmd {
  switch (c.op) {
    case 'M':
    case 'L':
      return { ...c, x: c.x + dx, y: c.y + dy };
    case 'C':
      return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
    case 'Q':
      return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x: c.x + dx, y: c.y + dy };
    default:
      return c;
  }
}
