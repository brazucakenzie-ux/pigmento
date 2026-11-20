import { describe, expect, it } from 'vitest';
import { identityState } from '@engine/anim/interpolate';
import { makePiece } from '@engine/anim/piece';
import { docToLocal, handleLocal, localToDoc, moveState, pieceAt, rotateState, scaleState, skewState } from '@engine/anim/pieceEdit';
import { Scene } from '@engine/anim/scene';
import type { ImageBuf } from '@engine/raster/transform';

const img = (w: number, h: number, alpha = 255): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(alpha) });
// A 40 × 20 piece lifted from (100, 100): pivot in its middle at (120, 110).
const piece = makePiece('p', 'P', 'l', img(40, 20), { x: 100, y: 100, w: 40, h: 20 }, 0);
const s0 = { ...identityState(120, 110) };

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('scale and stretch handles', () => {
  it('drags a corner with the opposite corner fixed', () => {
    const s = scaleState(s0, piece, 'se', { x: 180, y: 140 }, { shift: false, alt: false });
    expect(s.sx).toBeCloseTo(2);
    expect(s.sy).toBeCloseTo(2);
    close(localToDoc(s, piece.pivot, handleLocal(piece, 'nw')), { x: 100, y: 100 });
    close(localToDoc(s, piece.pivot, handleLocal(piece, 'se')), { x: 180, y: 140 });
  });

  it('stretches one way from an edge', () => {
    const s = scaleState(s0, piece, 'e', { x: 160, y: 999 }, { shift: false, alt: false });
    expect(s.sx).toBeCloseTo(1.5);
    expect(s.sy).toBe(1);
    close(localToDoc(s, piece.pivot, handleLocal(piece, 'w')), { x: 100, y: 110 });
  });

  it('keeps proportions with Shift and scales about the pivot with Alt', () => {
    const prop = scaleState(s0, piece, 'se', { x: 180, y: 110 }, { shift: true, alt: false });
    expect(prop.sx).toBeCloseTo(prop.sy);
    const alt = scaleState(s0, piece, 'e', { x: 160, y: 110 }, { shift: false, alt: true });
    // The east edge is 20 px from the pivot; now 40 px.
    expect(alt.sx).toBeCloseTo(2);
    expect({ x: alt.x, y: alt.y }).toEqual({ x: 120, y: 110 });
  });

  it('works on a turned piece and flips when dragged past the other side', () => {
    const turned = { ...s0, angle: Math.PI / 2 };
    // Turned a quarter: the east handle now points down.
    const east = localToDoc(turned, piece.pivot, handleLocal(piece, 'e'));
    close(east, { x: 120, y: 130 });
    const s = scaleState(turned, piece, 'e', { x: 120, y: 150 }, { shift: false, alt: false });
    expect(s.sx).toBeCloseTo(1.5);
    close(localToDoc(s, piece.pivot, handleLocal(piece, 'w')), localToDoc(turned, piece.pivot, handleLocal(piece, 'w')));
    const flipped = scaleState(s0, piece, 'e', { x: 80, y: 110 }, { shift: false, alt: false });
    expect(flipped.sx).toBeCloseTo(-0.5);
  });

  it('never collapses to nothing', () => {
    const s = scaleState(s0, piece, 'e', { x: 100, y: 110 }, { shift: false, alt: false });
    expect(Math.abs(s.sx)).toBeGreaterThanOrEqual(0.01);
  });
});

describe('skew, turn and move', () => {
  it('skews from the top edge with the bottom edge fixed', () => {
    const s = skewState(s0, piece, 'n', { x: 140, y: 100 });
    // Top moved 20 px right over a 20 px height: 45°.
    expect(s.skew).toBeCloseTo(-Math.PI / 4);
    close(localToDoc(s, piece.pivot, handleLocal(piece, 's')), { x: 120, y: 120 });
    close(localToDoc(s, piece.pivot, handleLocal(piece, 'n')), { x: 140, y: 100 });
  });

  it('turns about the pivot, the short way round, snapping with Shift', () => {
    const s = rotateState(s0, { x: 120, y: 90 }, { x: 140, y: 110 }, false);
    expect(s.angle).toBeCloseTo(Math.PI / 2);
    expect({ x: s.x, y: s.y }).toEqual({ x: 120, y: 110 });
    const snapped = rotateState(s0, { x: 120, y: 90 }, { x: 141, y: 104 }, true);
    expect((snapped.angle * 180) / Math.PI).toBeCloseTo(75, 6);
    // Keeps whole turns a keyframe already has.
    const spun = rotateState({ ...s0, angle: 4 * Math.PI }, { x: 140, y: 110 }, { x: 120, y: 130 }, false);
    expect(spun.angle).toBeCloseTo(4 * Math.PI + Math.PI / 2);
  });

  it('moves, and with Shift only along the main direction', () => {
    expect(moveState(s0, 30, 4, false)).toMatchObject({ x: 150, y: 114 });
    expect(moveState(s0, 30, 4, true)).toMatchObject({ x: 150, y: 110 });
    expect(moveState(s0, 3, -40, true)).toMatchObject({ x: 120, y: 70 });
  });
});

describe('finding pieces', () => {
  it('maps between the document and the piece', () => {
    const s = { ...s0, angle: 0.7, sx: 2, sy: 0.5, skew: 0.2 };
    const q = { x: 7, y: 3 };
    close(docToLocal(s, piece.pivot, localToDoc(s, piece.pivot, q))!, q);
  });

  it('picks the top piece that isn’t see-through there', () => {
    const below = makePiece('below', '', 'l', img(40, 20), { x: 100, y: 100, w: 40, h: 20 }, 0);
    const clear = makePiece('clear', '', 'l', img(40, 20, 0), { x: 100, y: 100, w: 40, h: 20 }, 0);
    expect(pieceAt([below, clear], new Scene([below, clear], 0), { x: 110, y: 105 })?.id).toBe('below');
    expect(pieceAt([below, clear], new Scene([below, clear], 0), { x: 300, y: 105 })).toBeNull();
  });
});
