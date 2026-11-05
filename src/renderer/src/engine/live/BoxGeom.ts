import type { Point, Rect } from '../core/geometry';
import { matApply, matChain, matRotate, matScale, matTranslate, type Mat } from '../core/matrix';

/**
 * Oriented box: centre, signed size (negative = flipped) and rotation (radians) about the
 * centre. Used by box shapes and floating selections.
 */
export interface BoxGeom {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** Local unit position of each resize handle (-0.5..0.5). */
const HANDLE_POS: Record<Exclude<BoxHandle, 'rotate'>, [number, number]> = {
  nw: [-0.5, -0.5],
  n: [0, -0.5],
  ne: [0.5, -0.5],
  e: [0.5, 0],
  se: [0.5, 0.5],
  s: [0, 0.5],
  sw: [-0.5, 0.5],
  w: [-0.5, 0],
};

export const RESIZE_HANDLES = Object.keys(HANDLE_POS) as Exclude<BoxHandle, 'rotate'>[];

/** Distance (CSS px) of the rotate handle above the top edge. */
export const ROTATE_HANDLE_OFFSET = 26;

export function boxFromRect(r: Rect): BoxGeom {
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, angle: 0 };
}

/** Maps local coordinates (centred, unflipped pixel units) to document space. */
export function boxMatrix(g: BoxGeom): Mat {
  return matChain(matScale(Math.sign(g.w) || 1, Math.sign(g.h) || 1), matRotate(g.angle), matTranslate(g.cx, g.cy));
}

/** Document position of a point given in unit box coordinates (-0.5..0.5). */
export function boxPoint(g: BoxGeom, ux: number, uy: number): Point {
  const lx = ux * g.w;
  const ly = uy * g.h;
  const c = Math.cos(g.angle);
  const s = Math.sin(g.angle);
  return { x: g.cx + lx * c - ly * s, y: g.cy + lx * s + ly * c };
}

export function boxCorners(g: BoxGeom): Point[] {
  return [boxPoint(g, -0.5, -0.5), boxPoint(g, 0.5, -0.5), boxPoint(g, 0.5, 0.5), boxPoint(g, -0.5, 0.5)];
}

