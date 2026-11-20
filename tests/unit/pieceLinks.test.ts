import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import {
  frameApply,
  frameChain,
  frameInvert,
  hingeFrame,
  localFrame,
  localParts,
  placementFromFrame,
  rootFrame,
  rootParts,
  type Hinge,
} from '@engine/anim/frames';
import { identityState, type PieceState } from '@engine/anim/interpolate';
import {
  attach,
  checkLinks,
  detach,
  duplicateTree,
  hinge,
  moveTree,
  removeTree,
  subtree,
  treeOf,
} from '@engine/anim/links';
import { copyPieces, makeGroup, makePiece, setKey, type Piece } from '@engine/anim/piece';
import { MAX_TREE, Scene } from '@engine/anim/scene';
import { placementOf, project, spaceOf, type Space } from '@engine/anim/space';
import { transformPieces } from '@engine/anim/pieceTransform';
import { loadProject, saveProject, versionFor, type PngCodec } from '@engine/io/project';
import { Surface } from '@engine/raster/Surface';
import type { ImageBuf } from '@engine/raster/transform';

const img = (w: number, h: number): ImageBuf => ({
  w,
  h,
  data: new Uint8ClampedArray(w * h * 4).fill(255),
});
const space: Space = spaceOf({ x: 200, y: 150, strength: 60 }, 400, 300);
const DEG = Math.PI / 180;

const state = (s: Partial<PieceState>): PieceState => ({ ...identityState(0, 0), ...s });

function expectNear(a: readonly number[], b: readonly number[], digits = 6): void {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
}

/** Where piece point q shows on the canvas as `scene` has it. */
function shown(scene: Scene, p: Piece, q: { x: number; y: number }): { x: number; y: number } {
  return project(scene.placement(p), q)!;
}

const plain: Hinge = { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 };

describe('frames', () => {
  const states: PieceState[] = [
    state({ x: 120, y: 80 }),
    state({ x: 120, y: 80, sx: 1.5, sy: 0.75, angle: 0.4, skew: 0.2, depth: 90 }),
    state({ x: 220, y: 60, tilt: 0.5, turn: -0.7, angle: 1.1, depth: 40 }),
    state({ x: 50, y: 200, sx: -1, sy: 2, tilt: -1.2, turn: 2.6, depth: -60 }),
  ];
  const pivot = { x: 30, y: 20 };

  it('place a free piece just as its state does', () => {
    for (const s of states) {
      const a = placementOf(s, pivot, 60, 40, space);
      const b = placementFromFrame(rootFrame(s, pivot, space), 60, 40, space);
      expect(b.front).toBe(a.front);
      expect(b.affine === null).toBe(a.affine === null);
      for (const q of [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 40 },
        { x: 13, y: 27 },
      ]) {
        const pa = project(a, q)!;
        const pb = project(b, q)!;
        expect(pb.x).toBeCloseTo(pa.x, 6);
        expect(pb.y).toBeCloseTo(pa.y, 6);
      }
    }
  });

  it('undo and compose', () => {
    const A = rootFrame(states[2], pivot, space);
    const B = localFrame(states[1], pivot);
    const back = frameChain(frameInvert(A)!, frameChain(A, B));
    expectNear(back, B, 6);
    expectNear(frameApply(frameChain(A, B), 3, 4, 5), frameApply(A, ...frameApply(B, 3, 4, 5)));
  });

  it('give back the state they came from', () => {
    for (const s of states) {
      const local = localParts(localFrame(s, pivot), pivot, s);
      expectNear(localFrame({ ...s, ...local }, pivot), localFrame(s, pivot), 6);
      const root = rootParts(rootFrame(s, pivot, space), pivot, space, s);
      expectNear(rootFrame({ ...s, ...root }, pivot, space), rootFrame(s, pivot, space), 6);
    }
  });

  it('lay a hinged piece flat beside its parent, its edge on the parent’s edge', () => {
    // A 60-wide piece on the right edge of a 100 × 60 one.
    const H = hingeFrame(100, 60, 60, 60, plain, 0);
    expectNear(frameApply(H, 0, 0), [100, 0, 0]);
    expectNear(frameApply(H, 0, 60), [100, 60, 0]);
    expectNear(frameApply(H, 60, 30), [160, 30, 0]);
    // Offset along the edge, and scaled.
    const S = hingeFrame(100, 60, 30, 30, { ...plain, offset: 10, along: 2, across: 3 }, 0);
    expectNear(frameApply(S, 0, 0), [100, 10, 0]);
    expectNear(frameApply(S, 0, 30), [100, 70, 0]);
    expectNear(frameApply(S, 30, 0), [190, 10, 0]);
  });

  it('fold a hinged piece back round the edge, its front facing out', () => {
    const H = hingeFrame(100, 60, 60, 60, plain, 90 * DEG);
    expectNear(frameApply(H, 0, 0), [100, 0, 0]);
    expectNear(frameApply(H, 60, 30), [100, 30, 60]);
    // Seen from the right, past the box's side, that side's front shows; from the left, its back.
    const fromRight = spaceOf({ x: 900, y: 30, strength: 60 }, 400, 300);
    const fromLeft = spaceOf({ x: -900, y: 30, strength: 60 }, 400, 300);
    expect(placementFromFrame(H, 60, 60, fromRight).front).toBe(true);
    expect(placementFromFrame(H, 60, 60, fromLeft).front).toBe(false);
  });

  it('meet at a box’s corners: the top and the right side folded back share their far corner', () => {
    const d = 40;
    const top = hingeFrame(
      100,
      100,
      100,
      d,
      { edge: 'n', childEdge: 's', offset: 0, along: 1, across: 1 },
      90 * DEG,
    );
    const right = hingeFrame(
      100,
      100,
      d,
      100,
      { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 },
      90 * DEG,
    );
    expectNear(frameApply(top, 100, 0), [100, 0, d]);
    expectNear(frameApply(right, d, 0), [100, 0, d]);
    // Every edge of every side matches its neighbour's along its whole length.
    for (const t of [0, 0.3, 1])
      expectNear(frameApply(top, 100, d * (1 - t)), frameApply(right, d * t, 0));
  });
});

