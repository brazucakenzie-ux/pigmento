import { describe, expect, it } from 'vitest';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { sceneOf } from '@engine/anim/follow';
import { loopFrame, makePiece, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { applyPreset, makeTrail } from '@engine/anim/trail';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { corner } from '@engine/vector/pathData';

const keys = (...frames: number[]) => frames.map((frame) => ({ frame }));
const img = { w: 10, h: 10, data: new Uint8ClampedArray(400) };

/** A sign swinging from -20° (frame 0) to 20° (frame 10), moving right and tilting as it goes. */
function sign(): Piece {
  const p = makePiece('s', '', 'L', img, { x: 0, y: 0, w: 10, h: 10 }, 0);
  p.keyframes = setKey(setKey(p.keyframes, 0, { x: 0, angle: -0.35, tilt: 0, scrollX: 0, fold: 0, easing: 'linear' }), 10, { x: 100, angle: 0.35, tilt: 0.5, scrollX: 40, fold: 1 });
  return p;
}

describe('looping keyframes', () => {
  it('map frames after the last keyframe back into the moves, again or back and forth', () => {
    const k = keys(4, 10);
    expect([10, 11, 15, 16, 17].map((f) => loopFrame(k, 'loop', f))).toEqual([10, 5, 9, 4, 5]);
    expect([10, 11, 15, 16, 17, 22, 23].map((f) => loopFrame(k, 'pingpong', f))).toEqual([10, 9, 5, 4, 5, 10, 9]);
    // Before the first it holds; off, one key, or no span: as it is.
    expect(loopFrame(k, 'loop', 1)).toBe(1);
    expect(loopFrame(k, 'off', 30)).toBe(30);
    expect(loopFrame(keys(5), 'loop', 30)).toBe(30);
  });

  it('repeat every value: position, spin, 3D, scroll and fold', () => {
    const p = sign();
    p.loop = 'loop';
    for (const f of [3, 7]) expect(pieceStateAt(p, f + 10)).toEqual(pieceStateAt(p, f));
    p.loop = 'pingpong';
    expect(pieceStateAt(p, 13)).toEqual(pieceStateAt(p, 7));
    expect(pieceStateAt(p, 20)).toEqual(pieceStateAt(p, 0));
    p.loop = 'off';
    expect(pieceStateAt(p, 13)).toEqual(pieceStateAt(p, 10));
  });

  it('start a key added on a repeat from what shows there', () => {
    const p = sign();
    const added = setKey(p.keyframes, 15, { opacity: 0.5 }, 'pingpong');
    const k = added.find((q) => q.frame === 15)!;
    expect(k.angle).toBeCloseTo(pieceStateAt({ ...p, loop: 'pingpong' }, 15).angle, 12);
    expect(k.opacity).toBe(0.5);
  });

  it('carry progress along a path, and a trail’s emission, round too', () => {
    const doc = new PaintDocument({ width: 200, height: 100 });
    const style: ShapeStyle = { mode: 'outline', width: 2, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 0, g: 0, b: 0, a: 0 }, radius: 0, antialias: true };
    const shapes = new VectorLayer('S', 200, 100, [{ type: 'shape', id: 'line', shape: 'path', box: null, points: [], style, subpaths: [{ closed: false, anchors: [corner(0, 50), corner(200, 50)] }] }]);
    doc.layers.push(shapes);
    const p = makePiece('p', '', doc.layers[0].id, img, { x: 0, y: 0, w: 10, h: 10 }, 0);
    p.keyframes = setKey(setKey(p.keyframes, 0, { progress: 0, easing: 'linear' }), 10, { progress: 1 });
    p.follow = { layerId: shapes.id, objectId: 'line', sub: 0 };
    p.loop = 'loop';
    doc.pieces = [p];
    expect(sceneOf(doc, 13).stateAt(p, 13).x).toBeCloseTo(60, 9);
    // Smoke lit at frame 5 lights again at frame 15 (and is off at 12).
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history: new History(),
      commitLive: () => undefined,
      notify: () => undefined,
      animationChanged: () => undefined,
    };
    const anim = new AnimationController(host);
    p.trails = [{ ...applyPreset(makeTrail('t', 'puffs', { x: 5, y: 5 }, 1), 'rocketSmoke'), keys: [{ frame: 0, amount: 0, easing: 'hold' }, { frame: 5, amount: 1, easing: 'hold' }] }];
    anim.select('p');
    anim.setFrame(12);
    expect(anim.fields()!.trails[0].emission).toBe(0);
    anim.setFrame(15);
    expect(anim.fields()!.trails[0].emission).toBe(1);
  });

  it('are set as one undo step, and show in the timeline’s info', () => {
    const doc = new PaintDocument({ width: 100, height: 100 });
    const history = new History();
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: () => undefined,
      animationChanged: () => undefined,
    };
    const anim = new AnimationController(host);
    const p = anim.add(img, { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    expect(anim.setPieceLoop(p.id, 'pingpong')).toBe(true);
    expect(anim.setPieceLoop(p.id, 'pingpong')).toBe(false);
    expect(anim.info().pieces[0].loop).toBe('pingpong');
    anim.select(p.id);
    expect(anim.fields()!.loop).toBe('pingpong');
    history.undo();
    expect(anim.piece(p.id)!.loop).toBe('off');
  });
});