export function boxBounds(g: BoxGeom): Rect {
  const pts = boxCorners(g);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

export function handlePosition(g: BoxGeom, h: BoxHandle, zoom: number): Point {
  if (h === 'rotate') {
    const top = boxPoint(g, 0, -0.5 * Math.sign(g.h || 1));
    const off = ROTATE_HANDLE_OFFSET / zoom;
    return { x: top.x + Math.sin(g.angle) * off, y: top.y - Math.cos(g.angle) * off };
  }
  const [ux, uy] = HANDLE_POS[h];
  return boxPoint(g, ux, uy);
}

/** Point in the box's unrotated local frame (relative to centre). */
function toLocal(g: BoxGeom, p: Point): Point {
  const dx = p.x - g.cx;
  const dy = p.y - g.cy;
  const c = Math.cos(-g.angle);
  const s = Math.sin(-g.angle);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function boxContains(g: BoxGeom, p: Point): boolean {
  const l = toLocal(g, p);
  return Math.abs(l.x) <= Math.abs(g.w) / 2 && Math.abs(l.y) <= Math.abs(g.h) / 2;
}

/** Hit-test handles in screen space; returns the handle under the pointer or null. */
export function hitHandle(
  g: BoxGeom,
  screen: (p: Point) => Point,
  sp: Point,
  zoom: number,
  withRotate = true,
  tolerance = 7,
): BoxHandle | null {
  const order: BoxHandle[] = withRotate ? ['rotate', ...RESIZE_HANDLES] : [...RESIZE_HANDLES];
  for (const h of order) {
    const hp = screen(handlePosition(g, h, zoom));
    if (Math.abs(hp.x - sp.x) <= tolerance && Math.abs(hp.y - sp.y) <= tolerance) return h;
  }
  return null;
}

export interface ResizeModifiers {
  keepAspect: boolean;
  fromCenter: boolean;
}

/**
 * New geometry after dragging resize handle `h` of `start` to document point `p`. The
 * opposite handle stays fixed (or the centre with `fromCenter`). Sizes may go negative,
 * which flips the content.
 */
export function resizeBox(start: BoxGeom, h: Exclude<BoxHandle, 'rotate'>, p: Point, mods: ResizeModifiers): BoxGeom {
  const [ux, uy] = HANDLE_POS[h];
  const l = toLocal(start, p);
  const changesX = ux !== 0;
  const changesY = uy !== 0;
  // Anchor in local coordinates (opposite handle, or centre).
  const ax = mods.fromCenter ? 0 : -ux * start.w;
  const ay = mods.fromCenter ? 0 : -uy * start.h;
  // Sizes are signed: the handle sits at u·size from the new centre and the anchor at -u·size.
  let nw = start.w;
  let nh = start.h;
  if (changesX) nw = mods.fromCenter ? l.x / ux : (l.x - ax) * Math.sign(ux);
  if (changesY) nh = mods.fromCenter ? l.y / uy : (l.y - ay) * Math.sign(uy);

  if (mods.keepAspect && start.w !== 0 && start.h !== 0) {
    const sx = nw / start.w;
    const sy = nh / start.h;
    let k: number;
    if (changesX && changesY) k = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    else k = changesX ? sx : sy;
    nw = start.w * k;
    nh = start.h * k;
  }

  // New centre (local frame) = anchor + u·size on each dragged axis. An axis that is not
  // dragged (edge handles) stays centred, so keep-aspect grows it symmetrically.
  let lcx = 0;
  let lcy = 0;
  if (!mods.fromCenter) {
    if (changesX) lcx = ax + ux * nw;
    if (changesY) lcy = ay + uy * nh;
  }
  const c = Math.cos(start.angle);
  const s = Math.sin(start.angle);
  return {
    cx: start.cx + lcx * c - lcy * s,
    cy: start.cy + lcx * s + lcy * c,
    w: nw,
    h: nh,
    angle: start.angle,
  };
}

/** Rotation after dragging from `from` to `to` around the box centre; `snap` = 15° steps. */
export function rotateBox(start: BoxGeom, from: Point, to: Point, snap: boolean): BoxGeom {
  const a0 = Math.atan2(from.y - start.cy, from.x - start.cx);
  const a1 = Math.atan2(to.y - start.cy, to.x - start.cx);
  let angle = start.angle + (a1 - a0);
  if (snap) {
    const step = Math.PI / 12;
    angle = Math.round(angle / step) * step;
  }
  return { ...start, angle: normalizeAngle(angle) };
}

export function normalizeAngle(a: number): number {
  const t = Math.PI * 2;
  let r = a % t;
  if (r > Math.PI) r -= t;
  if (r <= -Math.PI) r += t;
  return r;
}

export function moveBox(start: BoxGeom, dx: number, dy: number): BoxGeom {
  return { ...start, cx: start.cx + dx, cy: start.cy + dy };
}

/** CSS cursor for a resize handle, accounting for rotation. */
export function handleCursor(h: BoxHandle, angle: number): string {
  if (h === 'rotate') return 'grab';
  const base: Record<Exclude<BoxHandle, 'rotate'>, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const deg = (((base[h] + (angle * 180) / Math.PI) % 180) + 180) % 180;
  const idx = Math.round(deg / 45) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][idx];
}

/** Apply a box transform change (start → next) to free points (used for point shapes). */
export function transformPoints(points: readonly Point[], start: BoxGeom, next: BoxGeom): Point[] {
  const sx = start.w === 0 ? 1 : next.w / start.w;
  const sy = start.h === 0 ? 1 : next.h / start.h;
  return points.map((p) => {
    const l = toLocal(start, p);
    const nl = { x: l.x * sx, y: l.y * sy };
    const c = Math.cos(next.angle);
    const s = Math.sin(next.angle);
    return matApply([c, s, -s, c, next.cx, next.cy], nl.x, nl.y);
  });
}