describe('a scene of linked pieces', () => {
  function pair(): { parent: Piece; child: Piece } {
    const parent = makePiece('a', '', 'L', img(100, 60), { x: 100, y: 100, w: 100, h: 60 }, 0);
    const child = makePiece('b', '', 'L', img(20, 20), { x: 0, y: 0, w: 20, h: 20 }, 0);
    // Relative to the parent's own pixels: its pivot at (110, 30), just past the right edge.
    child.keyframes = setKey(child.keyframes, 0, { x: 110, y: 30 });
    child.link = { parent: 'a', hinge: null };
    return { parent, child };
  }

  it('moves a piece with the one it follows', () => {
    const { parent, child } = pair();
    parent.keyframes = setKey(parent.keyframes, 10, { x: 200, angle: Math.PI / 2 });
    const at0 = shown(new Scene([parent, child], 0), child, child.pivot);
    expect(at0.x).toBeCloseTo(210, 6);
    expect(at0.y).toBeCloseTo(130, 6);
    // Turned a quarter about the parent's pivot (150, 130), now at (200, 130).
    const at10 = shown(new Scene([parent, child], 10), child, child.pivot);
    expect(at10.x).toBeCloseTo(200, 6);
    expect(at10.y).toBeCloseTo(130 + 60, 6);
  });

  it('carries a group’s opacity down, but not a piece’s', () => {
    const { parent, child } = pair();
    const g = makeGroup('g', '', 'L', parent.home, parent.pivot, parent.keyframes);
    g.keyframes = setKey(g.keyframes, 0, { opacity: 0.5 });
    parent.link = { parent: 'g', hinge: null };
    parent.keyframes = setKey(parent.keyframes, 0, { x: 50, y: 30, opacity: 0.4 });
    const scene = new Scene([g, parent, child], 0);
    expect(scene.opacity(parent)).toBeCloseTo(0.2, 9);
    expect(scene.opacity(child)).toBeCloseTo(0.5, 9);
    expect(scene.shows(g)).toBe(false);
  });

  it('treats links that don’t hold as none: a missing parent, another layer, or a loop', () => {
    const { parent, child } = pair();
    const free = shown(new Scene([child], 0), child, child.pivot);
    expect(free.x).toBeCloseTo(110, 6);
    const elsewhere = { ...parent, layerId: 'other' };
    expect(shown(new Scene([elsewhere, child], 0), child, child.pivot).x).toBeCloseTo(110, 6);
    const looped = { ...parent, link: { parent: 'b', hinge: null } };
    const scene = new Scene([looped, child], 0);
    expect(Number.isFinite(shown(scene, child, child.pivot).x)).toBe(true);
    expect(Number.isFinite(shown(scene, looped, looped.pivot).x)).toBe(true);
  });

  it('keeps a hinged piece of a flat parent flat beside it, unfolded', () => {
    const { parent, child } = pair();
    child.link = {
      parent: 'a',
      hinge: { edge: 'e', childEdge: 'w', offset: 20, along: 1, across: 1 },
    };
    const scene = new Scene([parent, child], 0, space);
    expect(scene.placement(child).affine).not.toBeNull();
    const c = shown(scene, child, { x: 0, y: 0 });
    expect(c.x).toBeCloseTo(200, 6);
    expect(c.y).toBeCloseTo(120, 6);
    // Folded, it goes into 3D (and is shaded there).
    child.keyframes = setKey(child.keyframes, 0, { fold: 60 * DEG });
    child.shade = 1;
    const folded = new Scene([parent, child], 0, space);
    expect(folded.placement(child).affine).toBeNull();
    expect(folded.shade(child, { angle: 0, height: 45 })).toBeLessThan(1);
    const edge = shown(folded, child, { x: 0, y: 0 });
    expect(edge.x).toBeCloseTo(200, 6);
    expect(edge.y).toBeCloseTo(120, 6);
  });
});

