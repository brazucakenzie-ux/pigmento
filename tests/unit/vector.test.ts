import { describe, expect, it } from 'vitest';
import { matRotate, matScale, matChain, matTranslate } from '@engine/core/matrix';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import {
  alignNodes,
  arrangeNodes,
  boundsOf,
  cloneNode,
  distributeNodes,
  groupNodes,
  nodeBounds,
  rectToRect,
  transformNode,
  ungroupNodes,
  type VectorNode,
  type VectorShape,
} from '@engine/vector/model';

const style: ShapeStyle = {
  mode: 'fill',
  width: 2,
  outline: { r: 0, g: 0, b: 0, a: 255 },
  fill: { r: 255, g: 0, b: 0, a: 255 },
  radius: 8,
  antialias: true,
};
const rect = (id: string, x: number, y: number, w: number, h: number): VectorShape => ({
  type: 'shape',
  id,
  shape: 'rect',
  box: { cx: x + w / 2, cy: y + h / 2, w, h, angle: 0 },
  points: [],
  style,
});
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('vector objects', () => {
  it('measure their bounds, also when rotated or grouped', () => {
    expect(nodeBounds(rect('a', 10, 20, 30, 40))).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    const turned: VectorShape = { ...rect('b', 0, 0, 100, 20), box: { cx: 50, cy: 10, w: 100, h: 20, angle: Math.PI / 2 } };
    const b = nodeBounds(turned)!;
    close(b.w, 20);
    close(b.h, 100);
    const line: VectorShape = { type: 'shape', id: 'l', shape: 'line', box: null, points: [{ x: 5, y: 5 }, { x: 50, y: 30 }], style };
    expect(boundsOf([line, rect('c', 60, 0, 10, 10)])).toEqual({ x: 5, y: 0, w: 65, h: 30 });
  });

  it('move, scale and rotate boxes and points', () => {
    const r = rect('a', 0, 0, 100, 50);
    const moved = transformNode(r, matTranslate(10, 5)) as VectorShape;
    expect(moved.box).toEqual({ cx: 60, cy: 30, w: 100, h: 50, angle: 0 });
    const scaled = transformNode(r, rectToRect({ x: 0, y: 0, w: 100, h: 50 }, { x: 0, y: 0, w: 200, h: 25 })) as VectorShape;
    expect(scaled.box).toEqual({ cx: 100, cy: 12.5, w: 200, h: 25, angle: 0 });
    const turned = transformNode(r, matChain(matTranslate(-50, -25), matRotate(Math.PI / 2), matTranslate(50, 25))) as VectorShape;
    close(turned.box!.angle, Math.PI / 2);
    close(turned.box!.w, 100);
    close(turned.box!.h, 50);
    close(turned.box!.cx, 50);
    const line: VectorShape = { type: 'shape', id: 'l', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], style };
    expect((transformNode(line, matScale(2, 3)) as VectorShape).points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('flip a box by making it negative', () => {
    const r = rect('a', 0, 0, 40, 20);
    const f = transformNode(r, matChain(matScale(-1, 1), matTranslate(100, 0))) as VectorShape;
    close(f.box!.cx, 80);
    expect(nodeBounds(f)).toEqual({ x: expect.closeTo(60, 6), y: expect.closeTo(0, 6), w: expect.closeTo(40, 6), h: expect.closeTo(20, 6) });
  });

  it('align to a reference box', () => {
    const nodes = [rect('a', 10, 10, 20, 20), rect('b', 50, 40, 40, 10)];
    const left = alignNodes(nodes, 'left', { x: 0, y: 0, w: 100, h: 100 });
    expect(left.map((n) => nodeBounds(n)!.x)).toEqual([0, 0]);
    const mid = alignNodes(nodes, 'vcenter', { x: 0, y: 0, w: 100, h: 100 });
    expect(mid.map((n) => nodeBounds(n)!.y + nodeBounds(n)!.h / 2)).toEqual([50, 50]);
    const right = alignNodes(nodes, 'right', { x: 0, y: 0, w: 100, h: 100 });
    expect(right.map((n) => nodeBounds(n)!.x + nodeBounds(n)!.w)).toEqual([100, 100]);
  });

  it('distribute with equal gaps, keeping the outer two', () => {
    const nodes = [rect('a', 0, 0, 10, 10), rect('b', 15, 0, 20, 10), rect('c', 90, 0, 10, 10)];
    const out = distributeNodes(nodes, 'x');
    const xs = out.map((n) => nodeBounds(n)!);
    expect(xs[0].x).toBe(0);
    expect(xs[2].x).toBe(90);
    // Gaps: (100 − 40) / 2 = 30 each.
    expect(xs[1].x).toBe(40);
    expect(distributeNodes(nodes.slice(0, 2), 'x')).toEqual(nodes.slice(0, 2));
  });

  it('group, ungroup and arrange', () => {
    const list: VectorNode[] = [rect('a', 0, 0, 1, 1), rect('b', 0, 0, 1, 1), rect('c', 0, 0, 1, 1), rect('d', 0, 0, 1, 1)];
    const g = groupNodes(list, new Set(['a', 'c']));
    expect(g.list.map((n) => n.id)).toEqual(['b', g.id, 'd']);
    const grp = g.list[1];
    expect(grp.type === 'group' && grp.children.map((c) => c.id)).toEqual(['a', 'c']);
    const back = ungroupNodes(g.list, new Set([g.id!]));
    expect(back.list.map((n) => n.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(back.ids).toEqual(['a', 'c']);

    const ids = (l: VectorNode[]) => l.map((n) => n.id);
    expect(ids(arrangeNodes(list, new Set(['b']), 'forward'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(arrangeNodes(list, new Set(['c']), 'backward'))).toEqual(['a', 'c', 'b', 'd']);
    expect(ids(arrangeNodes(list, new Set(['a', 'c']), 'front'))).toEqual(['b', 'd', 'a', 'c']);
    expect(ids(arrangeNodes(list, new Set(['d']), 'back'))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(arrangeNodes(list, new Set(['d']), 'forward'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clone with fresh ids', () => {
    const g = groupNodes([rect('a', 0, 0, 1, 1), rect('b', 0, 0, 1, 1)], new Set(['a', 'b'])).list[0];
    const c = cloneNode(g);
    expect(c.id).not.toBe(g.id);
    expect(c.type === 'group' && c.children[0].id).not.toBe('a');
  });
});
