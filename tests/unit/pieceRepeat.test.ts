import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { makePiece, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { drawPiece } from '@engine/anim/pieceRaster';
import { pieceAt } from '@engine/anim/pieceEdit';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';

/** Four opaque pixels in a row, each a different red (10, 20, 30, 40). */
function strip(): Piece {
  const data = new Uint8ClampedArray(16);
  for (let x = 0; x < 4; x++) data.set([10 * (x + 1), 0, 0, 255], x * 4);
  return makePiece('s', '', 'l', { w: 4, h: 1, data }, { x: 0, y: 0, w: 4, h: 1 }, 0);
}

/** Red of each pixel of a w × h view after drawing p at frame 0 (-1 where nothing was drawn). */
function reds(p: Piece, w: number, h: number): number[][] {
  const view = { data: new Uint8ClampedArray(w * h * 4), stride: w, ox: 0, oy: 0 };
  drawPiece(view, { x: 0, y: 0, w, h }, p, 0);
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) row.push(view.data[(y * w + x) * 4 + 3] ? view.data[(y * w + x) * 4] : -1);
    rows.push(row);
  }
  return rows;
}

describe('repeating pieces', () => {
  it('copies tile on along the axis it repeats along, and only along it', () => {
    const p = strip();
    p.repeat = 'x';
    expect(reds(p, 10, 2)).toEqual([
      [10, 20, 30, 40, 10, 20, 30, 40, 10, 20],
      [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    ]);
    p.repeat = 'both';
    expect(reds(p, 6, 2)[1]).toEqual([10, 20, 30, 40, 10, 20]);
    p.repeat = 'none';
    expect(reds(p, 6, 1)[0]).toEqual([10, 20, 30, 40, -1, -1]);
  });

  it('slides by its scroll, wrapping round', () => {
    const p = strip();
    p.repeat = 'x';
    p.keyframes = setKey(p.keyframes, 0, { scrollX: 1 });
    expect(reds(p, 6, 1)[0]).toEqual([40, 10, 20, 30, 40, 10]);
    p.keyframes = setKey(p.keyframes, 0, { scrollX: -4001 });
    expect(reds(p, 6, 1)[0]).toEqual([20, 30, 40, 10, 20, 30]);
    // Scroll on an axis it doesn't repeat along does nothing.
    p.keyframes = setKey(p.keyframes, 0, { scrollX: 0, scrollY: 0.5 });
    expect(reds(p, 4, 1)[0]).toEqual([10, 20, 30, 40]);
  });

  it('blends across the seam between copies instead of fading at it', () => {
    const p = strip();
    p.repeat = 'x';
    // Twice the size: half-way pixels blend neighbours, including the last pixel with the next copy's first.
    p.keyframes = setKey(p.keyframes, 0, { sx: 2, sy: 2 });
    const row = reds(p, 16, 2)[0];
    expect(row.every((v) => v > 0)).toBe(true);
    // Pixel 8 sits between the copies' last (40) and first (10) pixels.
    expect(row[8]).toBeGreaterThan(10);
    expect(row[8]).toBeLessThan(40);
  });

  it('can be picked on any copy, its scroll included', () => {
    const p = strip();
    p.repeat = 'x';
    expect(pieceAt([p], 0, { x: 4002.5, y: 0.5 })).toBe(p);
    expect(pieceAt([p], 0, { x: 4002.5, y: 1.5 })).toBeNull();
    p.repeat = 'none';
    expect(pieceAt([p], 0, { x: 4002.5, y: 0.5 })).toBeNull();
  });
});

describe('repeat and scroll as undo steps', () => {
  function setup() {
    const doc = new PaintDocument({ width: 16, height: 16 });
    const notices: string[] = [];
    const history = new History();
    const host: AnimHost = { doc, history, commitLive() {}, notify: (_k, key) => notices.push(key), animationChanged() {} };
    const anim = new AnimationController(host);
    const p = anim.add({ w: 50, h: 10, data: new Uint8ClampedArray(2000).fill(255) }, { x: 0, y: 0, w: 50, h: 10 }, doc.layers[0].id)!;
    return { doc, history, anim, p, notices };
  }

  it('Repeat is one undo step, and its fields key the scroll', () => {
    const { history, anim, p } = setup();
    expect(anim.setRepeat(p.id, 'both')).toBe(true);
    expect(anim.piece(p.id)!.repeat).toBe('both');
    anim.select(p.id);
    anim.setFields({ scrollX: 12, scrollY: -3 });
    expect(anim.fields()).toMatchObject({ repeat: 'both', scrollX: 12, scrollY: -3 });
    history.undo();
    history.undo();
    expect(anim.piece(p.id)!.repeat).toBe('none');
  });

  it('Loop the scroll slides exactly one tile over the timeline, seamlessly', () => {
    const { doc, anim, p, notices } = setup();
    expect(anim.loopScroll(p.id)).toBe(false);
    expect(notices).toEqual(['notice.loopNeedsRepeat']);
    anim.setRepeat(p.id, 'x');
    doc.timeline.length = 24;
    expect(anim.loopScroll(p.id)).toBe(true);
    const q = anim.piece(p.id)!;
    expect(q.keyframes.map((k) => k.frame)).toEqual([0, 23]);
    // A steady 50/24 px a frame, so frame 23 leads into frame 0 (one whole tile on) by the same step.
    for (const f of [0, 7, 12, 23]) expect(pieceStateAt(q, f).scrollX).toBeCloseTo((-f * 50) / 24, 9);
    const step = pieceStateAt(q, 22).scrollX - pieceStateAt(q, 23).scrollX;
    expect(pieceStateAt(q, 23).scrollX - step).toBeCloseTo(-50, 9);
    // Repeating only down, it scrolls up instead.
    anim.setRepeat(p.id, 'y');
    anim.loopScroll(p.id);
    expect(pieceStateAt(anim.piece(p.id)!, 12).scrollY).toBeCloseTo(-5, 9);
  });
});