describe('linking pieces', () => {
  function stage(): Piece[] {
    const a = makePiece('a', '', 'L', img(100, 100), { x: 100, y: 80, w: 100, h: 100 }, 0);
    a.keyframes = setKey(a.keyframes, 0, { tilt: 0.3, turn: -0.4, depth: 30 });
    a.keyframes = setKey(a.keyframes, 12, { x: 260, angle: 0.5 });
    const b = makePiece('b', '', 'L', img(40, 100), { x: 300, y: 80, w: 40, h: 100 }, 0);
    b.keyframes = setKey(b.keyframes, 0, { tilt: -0.2, angle: 0.1 });
    const c = makePiece('c', '', 'other', img(10, 10), { x: 0, y: 0, w: 10, h: 10 }, 0);
    return [a, b, c];
  }
  let n = 0;
  const newId = () => `new-${++n}`;
  const corners = (pieces: Piece[], id: string, frame: number) => {
    const scene = new Scene(pieces, frame, space);
    const p = pieces.find((q) => q.id === id)!;
    const { width: w, height: h } = p.src;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ].flatMap((q) => {
      const s = shown(scene, p, q);
      return [s.x, s.y];
    });
  };

  it('attaches a piece where it is, then it follows', () => {
    const pieces = stage();
    const before = corners(pieces, 'b', 6);
    const next = attach(pieces, 'b', 'a', 6, space);
    if (typeof next === 'string') throw new Error(next);
    expectNear(corners(next, 'b', 6), before, 4);
    // At frame 12 the parent has moved on, and the piece with it.
    const moved = corners(next, 'b', 12);
    expect(moved[0] - before[0]).toBeGreaterThan(50);
    // The originals are left alone (undo snapshots keep them).
    expect(pieces[1].link).toBeNull();
  });

  it('refuses links across layers, in a loop, onto a group by a hinge, or past a full tree', () => {
    const pieces = stage();
    expect(attach(pieces, 'c', 'a', 0, space)).toBe('layer');
    const linked = attach(pieces, 'b', 'a', 0, space) as Piece[];
    expect(attach(linked, 'a', 'b', 0, space)).toBe('loop');
    const g = makeGroup('g', '', 'L', pieces[0].home, pieces[0].pivot, pieces[0].keyframes);
    expect(hinge([...pieces, g], 'b', 'g', plain, 0, newId)).toBe('group');
    expect(attach([...pieces, g], 'g', 'a', 0, space)).toBe('group');
    const many = Array.from({ length: MAX_TREE }, (_, i) => {
      const p = makePiece(`m${i}`, '', 'L', img(4, 4), { x: 0, y: 0, w: 4, h: 4 }, 0);
      if (i) p.link = { parent: 'm0', hinge: null };
      return p;
    });
    expect(attach([...many, ...pieces], 'b', 'm0', 0, space)).toBe('full');
  });

  it('hinges a piece onto another’s edge, making a group that takes over its motion', () => {
    const pieces = stage();
    const before = [0, 6, 12].map((f) => corners(pieces, 'a', f));
    const result = hinge(
      pieces,
      'b',
      'a',
      { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 },
      90 * DEG,
      newId,
    );
    if (typeof result === 'string') throw new Error(result);
    const { pieces: next, group } = result;
    expect(group?.kind).toBe('group');
    const a = next.find((p) => p.id === 'a')!;
    expect(a.link).toEqual({ parent: group!.id, hinge: null });
    // The parent stays exactly where it was all along.
    [0, 6, 12].forEach((f, i) => expectNear(corners(next, 'a', f), before[i], 4));
    // The hinged piece's edge is on the parent's right edge.
    const ca = corners(next, 'a', 6);
    const cb = corners(next, 'b', 6);
    expectNear([cb[0], cb[1], cb[6], cb[7]], [ca[2], ca[3], ca[4], ca[5]], 6);
    // One tree of three.
    expect(
      treeOf(next, a)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'b', group!.id].sort());
  });

  it('unhinges a piece where it was, baked at every keyframe of its tree, and drops an empty group', () => {
    const pieces = stage();
    const { pieces: hinged, group } = hinge(pieces, 'b', 'a', plain, 70 * DEG, newId) as {
      pieces: Piece[];
      group: Piece;
    };
    const want = [0, 12].map((f) => corners(hinged, 'b', f));
    const free = detach(hinged, 'b', space);
    const b = free.find((p) => p.id === 'b')!;
    expect(b.link).toBeNull();
    expect(b.keyframes.map((k) => k.frame)).toEqual([0, 12]);
    [0, 12].forEach((f, i) => expectNear(corners(free, 'b', f), want[i], 4));
    // The group still carries `a`; once `a` lets go as well, the group has nothing left and goes.
    expect(free.some((p) => p.id === group.id)).toBe(true);
    const none = detach(free, 'a', space);
    expect(none.some((p) => p.id === group.id)).toBe(false);
    expectNear(corners(none, 'a', 12), corners(pieces, 'a', 12), 4);
  });

  it('deletes a piece with the ones under it, and the group left empty', () => {
    const pieces = stage();
    const { pieces: hinged, group } = hinge(pieces, 'b', 'a', plain, 0, newId) as {
      pieces: Piece[];
      group: Piece;
    };
    expect(
      removeTree(hinged, 'b')
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'c', group.id].sort());
    expect(removeTree(hinged, 'a').map((p) => p.id)).toEqual(['c']);
    expect(removeTree(hinged, group.id).map((p) => p.id)).toEqual(['c']);
  });

  it('duplicates a tree linked as it was, and moves whole trees between layers', () => {
    const pieces = stage();
    const { pieces: hinged, group } = hinge(pieces, 'b', 'a', plain, 0, newId) as {
      pieces: Piece[];
      group: Piece;
    };
    const dup = duplicateTree(hinged, group.id, newId)!;
    expect(dup.pieces).toHaveLength(hinged.length + 3);
    const copies = subtree(dup.pieces, dup.copy.id);
    expect(copies).toHaveLength(3);
    // The copies link to each other, never to the originals.
    const ids = new Set(copies.map((p) => p.id));
    for (const p of copies) if (p.link) expect(ids.has(p.link.parent)).toBe(true);
    expect(dup.copy.link).toBeNull();
    // A face duplicated on its own stays in the same tree.
    const face = duplicateTree(hinged, 'b', newId)!;
    expect(face.copy.link?.parent).toBe('a');
    const moved = moveTree(hinged, 'b', 'other');
    expect(
      moved
        .filter((p) => p.layerId === 'other')
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'b', 'c', group.id].sort());
  });

  it('copies pieces with their links renamed (duplicating a layer)', () => {
    const pieces = stage();
    const { pieces: hinged } = hinge(pieces, 'b', 'a', plain, 0, newId) as {
      pieces: Piece[];
      group: Piece;
    };
    const onL = hinged.filter((p) => p.layerId === 'L');
    const copies = copyPieces(onL, newId, () => 'L2');
    const ids = new Map(onL.map((p, i) => [p.id, copies[i].id]));
    copies.forEach((c, i) => {
      expect(c.layerId).toBe('L2');
      expect(c.link?.parent ?? null).toBe(onL[i].link ? ids.get(onL[i].link!.parent) : null);
    });
  });

  it('drops links that don’t hold from a file', () => {
    const pieces = stage();
    const [a, b, c] = pieces;
    const g = makeGroup('g', '', 'L', a.home, a.pivot, a.keyframes);
    const checked = checkLinks([
      { ...a, link: { parent: 'b', hinge: null } },
      { ...b, link: { parent: 'a', hinge: null } },
      { ...c, link: { parent: 'a', hinge: null } },
      { ...g, link: { parent: 'a', hinge: null } },
      { ...makePiece('d', '', 'L', img(4, 4), a.home, 0), link: { parent: 'g', hinge: plain } },
      { ...makePiece('e', '', 'L', img(4, 4), a.home, 0), link: { parent: 'gone', hinge: null } },
    ]);
    const links = Object.fromEntries(checked.map((p) => [p.id, p.link?.parent ?? null]));
    // One of the loop's two is let go; the rest that don't hold are dropped.
    expect([links.a, links.b].filter((x) => x !== null)).toHaveLength(1);
    expect(links).toMatchObject({ c: null, g: null, d: null, e: null });
  });

  it('leaves a linked piece’s keyframes alone when the picture is transformed (it goes with its parent)', () => {
    const pieces = stage();
    const { pieces: hinged } = hinge(pieces, 'b', 'a', plain, 0.4, newId) as {
      pieces: Piece[];
      group: Piece;
    };
    const flipped = transformPieces(hinged, [-1, 0, 0, 1, 400, 0]);
    const b0 = hinged.find((p) => p.id === 'b')!;
    const b1 = flipped.find((p) => p.id === 'b')!;
    expect(b1.keyframes).toEqual(b0.keyframes);
    // The whole tree is mirrored: the hinge corner lands mirrored too.
    const c0 = corners(hinged, 'b', 0);
    const c1 = corners(flipped, 'b', 0);
    expect(Number.isFinite(c1[0])).toBe(true);
    expect(c0[0]).not.toBeCloseTo(c1[0], 1);
  });
});

