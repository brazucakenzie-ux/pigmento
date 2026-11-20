import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { VectorEditCommand, type CommandHost } from '@engine/history/commands';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { bakeFollow, docPaths, outlinesOf, sceneOf } from '@engine/anim/follow';
import { fromPolyline, measurePath, type PathMeasure } from '@engine/anim/pathMeasure';
import { identityState } from '@engine/anim/interpolate';
import { pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { alongPath, selectionKeys } from '@engine/tools/treeEdit';
import type { ToolContext } from '@engine/tools/Tool';
import { loadProject, saveProject, versionFor, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import type { ImageBuf } from '@engine/raster/transform';
import { corner, type PathAnchor, type SubPath } from '@engine/vector/pathData';
import type { VectorShape } from '@engine/vector/model';

const img = (w: number, h: number): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

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

const style: ShapeStyle = { mode: 'outline', width: 2, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 255, g: 255, b: 255, a: 255 }, radius: 0, antialias: true };

const smooth = (x: number, y: number, inn: { x: number; y: number }, out: { x: number; y: number }): PathAnchor => ({ x, y, in: inn, out, smooth: true });

/** An S-curve from (20, 150) to (380, 150): two Bézier segments that bend opposite ways. */
const sCurve: SubPath = {
  closed: false,
  anchors: [smooth(20, 150, { x: 20, y: 150 }, { x: 80, y: 20 }), smooth(200, 150, { x: 140, y: 280 }, { x: 260, y: 20 }), smooth(380, 150, { x: 320, y: 280 }, { x: 380, y: 150 })],
};

const pathShape = (id: string, subpaths: SubPath[]): VectorShape => ({ type: 'shape', id, shape: 'path', box: null, points: [], style, subpaths });

/** A closed square 100 px a side, corners at (100, 100) and (200, 200), clockwise on the canvas. */
const square: SubPath = { closed: true, anchors: [corner(100, 100), corner(200, 100), corner(200, 200), corner(100, 200)] };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('measuring a path', () => {
  it('is even: the same step along it covers the same distance, curves included', () => {
    const m = measurePath(sCurve)!;
    expect(m.closed).toBe(false);
    // Fine enough steps that each is nearly straight (a chord across a bend is shorter than the arc).
    const pts = Array.from({ length: 201 }, (_, i) => m.at(i / 200));
    const steps = pts.slice(1).map((p, i) => dist(p, pts[i]));
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const s of steps) expect(Math.abs(s - mean) / mean).toBeLessThan(0.01);
    // The steps add up to the length (a chord is never longer than the arc).
    expect(mean * 200).toBeLessThanOrEqual(m.length + 1e-6);
    expect(mean * 200).toBeGreaterThan(m.length * 0.999);
    expect(m.at(0)).toEqual({ x: 20, y: 150 });
    const end = m.at(1);
    expect(end.x).toBeCloseTo(380, 9);
    expect(end.y).toBeCloseTo(150, 9);
  });

  it('goes round a closed path again past its end, and stops at an open one’s ends', () => {
    const m = measurePath(square)!;
    expect(m.length).toBeCloseTo(400, 9);
    expect(m.at(0.25)).toEqual({ x: 200, y: 100 });
    expect(m.at(1.25)).toEqual(m.at(0.25));
    expect(m.at(-0.25)).toEqual(m.at(0.75));
    expect(m.at(0.125)).toEqual({ x: 150, y: 100 });
    const open = fromPolyline([0, 10], [0, 0], false);
    expect(open.at(1.5)).toEqual({ x: 10, y: 0 });
    expect(open.at(-1)).toEqual({ x: 0, y: 0 });
    expect(open.at(Number.NaN)).toEqual({ x: 0, y: 0 });
  });

  it('knows which way it goes (corners take the side after them)', () => {
    const m = measurePath(square)!;
    expect(m.direction(0.1)).toBeCloseTo(0, 9);
    expect(m.direction(0.3)).toBeCloseTo(Math.PI / 2, 9);
    expect(m.direction(0.25)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(m.direction(0.6)!)).toBeCloseTo(Math.PI, 9);
    expect(m.direction(0.9)).toBeCloseTo(-Math.PI / 2, 9);
    const open = fromPolyline([0, 10, 10], [0, 0, 10], false);
    expect(open.direction(1)).toBeCloseTo(Math.PI / 2, 9);
    expect(fromPolyline([5, 5], [5, 5], false).direction(0.5)).toBeNull();
  });

  it('finds how far along the path comes nearest a point, on the nearest turn round a closed one', () => {
    const m = measurePath(square)!;
    expect(m.nearest({ x: 150, y: 90 })).toBeCloseTo(0.125, 9);
    expect(m.nearest({ x: 210, y: 150 })).toBeCloseTo(0.375, 9);
    // Already round twice: it stays on that turn, even across the start.
    expect(m.nearest({ x: 150, y: 90 }, 2.1)).toBeCloseTo(2.125, 9);
    expect(m.nearest({ x: 110, y: 99 }, 2.98)).toBeCloseTo(3.025, 9);
    const s = measurePath(sCurve)!;
    for (const t of [0, 0.2, 0.5, 0.77, 1]) expect(s.nearest(s.at(t))).toBeCloseTo(t, 3);
  });

  it('needs two anchors, and measures any shape’s outline', () => {
    expect(measurePath({ closed: false, anchors: [corner(1, 1)] })).toBeNull();
    const rect: VectorShape = { type: 'shape', id: 'r', shape: 'rect', box: { cx: 50, cy: 40, w: 60, h: 20, angle: 0 }, points: [], style: { ...style, mode: 'fill' } };
    const [m] = outlinesOf(rect);
    expect(m!.closed).toBe(true);
    expect(m!.length).toBeCloseTo(160, 6);
    const line: VectorShape = { type: 'shape', id: 'l', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 30, y: 40 }], style };
    expect(outlinesOf(line)[0]!.length).toBeCloseTo(50, 9);
    // Measured once per shape.
    expect(outlinesOf(line)).toBe(outlinesOf(line));
  });
});

