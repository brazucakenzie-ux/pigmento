import { boundsOfPoints, rectUnion, type Point, type Rect } from '../core/geometry';
import { matChain, matScale, matTranslate, type Mat } from '../core/matrix';
import { boxBounds, type BoxGeom } from '../live/BoxGeom';
import type { ShapeKind, ShapeStyle } from '../live/ShapeObject';

/**
 * Objects on a shape (vector) layer. Immutable: edits make new objects, so history steps can
 * keep the before/after lists without copying.
 */
export interface VectorShape {
  readonly type: 'shape';
  readonly id: string;
  readonly shape: ShapeKind;
  /** Box shapes (rectangle, rounded rectangle, ellipse) use an oriented box… */
  readonly box: BoxGeom | null;
  /** …point shapes (line, curve, polygon) their points. */
  readonly points: readonly Point[];
  readonly style: ShapeStyle;
  /** Library shape and its slider values (parametric shapes only). */
  readonly shapeId?: string;
  readonly params?: Readonly<Record<string, number>>;
}

export interface VectorGroup {
  readonly type: 'group';
  readonly id: string;
  readonly children: readonly VectorNode[];
}

export type VectorNode = VectorShape | VectorGroup;

let counter = 1;

export function vectorId(): string {
  return `v${counter++}-${Date.now().toString(36)}`;
}

export function* walkShapes(nodes: readonly VectorNode[]): Generator<VectorShape> {
  for (const n of nodes) {
    if (n.type === 'shape') yield n;
    else yield* walkShapes(n.children);
  }
}

/** Geometric bounds (without the outline's width). */
export function shapeBounds(s: VectorShape): Rect | null {
  if (s.box) return boxBounds(s.box);
  return boundsOfPoints([...s.points]);
}

export function nodeBounds(n: VectorNode): Rect | null {
  if (n.type === 'shape') return shapeBounds(n);
  return boundsOf(n.children);
}

export function boundsOf(nodes: readonly VectorNode[]): Rect | null {
  let r: Rect | null = null;
  for (const n of nodes) r = rectUnion(r, nodeBounds(n));
  return r;
}

