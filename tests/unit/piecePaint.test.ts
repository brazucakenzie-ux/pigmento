import { describe, expect, it } from 'vitest';
import { makePiece, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { PiecePixelsCommand, piecePaintMap } from '@engine/anim/piecePaint';
import { forPiece } from '@engine/tools/brushTool';
import { defaultBrush } from '@engine/brush/types';
import type { Dab } from '@engine/brush/dab';

/** A 50 × 20 piece lifted at (100, 40). */
function piece(): Piece {
  return makePiece('p', '', 'l', { w: 50, h: 20, data: new Uint8ClampedArray(50 * 20 * 4) }, { x: 100, y: 40, w: 50, h: 20 }, 0);
}

const dab = (x: number, y: number, size = 10): Dab => ({ x, y, size, angle: 0, roundness: 1, hardness: 1, alpha: 1, color: { r: 0, g: 0, b: 0, a: 255 } });

describe('painting on a piece maps the canvas onto its own pixels', () => {
  it('leaves an unmoved piece where it was lifted from', () => {
    const p = piece();
    const map = piecePaintMap(p, pieceStateAt(p, 0))!;
    expect(map.toPiece({ x: 110, y: 45 })).toEqual({ x: 10, y: 5 });
    expect(map.scale).toBe(1);
    expect(map.fold(dab(10, 5))).toEqual([dab(10, 5)]);
  });

  it('follows a moved, scaled and turned piece both ways', () => {
    const p = piece();
    p.keyframes = setKey(p.keyframes, 0, { x: 300, y: 300, sx: 2, sy: 2, angle: Math.PI / 2 });
    const map = piecePaintMap(p, pieceStateAt(p, 0))!;
    // The pivot (the middle) is now at (300, 300).
    const mid = map.toPiece({ x: 300, y: 300 })!;
    expect(mid.x).toBeCloseTo(25, 9);
    expect(mid.y).toBeCloseTo(10, 9);
    for (const q of [{ x: 0, y: 0 }, { x: 13.5, y: 7.25 }, { x: 50, y: 20 }]) {
      const back = map.toPiece(map.toDoc(q)!)!;
      expect(back.x).toBeCloseTo(q.x, 9);
      expect(back.y).toBeCloseTo(q.y, 9);
    }
    // Twice the size: a 20 px brush lays 10 px dabs on the piece.
    expect(map.scale).toBeCloseTo(2, 9);
    // Turned a quarter: across on the canvas is up the piece (−y in its own pixels).
    expect(map.angle(0)).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('sizes the brush and keeps a fixed nib angle as it looks on the canvas', () => {
    const p = piece();
    p.keyframes = setKey(p.keyframes, 0, { sx: 4, sy: 4, angle: Math.PI / 4 });
    const map = piecePaintMap(p, pieceStateAt(p, 0))!;
    const settings = defaultBrush({ angle: 90 });
    const b = forPiece({ settings, size: 40, opacity: 1, pressure: false, smoothing: 0 }, map);
    expect(b.size).toBeCloseTo(10, 9);
    expect(b.settings.angle).toBeCloseTo(45, 9);
    // A nib that follows the stroke turns with it on the piece already.
    expect(forPiece({ settings: { ...settings, followStroke: true }, size: 40, opacity: 1, pressure: false, smoothing: 0 }, map).settings.angle).toBe(90);
  });

  it('runs on past a repeating piece’s edge and folds each dab onto its tile', () => {
    const p = piece();
    p.repeat = 'x';
    p.keyframes = setKey(p.keyframes, 0, { scrollX: 7 });
    const map = piecePaintMap(p, pieceStateAt(p, 0))!;
    // Two tiles to the right of where it was lifted, its scroll taken off: not folded yet.
    expect(map.toPiece({ x: 100 + 100 + 30, y: 50 })).toEqual({ x: 123, y: 10 });
    expect(map.fold(dab(123, 10)).map((d) => d.x)).toEqual([23]);
    // Over the seam: in the tile at its end, and its copy at the start of the next one.
    expect(map.fold(dab(-3, 10)).map((d) => d.x)).toEqual([47, -3]);
    expect(map.fold(dab(52, 10)).map((d) => d.x)).toEqual([2, 52]);
    // Down isn't repeated: y stays as it is.
    expect(map.fold(dab(10, 25)).map((d) => d.y)).toEqual([25]);
  });

  it('can’t paint a piece scaled to nothing', () => {
    const p = piece();
    p.keyframes = setKey(p.keyframes, 0, { sx: 0 });
    expect(piecePaintMap(p, pieceStateAt(p, 0))).toBeNull();
  });
});

describe('a stroke on a piece is one undo step', () => {
  it('swaps the piece’s tiles back and forth', () => {
    const p = piece();
    const changed: Piece[] = [];
    p.src.beginEdit();
    p.src.fillRect({ x: 0, y: 0, w: 5, h: 5 }, { r: 9, g: 8, b: 7, a: 255 });
    const cmd = new PiecePixelsCommand('history.brush', { piecePixelsChanged: (q) => changed.push(q) }, p, p.src.endEdit()!);
    expect(cmd.bytes).toBeGreaterThan(0);
    cmd.undo();
    expect(p.src.getPixel(2, 2).a).toBe(0);
    cmd.redo();
    expect(p.src.getPixel(2, 2)).toEqual({ r: 9, g: 8, b: 7, a: 255 });
    expect(changed).toEqual([p, p]);
  });
});
