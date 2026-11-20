import { beforeEach, describe, expect, it } from 'vitest';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { motionToPath, sceneOf } from '@engine/anim/follow';
import { makePiece, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import type { Point } from '@engine/core/geometry';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import type { ImageBuf } from '@engine/raster/transform';

const img = (w: number, h: number): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const style: ShapeStyle = { mode: 'outline', width: 2, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 0, g: 0, b: 0, a: 0 }, radius: 0, antialias: true };

type Key = { frame: number; x: number; y: number; in?: Point; out?: Point };

/** A piece moved through `keys` (with bends where given), eased evenly unless it says otherwise. */
function mover(keys: Key[], easing: 'linear' | 'easeInOut' = 'linear'): Piece {
  const p = makePiece('p', '', 'L', img(20, 20), { x: 0, y: 0, w: 20, h: 20 }, keys[0].frame);
  for (const k of keys) p.keyframes = setKey(p.keyframes, k.frame, { x: k.x, y: k.y, easing, in: k.in ?? null, out: k.out ?? null });
  return p;
}

describe('a motion path as a path', () => {
  it('puts an anchor at each keyframe, and each keyframe its share of the way along', () => {
    const made = motionToPath(
      mover([
        { frame: 0, x: 0, y: 0 },
        { frame: 10, x: 100, y: 0 },
        { frame: 30, x: 100, y: 300 },
      ]),
    )!;
    expect(made.sub.closed).toBe(false);
    expect(made.sub.anchors.map((a) => [a.x, a.y, a.in, a.out])).toEqual([
      [0, 0, null, null],
      [100, 0, null, null],
      [100, 300, null, null],
    ]);
    expect(made.progress).toEqual([0, 0.25, 1]);
  });

  it('keeps the bends as handles, so following it moves the piece just as before', () => {
    const p = mover(
      [
        { frame: 0, x: 50, y: 200, out: { x: 60, y: -150 } },
        { frame: 12, x: 200, y: 150, in: { x: -60, y: 80 }, out: { x: 60, y: -80 } },
        { frame: 24, x: 350, y: 200, in: { x: -40, y: -120 } },
      ],
      'easeInOut',
    );
    const made = motionToPath(p)!;
    const [a, b, c] = made.sub.anchors;
    expect(a.in).toBeNull();
    expect(a.out).toEqual({ x: 110, y: 50 });
    expect(b).toMatchObject({ in: { x: 140, y: 230 }, out: { x: 260, y: 70 }, smooth: true });
    expect(c.out).toBeNull();
    // The same motion, frame by frame (the path is walked as finely as a motion path is).
    const doc = new PaintDocument({ width: 400, height: 300 });
    const shapes = new VectorLayer('S', 400, 300, [{ type: 'shape', id: 's', shape: 'path', box: null, points: [], style, subpaths: [made.sub] }]);
    doc.layers.push(shapes);
    const q: Piece = { ...p, layerId: doc.layers[0].id, follow: { layerId: shapes.id, objectId: 's', sub: 0 }, keyframes: p.keyframes.map((k, i) => ({ ...k, progress: made.progress[i], in: null, out: null })) };
    doc.pieces = [q];
    for (let f = 0; f <= 24; f += 0.5) {
      const was = pieceStateAt(p, f);
      const now = sceneOf(doc, f).stateAt(q, f);
      expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeLessThan(0.5);
    }
  });

  it('makes one anchor where the piece stays put, so it waits there', () => {
    const made = motionToPath(
      mover([
        { frame: 0, x: 0, y: 0 },
        { frame: 10, x: 100, y: 0 },
        { frame: 15, x: 100, y: 0 },
        { frame: 25, x: 200, y: 0 },
      ]),
    )!;
    expect(made.sub.anchors).toHaveLength(3);
    expect(made.progress).toEqual([0, 0.5, 0.5, 1]);
  });

  it('closes a path that ends where it started', () => {
    const made = motionToPath(
      mover([
        { frame: 0, x: 0, y: 0 },
        { frame: 10, x: 100, y: 0 },
        { frame: 20, x: 100, y: 100, out: { x: -20, y: 30 } },
        { frame: 30, x: 0, y: 0, in: { x: 10, y: 40 } },
      ]),
    )!;
    expect(made.sub.closed).toBe(true);
    expect(made.sub.anchors).toHaveLength(3);
    // The start takes the bend coming back to it.
    expect(made.sub.anchors[0].in).toEqual({ x: 10, y: 40 });
    expect(made.progress[0]).toBe(0);
    expect(made.progress[3]).toBe(1);
    expect(made.progress[1]).toBeGreaterThan(0);
    expect(made.progress[2]).toBeGreaterThan(made.progress[1]);
    expect(made.progress[2]).toBeLessThan(1);
  });

  it('has nothing to give for a piece that doesn’t move', () => {
    expect(motionToPath(mover([{ frame: 0, x: 5, y: 5 }]))).toBeNull();
    expect(
      motionToPath(
        mover([
          { frame: 0, x: 5, y: 5 },
          { frame: 9, x: 5, y: 5 },
        ]),
      ),
    ).toBeNull();
  });
});

describe('following a path made from the motion path', () => {
  let doc: PaintDocument;
  let history: History;
  let anim: AnimationController;

  beforeEach(() => {
    doc = new PaintDocument({ width: 400, height: 300 });
    history = new History();
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: () => undefined,
      animationChanged: () => undefined,
    };
    anim = new AnimationController(host);
  });

  it('takes the progress for each keyframe and drops the bends (the path has them now), in one undo step', () => {
    const p = anim.add(img(20, 20), { x: 0, y: 0, w: 20, h: 20 }, doc.layers[0].id)!;
    anim.setKey(p.id, 10, { x: 200, y: 10, out: { x: 5, y: 5 } });
    anim.setKey(p.id, 20, { x: 200, y: 200 });
    const made = motionToPath(anim.piece(p.id)!)!;
    const shapes = new VectorLayer('S', 400, 300, [{ type: 'shape', id: 's', shape: 'path', box: null, points: [], style, subpaths: [made.sub] }]);
    doc.layers.push(shapes);
    const steps = history.length;
    expect(anim.followWith(p.id, { layerId: shapes.id, objectId: 's', sub: 0 }, made.progress)).toBe(true);
    expect(history.length).toBe(steps + 1);
    const q = anim.piece(p.id)!;
    expect(q.follow).toEqual({ layerId: shapes.id, objectId: 's', sub: 0 });
    expect(q.keyframes.map((k) => k.progress)).toEqual(made.progress);
    expect(q.keyframes.every((k) => k.in === null && k.out === null)).toBe(true);
    // Refused when the numbers don't match its keyframes.
    expect(anim.followWith(p.id, { layerId: shapes.id, objectId: 's', sub: 0 }, [0, 1])).toBe(false);
    history.undo();
    expect(anim.piece(p.id)!.follow).toBeNull();
    expect(anim.piece(p.id)!.keyframes[1].out).toEqual({ x: 5, y: 5 });
  });
});
