import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { clonePiece, copyPiece, makePiece, pieceSurfaceAt, pieceSurfaces, showPieceFrame, type Piece } from '@engine/anim/piece';
import { Surface } from '@engine/raster/Surface';
import { Scene } from '@engine/anim/scene';
import { drawPiece } from '@engine/anim/pieceRaster';

const RED = { r: 220, g: 30, b: 30, a: 255 };
const BLUE = { r: 30, g: 30, b: 220, a: 255 };

/** A 10 × 10 piece drawn twice: red from frame 0, blue from frame 3. */
function flicker(): { p: Piece; a: Surface; b: Surface } {
  const a = new Surface(10, 10);
  a.fillRect({ x: 0, y: 0, w: 10, h: 10 }, RED);
  const b = new Surface(10, 10);
  b.fillRect({ x: 0, y: 0, w: 10, h: 10 }, BLUE);
  const p = makePiece('p', '', 'L', a, { x: 0, y: 0, w: 10, h: 10 }, 0);
  p.drawings = [
    { start: 0, surface: a },
    { start: 3, surface: b },
  ];
  return { p, a, b };
}

function setup() {
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
  return { doc, history, anim: new AnimationController(host) };
}

describe('a piece’s drawings', () => {
  it('show from their start until the next one’s, and loop like a layer’s', () => {
    const { p, a, b } = flicker();
    expect([0, 2, 3, 9].map((f) => pieceSurfaceAt(p, f))).toEqual([a, a, b, b]);
    p.drawingLoop = { mode: 'cycle', end: 6 };
    expect([5, 6, 8, 9, 12].map((f) => pieceSurfaceAt(p, f))).toEqual([b, a, a, b, a]);
    // Without drawings, its one picture throughout.
    const still = makePiece('s', '', 'L', a, { x: 0, y: 0, w: 10, h: 10 }, 0);
    expect(pieceSurfaceAt(still, 7)).toBe(a);
    expect(pieceSurfaces(p)).toEqual([a, b]);
    expect(pieceSurfaces(still)).toEqual([a]);
  });

  it('put the drawing for the frame shown on show, with the picture’s other drawings', () => {
    const { doc } = setup();
    const { p, a, b } = flicker();
    doc.pieces = [p];
    doc.showFrame(4);
    expect(p.src).toBe(b);
    doc.showFrame(1);
    expect(p.src).toBe(a);
    showPieceFrame(p, 3);
    expect(p.src).toBe(b);
  });

  it('are shared by undo snapshots and copied (once each) by copies', () => {
    const { p, a, b } = flicker();
    // The same drawing again later (as a loop's repeat might be).
    p.drawings!.push({ start: 6, surface: a });
    p.drawingLoop = { mode: 'pingpong', end: 9 };
    const snap = clonePiece(p);
    expect(snap.drawings).not.toBe(p.drawings);
    expect(snap.drawings!.map((c) => c.surface)).toEqual([a, b, a]);
    expect(snap.drawingLoop).toEqual(p.drawingLoop);
    expect(snap.drawingLoop).not.toBe(p.drawingLoop);
    const copy = copyPiece(p, 'q', 'L');
    const [ca, cb, ca2] = copy.drawings!.map((c) => c.surface);
    expect(ca).not.toBe(a);
    expect(cb).not.toBe(b);
    expect(ca2).toBe(ca);
    expect(copy.src).toBe(ca);
    expect(ca.getPixel(5, 5)).toEqual(RED);
    expect(copy.drawings!.map((c) => c.start)).toEqual([0, 3, 6]);
  });

  it('come along when a piece is duplicated, and an undo step that changes nothing else isn’t one', () => {
    const { doc, history, anim } = setup();
    const { p } = flicker();
    doc.pieces = [p];
    expect(anim.duplicate(p.id)).toBeTruthy();
    const dup = doc.pieces.find((q) => q.id !== p.id)!;
    expect(dup.drawings!.map((c) => c.start)).toEqual([0, 3]);
    expect(dup.drawings![1].surface).not.toBe(p.drawings![1].surface);
    expect(dup.drawings![1].surface.getPixel(1, 1)).toEqual(BLUE);
    history.undo();
    expect(doc.pieces).toHaveLength(1);
    expect(doc.pieces[0].drawings!.map((c) => c.surface)).toEqual(p.drawings!.map((c) => c.surface));
  });
});

describe('drawing a piece’s drawings', () => {
  /** The colour the CPU path paints at (5, 5) for the piece at a frame. */
  const paintedAt = (p: Piece, frame: number) => {
    const view = { data: new Uint8ClampedArray(20 * 20 * 4), stride: 20, ox: 0, oy: 0 };
    drawPiece(view, { x: 0, y: 0, w: 20, h: 20 }, p, new Scene([p], frame));
    return [...view.data.slice((5 * 20 + 5) * 4, (5 * 20 + 5) * 4 + 4)];
  };

  it('shows each frame its own drawing, through a scene and on the CPU path, wherever the frame on show is', () => {
    const { p, a, b } = flicker();
    expect(new Scene([p], 1).src(p)).toBe(a);
    expect(new Scene([p], 3).src(p)).toBe(b);
    // The frame on show doesn't matter: each frame draws its own drawing.
    showPieceFrame(p, 4);
    expect(paintedAt(p, 0)).toEqual([220, 30, 30, 255]);
    expect(paintedAt(p, 5)).toEqual([30, 30, 220, 255]);
    p.drawingLoop = { mode: 'cycle', end: 6 };
    expect(paintedAt(p, 7)).toEqual([220, 30, 30, 255]);
    expect(paintedAt(p, 10)).toEqual([30, 30, 220, 255]);
  });
});