describe('links in the controller and in projects', () => {
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

  it('hinges, unhinges, duplicates and deletes as undoable steps', () => {
    const a = anim.add(img(50, 50), { x: 100, y: 100, w: 50, h: 50 }, doc.layers[0].id)!;
    const b = anim.add(img(50, 50), { x: 200, y: 100, w: 50, h: 50 }, doc.layers[0].id)!;
    expect(anim.hinge(b.id, a.id, plain, 90 * DEG)).toBe(true);
    expect(doc.pieces).toHaveLength(3);
    expect(doc.pieces.find((p) => p.kind === 'group')?.name).toBe('group 1');
    expect(anim.info().pieces.find((p) => p.id === b.id)).toMatchObject({
      parent: a.id,
      hinged: true,
    });
    anim.select(b.id);
    expect(anim.fields()).toMatchObject({ link: 'hinged', in3d: true });
    expect(anim.fields()!.fold).toBeCloseTo(90, 9);
    expect(anim.setFields({ fold: 45 })).toBe(true);
    expect(anim.fields()!.fold).toBeCloseTo(45, 9);
    const copy = anim.duplicate(a.id)!;
    expect(doc.pieces).toHaveLength(5);
    expect(anim.selectedId).toBe(copy);
    expect(anim.remove(copy)).toBe(true);
    expect(doc.pieces).toHaveLength(3);
    expect(anim.detach(b.id)).toBe(true);
    expect(doc.pieces.find((p) => p.id === b.id)?.link).toBeNull();
    // Back to before the hinge (unhinge, delete, duplicate, fold, hinge).
    for (let i = 0; i < 5; i++) history.undo();
    expect(doc.pieces.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(doc.pieces.every((p) => p.link === null)).toBe(true);
    history.redo();
    expect(doc.pieces).toHaveLength(3);
  });

  it('says why a link can’t be made', () => {
    const a = anim.add(img(10, 10), { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    expect(anim.attach(a.id, a.id)).toBe(false);
    const b = anim.add(img(10, 10), { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    expect(anim.attach(b.id, a.id)).toBe(true);
    expect(anim.attach(a.id, b.id)).toBe(false);
    expect(notices).toContain('notice.linkLoop');
  });

  it('moves a whole tree to another layer, and keeps a follower in place when its pivot moves', () => {
    const top = new RasterLayer('Top', new Surface(400, 300));
    doc.layers.push(top);
    const a = anim.add(img(40, 40), { x: 10, y: 10, w: 40, h: 40 }, doc.layers[0].id)!;
    const b = anim.add(img(40, 40), { x: 60, y: 10, w: 40, h: 40 }, doc.layers[0].id)!;
    anim.setKey(a.id, 0, { angle: 0.6, tilt: 0.3 });
    expect(anim.attach(b.id, a.id)).toBe(true);
    const at = () => shown(anim.scene(), anim.piece(b.id)!, { x: 3, y: 7 });
    const before = at();
    expect(anim.setPivot(b.id, { x: 5, y: 33 })).toBe(true);
    expect(at().x).toBeCloseTo(before.x, 6);
    expect(at().y).toBeCloseTo(before.y, 6);
    expect(anim.moveToLayer(b.id, top.id)).toBe(true);
    expect(doc.pieces.every((p) => p.layerId === top.id)).toBe(true);
  });

  it('saves and reopens groups, links and folds (version 3)', async () => {
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
        return {
          w: dv.getUint32(0),
          h: dv.getUint32(4),
          data: new Uint8ClampedArray(bytes.slice(8)),
        };
      },
    };
    const a = anim.add(img(50, 50), { x: 100, y: 100, w: 50, h: 50 }, doc.layers[0].id)!;
    const b = anim.add(img(50, 30), { x: 200, y: 100, w: 50, h: 30 }, doc.layers[0].id)!;
    anim.hinge(
      b.id,
      a.id,
      { edge: 's', childEdge: 'n', offset: 5, along: 0.9, across: 1.1 },
      30 * DEG,
    );
    expect(versionFor(doc)).toBe(3);
    const bytes = await saveProject(doc, codec);
    const json = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { version: number };
    expect(json.version).toBe(3);
    const back = await loadProject(bytes, codec);
    const strip = (pieces: readonly Piece[]) =>
      pieces.map((p) => ({
        id: p.id,
        kind: p.kind,
        link: p.link,
        keyframes: p.keyframes,
        pivot: p.pivot,
      }));
    expect(strip(back.pieces)).toEqual(strip(doc.pieces));
    const was = shown(new Scene(doc.pieces, 0, doc.space), doc.pieces[2], { x: 10, y: 10 });
    const now = shown(new Scene(back.pieces, 0, back.space), back.pieces[2], { x: 10, y: 10 });
    expect(now.x).toBeCloseTo(was.x, 9);
    expect(now.y).toBeCloseTo(was.y, 9);
  });
});