describe('following a path', () => {
  let doc: PaintDocument;
  let history: History;
  let notices: string[];
  let anim: AnimationController;
  let shapes: VectorLayer;
  const vectorHost = { vectorChanged: () => undefined } as unknown as CommandHost;

  beforeEach(() => {
    doc = new PaintDocument({ width: 400, height: 300 });
    shapes = new VectorLayer('Shapes 1', 400, 300, [pathShape('s1', [sCurve]), pathShape('s2', [square, { closed: false, anchors: [corner(0, 0)] }, { closed: false, anchors: [corner(0, 0), corner(10, 0)] }])]);
    doc.layers.push(shapes);
    history = new History();
    notices = [];
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: (_kind, key) => notices.push(key),
      animationChanged: () => undefined,
    };
    anim = new AnimationController(host);
    anim.namer = (n, kind) => `${kind} ${n}`;
    // As the engine wires it: paths are noted after every change, and a change that deletes one keeps its followers' motion.
    history.on('change', () => anim.rememberPaths());
    history.amend = () => anim.bakeLostPaths();
    anim.rememberPaths();
  });

  const rocket = (): Piece => anim.add(img(40, 20), { x: 0, y: 0, w: 40, h: 20 }, doc.layers[0].id)!;
  const follow = (p: Piece) => anim.follow(p.id, { layerId: shapes.id, objectId: 's1', sub: 0 });
  const where = (id: string, frame: number) => {
    const s = sceneOf(doc, frame).stateAt(anim.piece(id)!, frame);
    return { x: s.x, y: s.y };
  };

  it('spreads a piece with one keyframe along the whole path, at an even speed', () => {
    const p = rocket();
    const last = doc.timeline.length - 1;
    expect(follow(p)).toBe(true);
    const q = anim.piece(p.id)!;
    expect(q.follow).toEqual({ layerId: shapes.id, objectId: 's1', sub: 0 });
    expect(q.keyframes.map((k) => [k.frame, k.progress])).toEqual([
      [0, 0],
      [last, 1],
    ]);
    q.keyframes = q.keyframes.map((k) => ({ ...k, easing: 'linear' }));
    const m = measurePath(sCurve)!;
    for (const f of [0, 5, 12, last]) {
      const at = m.at(f / last);
      expect(where(p.id, f).x).toBeCloseTo(at.x, 9);
      expect(where(p.id, f).y).toBeCloseTo(at.y, 9);
    }
    // The pose is placed there too (its pivot rides the path).
    const pl = anim.scene(12).placement(anim.piece(p.id)!);
    const pivot = anim.piece(p.id)!.pivot;
    const a = pl.affine!;
    expect(a[0] * pivot.x + a[2] * pivot.y + a[4]).toBeCloseTo(m.at(12 / last).x, 6);
    expect(a[1] * pivot.x + a[3] * pivot.y + a[5]).toBeCloseTo(m.at(12 / last).y, 6);
    // One undo step.
    history.undo();
    expect(anim.piece(p.id)!.follow).toBeNull();
    expect(anim.piece(p.id)!.keyframes).toHaveLength(1);
  });

  it('keeps progress keyed already, and keys it from the options bar in percent', () => {
    const p = rocket();
    anim.setKey(p.id, 0, { progress: 0.2 });
    expect(follow(p)).toBe(true);
    expect(anim.piece(p.id)!.keyframes.map((k) => k.progress)).toEqual([0.2]);
    anim.select(p.id);
    expect(anim.fields()).toMatchObject({ follow: { layerId: shapes.id, objectId: 's1', sub: 0 } });
    expect(anim.fields()!.progress).toBeCloseTo(20, 9);
    const m = measurePath(sCurve)!;
    expect(anim.fields()!.x).toBeCloseTo(m.at(0.2).x, 9);
    expect(anim.setFields({ progress: 250 })).toBe(true);
    expect(anim.piece(p.id)!.keyframes[0].progress).toBeCloseTo(2.5, 9);
    // An open path stops at its end.
    expect(where(p.id, 0).x).toBeCloseTo(380, 9);
    expect(anim.setFields({ progress: Number.NaN })).toBe(true);
    expect(anim.piece(p.id)!.keyframes[0].progress).toBe(0);
  });

  it('goes round a closed path more than once', () => {
    const p = rocket();
    anim.setKey(p.id, 10, {});
    expect(anim.follow(p.id, { layerId: shapes.id, objectId: 's2', sub: 0 })).toBe(true);
    anim.setKey(p.id, 10, { progress: 2.25, easing: 'linear' });
    anim.setKey(p.id, 0, { easing: 'linear' });
    expect(where(p.id, 10)).toEqual({ x: 200, y: 100 });
    // Half way it has gone round once and an eighth: on the top side again.
    expect(where(p.id, 5).y).toBeCloseTo(100, 9);
    expect(where(p.id, 5).x).toBeCloseTo(100 + 400 * 0.125, 6);
  });

  it('lists the paths there are to follow (outlines too short to follow are left out)', () => {
    expect(anim.pathChoices()).toEqual([
      { layerId: shapes.id, objectId: 's1', sub: 0, layerName: 'Shapes 1', shape: 1, part: null },
      { layerId: shapes.id, objectId: 's2', sub: 0, layerName: 'Shapes 1', shape: 2, part: 1 },
      { layerId: shapes.id, objectId: 's2', sub: 2, layerName: 'Shapes 1', shape: 2, part: 3 },
    ]);
  });

  it('says why not: a piece that follows another can’t follow a path, nor the other way round', () => {
    const a = rocket();
    const b = rocket();
    expect(anim.attach(b.id, a.id)).toBe(true);
    expect(follow(anim.piece(b.id)!)).toBe(false);
    expect(notices).toContain('notice.followLinked');
    const c = rocket();
    expect(follow(c)).toBe(true);
    expect(anim.attach(c.id, a.id)).toBe(false);
    expect(notices).toContain('notice.linkPath');
    expect(anim.follow(c.id, { layerId: shapes.id, objectId: 'gone', sub: 0 })).toBe(false);
    expect(notices).toContain('notice.followNoPath');
  });

  it('hinging onto a piece on a path makes the group carry it along the path', () => {
    const a = rocket();
    expect(follow(a)).toBe(true);
    const before = where(a.id, 7);
    const b = rocket();
    expect(anim.hinge(b.id, a.id, { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 }, 0)).toBe(true);
    const group = doc.pieces.find((p) => p.kind === 'group')!;
    expect(group.follow).toEqual({ layerId: shapes.id, objectId: 's1', sub: 0 });
    expect(anim.piece(a.id)!.follow).toBeNull();
    // The piece is where it was, now carried by the group.
    const pl = anim.scene(7).placement(anim.piece(a.id)!);
    const pivot = anim.piece(a.id)!.pivot;
    const m = pl.affine!;
    expect(m[0] * pivot.x + m[2] * pivot.y + m[4]).toBeCloseTo(before.x, 6);
    expect(m[1] * pivot.x + m[3] * pivot.y + m[5]).toBeCloseTo(before.y, 6);
  });

  it('is dragged along its path from where it was grabbed, and stepped along it with the arrow keys', () => {
    const m = measurePath(square)!;
    const s0 = { ...identityState(0, 0), progress: 2.125 };
    // Grabbed 5 px below (150, 100) on its third time round, and dragged down past the right side.
    expect(alongPath(m, s0, { x: 150, y: 105 }, { x: 205, y: 155 }, false)).toBeCloseTo(2.375, 9);
    expect(alongPath(m, s0, { x: 150, y: 105 }, { x: 205, y: 155 }, true)).toBeCloseTo(2.4, 9);
    const p = rocket();
    follow(p);
    anim.select(p.id);
    const ctx = { anim } as unknown as ToolContext;
    const key = (k: string, shiftKey = false) => selectionKeys(ctx, { key: k, shiftKey, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent);
    expect(key('ArrowRight')).toBe(true);
    expect(anim.piece(p.id)!.keyframes[0].progress).toBeCloseTo(0.01, 9);
    expect(key('ArrowUp', true)).toBe(true);
    expect(anim.piece(p.id)!.keyframes[0].progress).toBeCloseTo(0.11, 9);
    expect(key('ArrowLeft')).toBe(true);
    expect(anim.piece(p.id)!.keyframes[0].progress).toBeCloseTo(0.1, 9);
    // Its x and y are left alone (the path places it).
    expect(anim.piece(p.id)!.keyframes[0].x).toBe(20);
  });

  it('following nothing again keeps the motion as keyframes', () => {
    const p = rocket();
    follow(p);
    const last = doc.timeline.length - 1;
    const was = Array.from({ length: last + 1 }, (_, f) => where(p.id, f));
    expect(anim.follow(p.id, null)).toBe(true);
    const q = anim.piece(p.id)!;
    expect(q.follow).toBeNull();
    expect(q.keyframes).toHaveLength(last + 1);
    for (let f = 0; f <= last; f++) {
      const s = pieceStateAt(q, f);
      expect(s.x).toBeCloseTo(was[f].x, 9);
      expect(s.y).toBeCloseTo(was[f].y, 9);
    }
  });

  it('keeps its motion when the path is deleted, in the same undo step', () => {
    const p = rocket();
    follow(p);
    const was = where(p.id, 9);
    const steps = history.length;
    // Delete the curve (as the shape tools do: one step on the shape layer).
    const before = shapes.objects;
    shapes.setObjects(before.filter((o) => o.id !== 's1'));
    history.push(new VectorEditCommand('history.deleteShapes', vectorHost, shapes, before, shapes.objects));
    expect(history.length).toBe(steps + 1);
    const q = anim.piece(p.id)!;
    expect(q.follow).toBeNull();
    expect(pieceStateAt(q, 9).x).toBeCloseTo(was.x, 9);
    expect(pieceStateAt(q, 9).y).toBeCloseTo(was.y, 9);
    // Undo brings back the path and the link to it.
    history.undo();
    expect(shapes.objects.map((o) => o.id)).toEqual(['s1', 's2']);
    expect(anim.piece(p.id)!.follow).toEqual({ layerId: shapes.id, objectId: 's1', sub: 0 });
    expect(anim.piece(p.id)!.keyframes).toHaveLength(2);
    history.redo();
    expect(anim.piece(p.id)!.follow).toBeNull();
    expect(pieceStateAt(anim.piece(p.id)!, 9).x).toBeCloseTo(was.x, 9);
  });

  it('follows a path edited since (the link is to the shape, not a copy of it)', () => {
    const p = rocket();
    follow(p);
    const moved = pathShape('s1', [{ closed: false, anchors: [corner(0, 0), corner(100, 0)] }]);
    const before = shapes.objects;
    shapes.setObjects([moved, before[1]]);
    history.push(new VectorEditCommand('history.moveShapes', vectorHost, shapes, before, shapes.objects));
    expect(anim.piece(p.id)!.follow).not.toBeNull();
    const last = doc.timeline.length - 1;
    expect(where(p.id, last)).toEqual({ x: 100, y: 0 });
  });

  it('bakes one keyframe a frame, spread out when there would be too many', () => {
    const m: PathMeasure = fromPolyline([0, 1000], [0, 0], false);
    const p = rocket();
    const long = { ...anim.piece(p.id)!, keyframes: setKey(setKey(anim.piece(p.id)!.keyframes, 0, { progress: 0 }), 5000, { progress: 1, easing: 'linear' }) };
    const keys = bakeFollow(long, m);
    expect(keys.length).toBeLessThanOrEqual(2000);
    expect(keys[0].frame).toBe(0);
    expect(keys[keys.length - 1].frame).toBe(5000);
    expect(keys[keys.length - 1].x).toBeCloseTo(1000, 9);
  });

  it('saves and reopens the link and the progress (version 4, only when used)', async () => {
    const p = rocket();
    expect(versionFor(doc)).toBeLessThan(4);
    follow(p);
    expect(versionFor(doc)).toBe(4);
    const bytes = await saveProject(doc, rawCodec);
    const json = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { version: number };
    expect(json.version).toBe(4);
    const back = await loadProject(bytes, rawCodec);
    const q = back.pieces[0];
    expect(q.follow).toEqual({ layerId: shapes.id, objectId: 's1', sub: 0 });
    expect(q.keyframes.map((k) => k.progress)).toEqual([0, 1]);
    expect(docPaths(back)(q.follow!)).not.toBeNull();
    const at = sceneOf(back, 12).stateAt(q, 12);
    expect(at.x).toBeCloseTo(where(p.id, 12).x, 9);
    // Not following any more: an older version again.
    anim.follow(p.id, null);
    expect(versionFor(doc)).toBeLessThan(4);
  });
});
