import { describe, expect, it } from 'vitest';
import { findSnap, foldHandle, foldToward } from '@engine/anim/edgeSnap';
import { hinge } from '@engine/anim/links';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';
import { Scene } from '@engine/anim/scene';
import { project, spaceOf } from '@engine/anim/space';
import type { ImageBuf } from '@engine/raster/transform';

const img = (w: number, h: number): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
const DEG = Math.PI / 180;
const space = spaceOf({ x: 200, y: 150, strength: 60 }, 400, 300);

/** A w × h piece with its top-left corner at (x, y). */
function at(id: string, x: number, y: number, w: number, h: number): Piece {
  return makePiece(id, '', 'L', img(w, h), { x, y, w, h }, 0);
}

describe('edge snapping', () => {
  it('finds the edge a dragged piece lies along, running the other way', () => {
    const a = at('a', 100, 100, 100, 60);
    const b = at('b', 203, 101, 60, 60);
    const snap = findSnap(new Scene([a, b], 0), b, [a], 8)!;
    expect(snap.parent).toBe(a);
    expect(snap.hinge).toMatchObject({ edge: 'e', childEdge: 'w' });
    // Same height (within reach): made exactly equal, and lined up.
    expect(snap.hinge.offset).toBe(0);
    expect(snap.hinge.along).toBeCloseTo(1, 9);
    expect(snap.fold).toBeCloseTo(0, 9);
    expect(snap.line[0]).toEqual({ x: 200, y: 100 });
    expect(snap.line[1]).toEqual({ x: 200, y: 160 });
  });

  it('lines a shorter edge up with the nearer end, at its own size', () => {
    const a = at('a', 100, 100, 100, 60);
    const low = at('b', 202, 128, 30, 30);
    const s1 = findSnap(new Scene([a, low], 0), low, [a], 8)!;
    expect(s1.hinge.along).toBeCloseTo(1, 9);
    expect(s1.hinge.offset).toBeCloseTo(30, 9);
    const high = at('c', 202, 103, 30, 30);
    const s2 = findSnap(new Scene([a, high], 0), high, [a], 8)!;
    expect(s2.hinge.offset).toBe(0);
  });

  it('finds nothing too far away, alongside but past the end, or running the same way', () => {
    const a = at('a', 100, 100, 100, 60);
    expect(findSnap(new Scene([a], 0), at('b', 220, 100, 60, 60), [a], 8)).toBeNull();
    expect(findSnap(new Scene([a], 0), at('b', 201, 200, 60, 60), [a], 8)).toBeNull();
    // Mirrored, the edge beside the parent's runs the same way (as on the back of the sheet): no hinge.
    const flipped = at('b', 200, 100, 60, 60);
    flipped.keyframes = setKey(flipped.keyframes, 0, { sx: -1 });
    const left = project(new Scene([flipped], 0).placement(flipped), { x: 60, y: 0 })!;
    expect(left.x).toBeCloseTo(200, 6);
    expect(findSnap(new Scene([a, flipped], 0), flipped, [a], 8)).toBeNull();
  });

  it('folds a hinged piece towards the pointer, by its far edge (Shift: 15° steps)', () => {
    const a = at('a', 100, 100, 100, 100);
    const b = at('b', 0, 0, 60, 100);
    const linked = hinge([a, b], 'b', 'a', { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 }, 0, () => 'g');
    if (typeof linked === 'string') throw new Error(linked);
    const child = linked.pieces.find((p) => p.id === 'b')!;
    // The handle is in the middle of the edge across from the hinge.
    expect(foldHandle(child)).toEqual({ x: 60, y: 50 });
    expect(foldHandle(a)).toBeNull();
    // Where the handle shows folded by 40°: dragging there gives 40° (and 45° in steps).
    const target = linked.pieces.map((p) => (p.id === 'b' ? { ...p, keyframes: setKey(p.keyframes, 0, { fold: 40 * DEG }) } : p));
    const scene = new Scene(target, 0, space);
    const tb = target.find((p) => p.id === 'b')!;
    const there = project(scene.placement(tb), foldHandle(tb)!)!;
    const flat = new Scene(linked.pieces, 0, space);
    expect(foldToward(flat, child, there, 0, false)).toBeCloseTo(40 * DEG, 3);
    expect(foldToward(flat, child, there, 0, true)).toBeCloseTo(45 * DEG, 9);
    // A piece that isn't hinged keeps what it has.
    expect(foldToward(flat, a, there, 0.3, false)).toBe(0.3);
  });

  it('keeps the dragged piece’s angle in 3D as the fold', () => {
    const a = at('a', 100, 100, 100, 100);
    const b = at('b', 0, 0, 60, 100);
    // Hinge it at 50° to get a pose, then let it go free there: dragged back, it snaps to 50°.
    const linked = hinge([a, b], 'b', 'a', { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 }, 50 * DEG, () => 'g');
    if (typeof linked === 'string') throw new Error(linked);
    const scene = new Scene(linked.pieces, 0, space);
    const child = linked.pieces.find((p) => p.id === 'b')!;
    const snap = findSnap(scene, child, [linked.pieces.find((p) => p.id === 'a')!], 4)!;
    expect(snap.hinge).toMatchObject({ edge: 'e', childEdge: 'w', offset: 0 });
    expect(snap.fold).toBeCloseTo(50 * DEG, 6);
  });
});
