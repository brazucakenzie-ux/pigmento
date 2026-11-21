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

describe('a piece’s drawings in the animation controller', () => {
  /** A red 10 × 10 piece on the first layer, added like Animate selection does. */
  function redPiece() {
    const ctx = setup();
    const red = new Surface(10, 10);
    red.fillRect({ x: 0, y: 0, w: 10, h: 10 }, RED);
    const p = ctx.anim.add(red, { x: 20, y: 20, w: 10, h: 10 }, ctx.doc.layers[0].id)!;
    return { ...ctx, p, red };
  }

  it('starts drawings on a still piece, blank or copied, as undo steps that never key its moves', () => {
    const { anim, history, p, red } = redPiece();
    anim.setFrame(3);
    expect(anim.newDrawing(p.id, true)).toBe(true);
    const live = anim.piece(p.id)!;
    expect(live.drawings!.map((c) => c.start)).toEqual([0, 3]);
    const copy = live.drawings![1].surface;
    expect(copy).not.toBe(red);
    expect(copy.getPixel(4, 4)).toEqual(RED);
    expect(live.src).toBe(copy);
    expect(live.keyframes).toHaveLength(1);
    // A blank one later, the piece's size.
    anim.setFrame(6);
    expect(anim.newDrawing(p.id, false)).toBe(true);
    const blank = anim.piece(p.id)!.drawings![2].surface;
    expect([blank.width, blank.height]).toEqual([10, 10]);
    expect(blank.contentBounds()).toBeNull();
    expect(anim.info().pieces[0].drawings).toEqual([0, 3, 6]);
    history.undo();
    history.undo();
    expect(anim.piece(p.id)!.drawings).toBeNull();
    expect(anim.piece(p.id)!.src).toBe(red);
  });

  it('refuses a drawing where one starts, on a repeat, on a group or a locked layer', () => {
    const { anim, doc, p } = redPiece();
    expect(anim.newDrawing(p.id, false)).toBe(false);
    anim.setFrame(2);
    anim.newDrawing(p.id, true);
    anim.setDrawingLoop(p.id, 'cycle');
    expect(anim.piece(p.id)!.drawingLoop).toEqual({ mode: 'cycle', end: 4 });
    anim.setFrame(9);
    expect(anim.newDrawing(p.id, true)).toBe(false);
    doc.layers[0].locked = true;
    expect(anim.clearDrawing(p.id)).toBe(false);
    expect(anim.newDrawing(p.id, false)).toBe(false);
  });

  it('loop, move, clear and delete, tidying up when one drawing is left', () => {
    const { anim, p, red } = redPiece();
    anim.setFrame(3);
    anim.newDrawing(p.id, true);
    expect(anim.setDrawingLoop(p.id, 'pingpong')).toBe(true);
    expect(anim.piece(p.id)!.drawingLoop).toEqual({ mode: 'pingpong', end: 6 });
    expect(anim.setLoopEnd(p.id, 8)).toBe(true);
    expect(anim.info().pieces[0].drawingLoop).toEqual({ mode: 'pingpong', end: 8 });
    // The second drawing starts at frame 5 instead: the loop still ends after it.
    expect(anim.moveDrawing(p.id, 1, 5)).toBe(true);
    expect(anim.piece(p.id)!.drawings!.map((c) => c.start)).toEqual([0, 5]);
    anim.setFrame(5);
    expect(anim.clearDrawing(p.id)).toBe(true);
    expect(anim.piece(p.id)!.src.contentBounds()).toBeNull();
    expect(anim.piece(p.id)!.drawings![0].surface).toBe(red);
    // Deleting it leaves one drawing: a still piece again, with nothing to loop.
    expect(anim.deleteDrawing(p.id)).toBe(true);
    const live = anim.piece(p.id)!;
    expect(live.drawings).toBeNull();
    expect(live.drawingLoop).toBeNull();
    expect(live.src).toBe(red);
  });

  it('come with a piece added with its drawings, its loop and the one on show', () => {
    const ctx = setup();
    const a = new Surface(10, 10);
    const b = new Surface(10, 10);
    ctx.anim.setFrame(2);
    const p = ctx.anim.add(a, { x: 0, y: 0, w: 10, h: 10 }, ctx.doc.layers[0].id, 'history.animateSelection', false, {
      cels: [
        { start: 0, surface: a },
        { start: 2, surface: b },
      ],
      loop: { mode: 'cycle', end: 4 },
    })!;
    expect(p.drawings!.map((c) => c.surface)).toEqual([a, b]);
    expect(p.drawingLoop).toEqual({ mode: 'cycle', end: 4 });
    expect(p.src).toBe(b);
    ctx.history.undo();
    expect(ctx.doc.pieces).toHaveLength(0);
  });
});