const apply = (m: Mat, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

/**
 * Apply an affine to a node. Boxes keep their kind: the centre moves, the sides scale and the
 * angle turns (a skew is approximated by the nearest rectangle); a flip makes the box negative.
 */
export function transformNode(n: VectorNode, m: Mat): VectorNode {
  if (n.type === 'group') return { ...n, children: n.children.map((c) => transformNode(c, m)) };
  if (!n.box) return { ...n, points: n.points.map((p) => apply(m, p)) };
  const g = n.box;
  const c = apply(m, { x: g.cx, y: g.cy });
  const cos = Math.cos(g.angle);
  const sin = Math.sin(g.angle);
  // Box sides as vectors, then through the linear part of m.
  const ux = (m[0] * cos + m[2] * sin) * g.w;
  const uy = (m[1] * cos + m[3] * sin) * g.w;
  const vx = (m[0] * -sin + m[2] * cos) * g.h;
  const vy = (m[1] * -sin + m[3] * cos) * g.h;
  const wLen = Math.hypot(ux, uy);
  const angle = Math.atan2(uy, ux);
  // Height: the part of the second side perpendicular to the first (signed: negative = flipped).
  const h = wLen > 1e-12 ? (ux * vy - uy * vx) / wLen : Math.hypot(vx, vy);
  const sign = Math.sign(g.w) || 1;
  return { ...n, box: { cx: c.x, cy: c.y, w: wLen * sign, h: h * sign, angle: sign < 0 ? angle + Math.PI : angle } };
}

export function translateNode(n: VectorNode, dx: number, dy: number): VectorNode {
  return transformNode(n, matTranslate(dx, dy));
}

/** The affine taking rectangle `from` onto `to` (resize handles). */
export function rectToRect(from: Rect, to: Rect): Mat {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  return matChain(matTranslate(-from.x, -from.y), matScale(sx, sy), matTranslate(to.x, to.y));
}

/** Replace top-level nodes by id. */
export function replaceNodes(list: readonly VectorNode[], next: ReadonlyMap<string, VectorNode>): VectorNode[] {
  return list.map((n) => next.get(n.id) ?? n);
}

export function removeNodes(list: readonly VectorNode[], ids: ReadonlySet<string>): VectorNode[] {
  return list.filter((n) => !ids.has(n.id));
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Move each node so its bounds line up with `ref` (the selection, or the canvas for one object). */
export function alignNodes(nodes: readonly VectorNode[], how: Align, ref: Rect): VectorNode[] {
  return nodes.map((n) => {
    const b = nodeBounds(n);
    if (!b) return n;
    const dx =
      how === 'left' ? ref.x - b.x : how === 'right' ? ref.x + ref.w - (b.x + b.w) : how === 'hcenter' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : 0;
    const dy =
      how === 'top' ? ref.y - b.y : how === 'bottom' ? ref.y + ref.h - (b.y + b.h) : how === 'vcenter' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : 0;
    return dx || dy ? translateNode(n, dx, dy) : n;
  });
}

/**
 * Space nodes evenly along an axis: the outermost two stay put and the gaps between the
 * others become equal. Needs three or more.
 */
export function distributeNodes(nodes: readonly VectorNode[], axis: 'x' | 'y'): VectorNode[] {
  if (nodes.length < 3) return [...nodes];
  const items = nodes
    .map((n) => ({ n, b: nodeBounds(n) }))
    .filter((i): i is { n: VectorNode; b: Rect } => i.b !== null)
    .sort((a, b) => (axis === 'x' ? a.b.x + a.b.w / 2 - (b.b.x + b.b.w / 2) : a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2)));
  const start = (b: Rect) => (axis === 'x' ? b.x : b.y);
  const size = (b: Rect) => (axis === 'x' ? b.w : b.h);
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = start(last) + size(last) - start(first);
  const used = items.reduce((s, i) => s + size(i.b), 0);
  const gap = (total - used) / (items.length - 1);
  const moved = new Map<string, VectorNode>();
  let at = start(first);
  for (const i of items) {
    const d = at - start(i.b);
    moved.set(i.n.id, d ? translateNode(i.n, axis === 'x' ? d : 0, axis === 'y' ? d : 0) : i.n);
    at += size(i.b) + gap;
  }
  return nodes.map((n) => moved.get(n.id) ?? n);
}

/** Put the selected nodes into a new group where the topmost of them was. */
export function groupNodes(list: readonly VectorNode[], ids: ReadonlySet<string>): { list: VectorNode[]; id: string | null } {
  const picked = list.filter((n) => ids.has(n.id));
  if (picked.length < 2) return { list: [...list], id: null };
  const group: VectorGroup = { type: 'group', id: vectorId(), children: picked };
  const top = list.reduce((k, n, i) => (ids.has(n.id) ? i : k), -1);
  const out: VectorNode[] = [];
  list.forEach((n, i) => {
    if (i === top) out.push(group);
    else if (!ids.has(n.id)) out.push(n);
  });
  return { list: out, id: group.id };
}

/** Replace selected groups by their children (in place). */
export function ungroupNodes(list: readonly VectorNode[], ids: ReadonlySet<string>): { list: VectorNode[]; ids: string[] } {
  const out: VectorNode[] = [];
  const freed: string[] = [];
  for (const n of list) {
    if (n.type === 'group' && ids.has(n.id)) {
      out.push(...n.children);
      freed.push(...n.children.map((c) => c.id));
    } else out.push(n);
  }
  return { list: out, ids: freed };
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back';

/** Change the stacking order of the selected nodes (later in the list = on top). */
export function arrangeNodes(list: readonly VectorNode[], ids: ReadonlySet<string>, how: Arrange): VectorNode[] {
  const picked = list.filter((n) => ids.has(n.id));
  const rest = list.filter((n) => !ids.has(n.id));
  if (how === 'front') return [...rest, ...picked];
  if (how === 'back') return [...picked, ...rest];
  const out = [...list];
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out;
}

/** Deep copy with fresh ids (duplicating a layer or objects). */
export function cloneNode(n: VectorNode): VectorNode {
  if (n.type === 'group') return { ...n, id: vectorId(), children: n.children.map(cloneNode) };
  return { ...n, id: vectorId() };
}

/** New slider values for a parametric shape (other nodes unchanged). */
export function reparamNode(n: VectorNode, params: Readonly<Record<string, number>>): VectorNode {
  if (n.type !== 'shape' || n.shape !== 'parametric') return n;
  return { ...n, params: { ...n.params, ...params } };
}

/** New style on every shape in a node. */
export function restyleNode(n: VectorNode, change: (s: ShapeStyle) => ShapeStyle): VectorNode {
  if (n.type === 'group') return { ...n, children: n.children.map((c) => restyleNode(c, change)) };
  return { ...n, style: change(n.style) };
}
