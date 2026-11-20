import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { artDirection, faceSpan, heading } from '@engine/anim/face';
import { sceneOf } from '@engine/anim/follow';
import { makePiece, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { transformPieces } from '@engine/anim/pieceTransform';
import { Scene, type Motion } from '@engine/anim/scene';
import { loadProject, saveProject, versionFor, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import type { Mat } from '@engine/core/matrix';
import type { ImageBuf } from '@engine/raster/transform';
import { keyedAngle } from '@engine/tools/treeEdit';
import { corner } from '@engine/vector/pathData';

const img = (w: number, h: number): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const DEG = Math.PI / 180;
const motion: Motion = { paths: null, fps: 12 };

/** Angles equal up to whole turns. */
function expectAngle(a: number, b: number, digits = 6): void {
  const d = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  expect(d).toBeCloseTo(0, digits);
}

/** A piece at (x, y) on each of `keys` frames, eased evenly. */
function mover(keys: [number, number, number][], face = { on: true, angle: 0 }): Piece {
  const p = makePiece('p', '', 'L', img(40, 20), { x: 0, y: 0, w: 40, h: 20 }, keys[0][0]);
  for (const [frame, x, y] of keys) p.keyframes = setKey(p.keyframes, frame, { x, y, easing: 'linear' });
  p.face = face;
  return p;
}

/** Which way the piece's art points on the canvas at `frame` (its art direction, through its placement). */
function pointing(scene: Scene, p: Piece): number {
  const a = scene.placement(p).affine!;
  const v = { x: Math.cos(p.face.angle), y: Math.sin(p.face.angle) };
  return Math.atan2(a[1] * v.x + a[3] * v.y, a[0] * v.x + a[2] * v.y);
}

describe('heading', () => {
  it('is the way it moves, taken over a fifth of a second either side', () => {
    expect(faceSpan(12)).toBeCloseTo(2.4, 9);
    expect(faceSpan(1)).toBe(0.5);
    expect(faceSpan(Number.NaN)).toBeCloseTo(2.4, 9);
    const pos = (t: number) => ({ x: t * 10, y: t * 5 });
    expect(heading(pos, 5, 0, 10, 2)).toBeCloseTo(Math.atan2(5, 10), 9);
  });

  it('turns smoothly through a sharp corner instead of flicking round', () => {
    const p = mover([
      [0, 0, 0],
      [12, 120, 0],
      [24, 120, 120],
    ]);
    const at = (f: number) => new Scene([p], f, undefined, motion).headingOf(p, f)!;
    expect(at(9)).toBeCloseTo(0, 9);
    expect(at(12)).toBeCloseTo(Math.PI / 4, 9);
    expect(at(15)).toBeCloseTo(Math.PI / 2, 9);
    // On the way round, steadily.
    const turns = [10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14].map(at);
    for (let i = 1; i < turns.length; i++) expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    for (let i = 1; i < turns.length; i++) expect(turns[i] - turns[i - 1]).toBeLessThan(0.25);
  });

  it('keeps the way it was going while it stops, and before it starts faces the way it will go', () => {
    const p = mover([
      [4, 0, 0],
      [10, 100, 0],
      [20, 100, 0],
      [30, 100, 100],
    ]);
    const at = (f: number) => new Scene([p], f, undefined, motion).headingOf(p, f);
    expect(at(0)).toBeCloseTo(0, 9);
    expect(at(15)).toBeCloseTo(0, 9);
    expect(at(25)).toBeCloseTo(Math.PI / 2, 9);
    expect(at(60)).toBeCloseTo(Math.PI / 2, 9);
    // Something that never moves has no heading, and isn't turned.
    const still = mover([[0, 50, 50]]);
    expect(new Scene([still], 3, undefined, motion).headingOf(still, 3)).toBeNull();
    expect(new Scene([still], 3, undefined, motion).stateAt(still, 3).angle).toBe(0);
  });

  it('only for pieces that face their way and follow no other piece', () => {
    const p = mover(
      [
        [0, 0, 0],
        [10, 100, 0],
      ],
      { on: false, angle: 0 },
    );
    expect(new Scene([p], 5, undefined, motion).headingOf(p, 5)).toBeNull();
    p.face = { on: true, angle: 0 };
    p.link = { parent: 'x', hinge: null };
    expect(new Scene([p], 5, undefined, motion).headingOf(p, 5)).toBeNull();
  });
});

describe('facing the way it goes', () => {
  const path: [number, number, number][] = [
    [0, 0, 0],
    [10, 100, 0],
    [20, 100, 100],
    [30, 0, 100],
  ];

  it('points the art where the piece is heading, the keyed angle on top', () => {
    // Drawn pointing up.
    const p = mover(path, { on: true, angle: -90 * DEG });
    for (const [f, way] of [
      [5, 0],
      [15, 90 * DEG],
      [25, 180 * DEG],
    ]) {
      const scene = new Scene([p], f, undefined, motion);
      expectAngle(pointing(scene, p), way);
      expectAngle(scene.stateAt(p, f).angle, way + 90 * DEG);
    }
    p.keyframes = p.keyframes.map((k) => ({ ...k, angle: 20 * DEG }));
    expectAngle(pointing(new Scene([p], 5, undefined, motion), p), 20 * DEG);
  });

  it('a flipped piece still points its art the way it goes', () => {
    for (const [sx, sy] of [
      [-1, 1],
      [1, -1],
      [-2, -0.5],
    ]) {
      const p = mover(path, { on: true, angle: 30 * DEG });
      p.keyframes = p.keyframes.map((k) => ({ ...k, sx, sy }));
      expectAngle(pointing(new Scene([p], 15, undefined, motion), p), 90 * DEG);
    }
    expect(artDirection(0, -1, 1)).toBeCloseTo(Math.PI, 9);
    expect(artDirection(Math.PI / 2, 1, -1)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it.each([1, -1.2])('flipping or turning the picture keeps it pointing its way (scale %d)', (sx) => {
    const p = mover(path, { on: true, angle: -90 * DEG });
    p.keyframes = p.keyframes.map((k, i) => ({ ...k, angle: i * 7 * DEG, sx }));
    const W = 400;
    const H = 300;
    const ms: Mat[] = [
      [-1, 0, 0, 1, W, 0],
      [1, 0, 0, -1, 0, H],
      [0, 1, -1, 0, H, 0],
      [Math.cos(0.3), Math.sin(0.3), -Math.sin(0.3), Math.cos(0.3), 10, -20],
      [0, -1, -1, 0, H, W],
    ];
    for (const m of ms) {
      const [q] = transformPieces([p], m);
      for (const f of [3, 12, 17, 26]) {
        const a = new Scene([p], f, undefined, motion).placement(p).affine!;
        const b = new Scene([q], f, undefined, motion).placement(q).affine!;
        // The new placement is the old one carried by m.
        const want = [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3]];
        for (let i = 0; i < 4; i++) expect(b[i]).toBeCloseTo(want[i], 6);
      }
    }
  });

  it('on a path, points along it, and turns round when it goes back', () => {
    const doc = new PaintDocument({ width: 400, height: 300 });
    const style: ShapeStyle = { mode: 'outline', width: 2, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 0, g: 0, b: 0, a: 0 }, radius: 0, antialias: true };
    const square = { closed: true, anchors: [corner(100, 100), corner(200, 100), corner(200, 200), corner(100, 200)] };
    const shapes = new VectorLayer('S', 400, 300, [{ type: 'shape', id: 's', shape: 'path', box: null, points: [], style, subpaths: [square] }]);
    doc.layers.push(shapes);
    const p = makePiece('p', '', doc.layers[0].id, img(40, 20), { x: 0, y: 0, w: 40, h: 20 }, 0);
    p.keyframes = setKey(setKey(p.keyframes, 0, { progress: 0, easing: 'linear' }), 20, { progress: 1, easing: 'linear' });
    p.keyframes = setKey(p.keyframes, 40, { progress: 0 });
    p.follow = { layerId: shapes.id, objectId: 's', sub: 0 };
    p.face = { on: true, angle: 0 };
    doc.pieces = [p];
    // Half way along the top, the right side and the bottom.
    expectAngle(pointing(sceneOf(doc, 2.5), p), 0);
    expectAngle(pointing(sceneOf(doc, 7.5), p), 90 * DEG);
    expectAngle(pointing(sceneOf(doc, 12.5), p), 180 * DEG);
    // Back the other way round: the right side, upwards.
    expectAngle(pointing(sceneOf(doc, 32.5), p), -90 * DEG);
  });
});

describe('facing in the controller, the tools and projects', () => {
  let doc: PaintDocument;
  let history: History;
  let notices: string[];
  let anim: AnimationController;

  beforeEach(() => {
    doc = new PaintDocument({ width: 400, height: 300 });
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
  });

  const rocket = (): Piece => {
    const p = anim.add(img(40, 20), { x: 0, y: 0, w: 40, h: 20 }, doc.layers[0].id)!;
    anim.setKey(p.id, 10, { x: 120, y: 10 });
    anim.setKey(p.id, 20, { x: 120, y: 110 });
    return anim.piece(p.id)!;
  };

  it('turns facing on and off, and sets the art’s angle, as undoable steps', () => {
    const p = rocket();
    anim.select(p.id);
    expect(anim.fields()).toMatchObject({ face: false, faceAngle: 0 });
    expect(anim.setFace(p.id, { on: true })).toBe(true);
    expect(anim.setFace(p.id, { on: true })).toBe(false);
    expect(anim.setFace(p.id, { angle: 270 * DEG })).toBe(true);
    // Kept between −180° and 180°.
    expect(anim.fields()!.faceAngle).toBeCloseTo(-90, 9);
    expect(anim.fields()!.face).toBe(true);
    // The angle shown is the keyed one; the turn to face its way is on top.
    expect(anim.fields()!.angle).toBeCloseTo(0, 9);
    expectAngle(anim.scene(15).stateAt(anim.piece(p.id)!, 15).angle, 180 * DEG);
    history.undo();
    history.undo();
    expect(anim.piece(p.id)!.face).toEqual({ on: false, angle: 0 });
  });

  it('a piece that follows another can’t face its way, nor can a facing piece be linked', () => {
    const a = rocket();
    const b = rocket();
    expect(anim.attach(b.id, a.id)).toBe(true);
    expect(anim.setFace(b.id, { on: true })).toBe(false);
    expect(notices).toContain('notice.faceLinked');
    const c = rocket();
    anim.setFace(c.id, { on: true });
    expect(anim.attach(c.id, a.id)).toBe(false);
    expect(notices).toContain('notice.linkFace');
  });

  it('hinging onto a facing piece makes the group face the way instead, the piece staying put', () => {
    const a = rocket();
    anim.setFace(a.id, { on: true, angle: 0.4 });
    const was = [3, 10, 16].map((f) => anim.scene(f).placement(anim.piece(a.id)!).affine!);
    const b = rocket();
    expect(anim.hinge(b.id, a.id, { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 }, 0)).toBe(true);
    const group = doc.pieces.find((p) => p.kind === 'group')!;
    expect(group.face).toEqual({ on: true, angle: 0.4 });
    expect(anim.piece(a.id)!.face.on).toBe(false);
    [3, 10, 16].forEach((f, i) => {
      const now = anim.scene(f).placement(anim.piece(a.id)!).affine!;
      for (let j = 0; j < 6; j++) expect(now[j]).toBeCloseTo(was[i][j], 6);
    });
  });

  it('tools key the angle without the turn to face its way', () => {
    const p = rocket();
    anim.setFace(p.id, { on: true, angle: 0.25 });
    anim.setKey(p.id, 10, { angle: 0.6, sx: -1.5 });
    const q = anim.piece(p.id)!;
    const scene = anim.scene(10);
    const shown = scene.stateAt(q, 10);
    const h = scene.headingOf(q, 10);
    expect(h).not.toBeNull();
    expect(keyedAngle(q, shown, h)).toBeCloseTo(0.6, 9);
    expect(keyedAngle(q, { ...shown, angle: shown.angle + 0.1 }, h)).toBeCloseTo(0.7, 9);
    expect(keyedAngle(q, shown, null)).toBe(shown.angle);
  });

  it('saves and reopens facing (version 4, only when used)', async () => {
    const codec: PngCodec = {
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
    const p = rocket();
    expect(versionFor(doc)).toBeLessThan(4);
    anim.setFace(p.id, { on: true, angle: -1 });
    expect(versionFor(doc)).toBe(4);
    const bytes = await saveProject(doc, codec);
    expect((JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { version: number }).version).toBe(4);
    const back = await loadProject(bytes, codec);
    expect(back.pieces[0].face).toEqual({ on: true, angle: -1 });
    expectAngle(sceneOf(back, 15).stateAt(back.pieces[0], 15).angle, sceneOf(doc, 15).stateAt(anim.piece(p.id)!, 15).angle);
    expect(pieceStateAt(back.pieces[0], 15).angle).toBe(0);
  });
});
