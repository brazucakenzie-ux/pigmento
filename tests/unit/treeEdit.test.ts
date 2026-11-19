import { describe, expect, it, beforeEach } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { makePiece, setKey } from '@engine/anim/piece';
import { Scene } from '@engine/anim/scene';
import { slideOnParent } from '@engine/tools/treeEdit';
import { project } from '@engine/anim/space';
import { VectorLayer } from '@engine/doc/Document';

describe('editing linked pieces', () => {
  it('slides a follower on the plane of the piece it follows', () => {
    const img = { w: 10, h: 10, data: new Uint8ClampedArray(400).fill(255) };
    const a = makePiece('a', '', 'L', img, { x: 100, y: 100, w: 10, h: 10 }, 0);
    a.keyframes = setKey(a.keyframes, 0, { angle: Math.PI / 2, sx: 2, sy: 2 });
    const b = makePiece('b', '', 'L', img, { x: 0, y: 0, w: 10, h: 10 }, 0);
    b.link = { parent: 'a', hinge: null };
    b.keyframes = setKey(b.keyframes, 0, { x: 5, y: 5 });
    const scene = new Scene([a, b], 0);
    const s0 = b.keyframes[0];
    // Turned a quarter and doubled, 20 canvas px right is 10 of the parent's own pixels up its y axis… backwards.
    const change = slideOnParent(scene, b, s0, { x: 0, y: 0 }, { x: 20, y: 0 }, false)!;
    expect(change.x).toBeCloseTo(5, 9);
    expect(change.y).toBeCloseTo(-5, 9);
    const moved = { ...b, keyframes: setKey(b.keyframes, 0, change) };
    const before = project(scene.placement(b), b.pivot)!;
    const after = project(new Scene([a, moved], 0).placement(moved), moved.pivot)!;
    expect(after.x - before.x).toBeCloseTo(20, 9);
    expect(after.y - before.y).toBeCloseTo(0, 9);
    // Shift keeps it to one of the parent's axes.
    expect(slideOnParent(scene, b, s0, { x: 0, y: 0 }, { x: 20, y: 3 }, true)!.x).toBeCloseTo(5, 9);
    expect(slideOnParent(scene, a, a.keyframes[0], { x: 0, y: 0 }, { x: 1, y: 1 }, false)).toBeNull();
  });
});

describe('the box maker', () => {
  let doc: PaintDocument;
  let history: History;
  let notices: string[];
  let anim: AnimationController;
  beforeEach(() => {
    doc = new PaintDocument({ width: 600, height: 400 });
    history = new History();
    notices = [];
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: (_k, key) => notices.push(key),
      animationChanged: () => undefined,
    };
    anim = new AnimationController(host);
    anim.namer = (n, kind) => `${kind} ${n}`;
    anim.faceNamer = (f) => f.toUpperCase();
  });

  it('makes a named, turned box in the middle of the picture as one undo step, its front selected', () => {
    expect(anim.makeBox({ w: 120, h: 90, d: 60 })).toBe(true);
    expect(doc.pieces).toHaveLength(7);
    expect(doc.pieces.map((p) => p.name)).toEqual(['group 1', 'FRONT', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'BACK']);
    expect(anim.selected?.name).toBe('FRONT');
    expect(anim.fields()).toMatchObject({ inGroup: true, link: 'follows' });
    // Its middle is the picture's middle, and it's turned so its sides show.
    const g = doc.pieces[0];
    expect(g.keyframes[0]).toMatchObject({ x: 300, y: 200 });
    expect(g.keyframes[0].turn).toBeLessThan(0);
    expect(new Scene(doc.pieces, 0, doc.space).placement(doc.pieces.find((p) => p.name === 'RIGHT')!).front).toBe(true);
    history.undo();
    expect(doc.pieces).toHaveLength(0);
  });

  it('refuses a layer without pixels, and clamps its sides', () => {
    const shapes = new VectorLayer('Shapes', 600, 400);
    doc.layers.push(shapes);
    doc.activeId = shapes.id;
    expect(anim.makeBox({ w: 50, h: 50, d: 50 })).toBe(false);
    expect(notices).toContain('notice.animatePixelsOnly');
    doc.activeId = doc.layers[0].id;
    expect(anim.makeBox({ w: 0, h: 1e9, d: Number.NaN })).toBe(true);
    const front = doc.pieces.find((p) => p.name === 'FRONT')!;
    expect(front.src.width).toBe(1);
    expect(front.src.height).toBe(4096);
  });
});
