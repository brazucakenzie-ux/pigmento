import { describe, expect, it } from 'vitest';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { loadProject, saveProject, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { PathBuilder, pathBounds } from '@engine/shapes/path';
import { customShapeDef, shapePath, SHAPE_CATEGORIES } from '@engine/shapes/ShapeRegistry';
import { shapeOutline } from '@engine/vector/convert';
import { shapeBounds, transformNode, type VectorShape } from '@engine/vector/model';
import {
  corner,
  fromCmds,
  insertAnchor,
  moveHandle,
  nearestSegment,
  removeAnchor,
  setClosed,
  setSmooth,
  subpathBounds,
  toCmds,
  toUnitBox,
  type SubPath,
} from '@engine/vector/pathData';
import { CustomShapeSchema, SHAPE_FILE_CATEGORIES } from '@shared/shapeFormat';

const rawCodec: PngCodec = {
  async encode(data, w, h) {
    const out = new Uint8Array(8 + data.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(data, 8);
    return out;
  },
  async decode(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(0), h: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

const style: ShapeStyle = { mode: 'both', width: 4, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 255, g: 0, b: 0, a: 255 }, radius: 0, antialias: true };
const square: SubPath = { closed: true, anchors: [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)] };

describe('path data', () => {
  it('reads library outlines as subpaths and writes them back', () => {
    const rect = fromCmds(new PathBuilder().rect(10, 20, 30, 40).cmds);
    expect(rect).toHaveLength(1);
    expect(rect[0].closed).toBe(true);
    expect(rect[0].anchors).toHaveLength(4);
    expect(subpathBounds(rect)).toEqual({ x: 10, y: 20, w: 30, h: 40 });

    const ellipse = fromCmds(new PathBuilder().ellipse(50, 50, 40, 20).cmds);
    expect(ellipse[0].anchors.every((a) => a.smooth && a.in && a.out)).toBe(true);
    const b = subpathBounds(ellipse)!;
    expect(b.w).toBeCloseTo(80, 0);
    expect(b.h).toBeCloseTo(40, 0);
    // A ring is two subpaths (the hole too).
    expect(fromCmds(new PathBuilder().ellipse(0, 0, 10, 10).ellipse(0, 0, 5, 5, true).cmds)).toHaveLength(2);
    // Quadratic curves become cubic ones through the same ends.
    const q = fromCmds(new PathBuilder().m(0, 0).q(50, 100, 100, 0).cmds);
    expect(toCmds(q)[1].op).toBe('C');
  });

  it('adds a point on a segment without changing the outline', () => {
    const curve = fromCmds(new PathBuilder().ellipse(50, 50, 40, 40).cmds);
    const before = subpathBounds(curve)!;
    const r = insertAnchor(curve, 0, 1, 0.5);
    expect(r.subs[0].anchors).toHaveLength(5);
    const after = subpathBounds(r.subs)!;
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(after[k]).toBeCloseTo(before[k], 1);
    // A straight segment gets a corner point in its middle.
    const s = insertAnchor([square], 0, 0, 0.5);
    expect(s.subs[0].anchors[1]).toEqual({ x: 50, y: 0, in: null, out: null, smooth: false });
    // The closing segment's new point goes at the end.
    expect(insertAnchor([square], 0, 3, 0.5).index).toBe(4);
  });

  it('finds the nearest segment', () => {
    const n = nearestSegment([square], { x: 98, y: 50 })!;
    expect(n.seg).toBe(1);
    expect(n.t).toBeCloseTo(0.5, 1);
    expect(n.dist).toBeCloseTo(2, 0);
  });

  it('makes points smooth or corners, and keeps smooth handles in line', () => {
    const smooth = setSmooth([square], 0, 1, true);
    const a = smooth[0].anchors[1];
    expect(a.smooth).toBe(true);
    expect(a.in && a.out).toBeTruthy();
    // Handles point in opposite directions.
    const ix = a.in!.x - a.x;
    const iy = a.in!.y - a.y;
    const ox = a.out!.x - a.x;
    const oy = a.out!.y - a.y;
    expect(ix * oy - iy * ox).toBeCloseTo(0);
    expect(ix * ox + iy * oy).toBeLessThan(0);
    const moved = moveHandle(smooth, 0, 1, 'out', { x: 100, y: 60 })[0].anchors[1];
    expect(moved.in!.x).toBeCloseTo(100);
    expect(moved.in!.y).toBeLessThan(0);
    const broken = moveHandle(smooth, 0, 1, 'out', { x: 120, y: 30 }, true)[0].anchors[1];
    expect(broken.smooth).toBe(false);
    expect(broken.in).toEqual(a.in);
    expect(setSmooth(smooth, 0, 1, false)[0].anchors[1]).toEqual(corner(100, 0));
  });

  it('removes points and opens or closes subpaths', () => {
    expect(removeAnchor([square], 0, 2)[0].anchors).toHaveLength(3);
    const line: SubPath = { closed: false, anchors: [corner(0, 0), corner(10, 0)] };
    expect(removeAnchor([line], 0, 0)).toEqual([]);
    expect(setClosed([square], 0, false)[0].closed).toBe(false);
  });

  it('scales an outline into a unit box', () => {
    const u = toUnitBox([{ closed: true, anchors: [corner(10, 10), corner(210, 10), corner(210, 110)] }])!;
    expect(u.aspect).toBe(2);
    expect(subpathBounds(u.subs)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(toUnitBox([{ closed: false, anchors: [corner(5, 5), corner(5, 9)] }])).toBeNull();
  });
});

describe('personal shapes', () => {
  it('draw their outline into any box', () => {
    const unit = toUnitBox([square, { closed: true, anchors: [corner(25, 25), corner(75, 25), corner(50, 75)] }])!.subs;
    const def = customShapeDef({ id: 'my-00000000-0000-0000-0000-000000000000', name: 'Mine', category: 'custom', unit, fillRule: 'evenodd', aspect: 1 });
    expect(def.custom).toBe(true);
    expect(def.strokeOnly).toBe(false);
    expect(pathBounds(shapePath(def, 200, 50))).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    const lines = customShapeDef({ id: 'my-x', name: 'L', category: 'arrows', unit: [{ closed: false, anchors: [corner(0, 0), corner(1, 1)] }], fillRule: 'nonzero', aspect: 1 });
    expect(lines.strokeOnly).toBe(true);
  });

  it('have a file format that matches the gallery', () => {
    expect(SHAPE_FILE_CATEGORIES).toEqual([...SHAPE_CATEGORIES, 'custom']);
    const good = {
      format: 'pigmento-shape',
      version: 1,
      id: 'my-0b8f2c1e-6c2a-4e5b-9a7d-3f1e2d4c5b6a',
      name: 'Badge',
      category: 'symbols',
      aspect: 1.5,
      fillRule: 'evenodd',
      outline: [{ closed: true, anchors: [corner(0, 0), corner(1, 0), corner(0.5, 1)] }],
      createdAt: 1,
    };
    expect(CustomShapeSchema.safeParse(good).success).toBe(true);
    expect(CustomShapeSchema.safeParse({ ...good, id: '../../evil' }).success).toBe(false);
    expect(CustomShapeSchema.safeParse({ ...good, name: '   ' }).success).toBe(false);
    expect(CustomShapeSchema.safeParse({ ...good, outline: [] }).success).toBe(false);
    expect(CustomShapeSchema.safeParse({ ...good, outline: [{ closed: true, anchors: [{ x: 1e9, y: 0, in: null, out: null, smooth: false }] }] }).success).toBe(false);
  });
});

describe('converting shapes to paths', () => {
  it('keeps the outline as drawn (rotated, inset for the outline)', () => {
    const rect: VectorShape = { type: 'shape', id: 'r', shape: 'rect', box: { cx: 50, cy: 50, w: 40, h: 20, angle: Math.PI / 2 }, points: [], style };
    const o = shapeOutline(rect)!;
    const b = subpathBounds(o.subpaths)!;
    // Turned a quarter: 16 wide and 36 tall once the 4 px outline is inset.
    expect(b.w).toBeCloseTo(16);
    expect(b.h).toBeCloseTo(36);
    const star: VectorShape = { type: 'shape', id: 's', shape: 'parametric', box: { cx: 0, cy: 0, w: 100, h: 100, angle: 0 }, points: [], style: { ...style, mode: 'fill' }, shapeId: 'star-5', params: {} };
    expect(shapeOutline(star)!.subpaths[0].anchors).toHaveLength(10);
    const curve: VectorShape = { type: 'shape', id: 'c', shape: 'curve', box: null, points: [{ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 30, y: 0 }], style };
    const c = shapeOutline(curve)!.subpaths[0];
    expect(c.closed).toBe(false);
    expect(c.anchors[0].out).toEqual({ x: 10, y: 30 });
  });

  it('moves and saves paths and personal shapes', async () => {
    const pathNode: VectorShape = { type: 'shape', id: 'p', shape: 'path', box: null, points: [], style, subpaths: setSmooth([square], 0, 2, true), fillRule: 'nonzero' };
    expect(shapeBounds(pathNode)).toEqual(subpathBounds(pathNode.subpaths!));
    const moved = transformNode(pathNode, [1, 0, 0, 1, 5, 7]) as VectorShape;
    expect(moved.subpaths![0].anchors[0]).toEqual(corner(5, 7));
    const unit = toUnitBox([square])!.subs;
    const mine: VectorShape = { type: 'shape', id: 'm', shape: 'parametric', box: { cx: 50, cy: 50, w: 80, h: 40, angle: 0 }, points: [], style, shapeId: 'my-0b8f2c1e-6c2a-4e5b-9a7d-3f1e2d4c5b6a', params: {}, unitPath: unit, fillRule: 'evenodd' };
    const doc = new PaintDocument({ width: 100, height: 100 }, [new VectorLayer('S', 100, 100, [pathNode, mine])]);
    const back = await loadProject(await saveProject(doc, rawCodec), rawCodec);
    const l = back.layers[0];
    if (l.kind !== 'vector') throw new Error('not a shape layer');
    expect(l.objects).toEqual([pathNode, mine]);
  });

  it('refuses a path without points', async () => {
    const bad: VectorShape = { type: 'shape', id: 'p', shape: 'path', box: null, points: [], style };
    const bytes = await saveProject(new PaintDocument({ width: 10, height: 10 }, [new VectorLayer('S', 10, 10, [bad])]), rawCodec);
    await expect(loadProject(bytes, rawCodec)).rejects.toThrow();
  });
});
