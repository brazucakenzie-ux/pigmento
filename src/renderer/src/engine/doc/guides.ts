/**
 * Ruler guides: lines across the canvas at a document position. `x` guides are vertical
 * (constant x), `y` guides horizontal. Saved in projects; changes are undoable.
 */
export interface Guide {
  readonly id: string;
  readonly axis: 'x' | 'y';
  readonly pos: number;
}

let next = 1;

export function newGuideId(): string {
  return `guide-${next++}-${Date.now().toString(36)}`;
}

export function guide(axis: 'x' | 'y', pos: number, id = newGuideId()): Guide {
  return { id, axis, pos: Math.round(pos * 100) / 100 };
}

/** Guides after the canvas becomes `r` (in old coordinates); those outside it are dropped. */
export function reframeGuides(list: readonly Guide[], r: { x: number; y: number; w: number; h: number }): Guide[] {
  return list
    .map((g) => ({ ...g, pos: g.axis === 'x' ? g.pos - r.x : g.pos - r.y }))
    .filter((g) => g.pos >= 0 && g.pos <= (g.axis === 'x' ? r.w : r.h));
}

/** Guides after resizing the image from w×h to nw×nh. */
export function scaleGuides(list: readonly Guide[], w: number, h: number, nw: number, nh: number): Guide[] {
  return list.map((g) => ({ ...g, pos: Math.round(g.pos * (g.axis === 'x' ? nw / w : nh / h) * 100) / 100 }));
}

/** Guides after a flip or a quarter turn of a w×h image (clockwise turns). */
export function turnGuides(list: readonly Guide[], w: number, h: number, op: { kind: 'flip'; axis: 'h' | 'v' } | { kind: 'rotate'; quarterTurns: number }): Guide[] {
  if (op.kind === 'flip') {
    return list.map((g) => (op.axis === 'h' && g.axis === 'x' ? { ...g, pos: w - g.pos } : op.axis === 'v' && g.axis === 'y' ? { ...g, pos: h - g.pos } : g));
  }
  const q = ((op.quarterTurns % 4) + 4) % 4;
  return list.map((g) => {
    if (q === 0) return g;
    if (q === 2) return { ...g, pos: g.axis === 'x' ? w - g.pos : h - g.pos };
    // 90° clockwise: (x, y) → (h − y, x); 270°: (x, y) → (y, w − x).
    if (q === 1) return g.axis === 'x' ? { ...g, axis: 'y', pos: g.pos } : { ...g, axis: 'x', pos: h - g.pos };
    return g.axis === 'x' ? { ...g, axis: 'y', pos: w - g.pos } : { ...g, axis: 'x', pos: g.pos };
  });
}
