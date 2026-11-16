import { beforeEach, describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { makePiece, moveKey, pieceBounds, pieceStateAt, removeKey, setKey } from '@engine/anim/piece';
import type { ImageBuf } from '@engine/raster/transform';

const img = (w: number, h: number): ImageBuf => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

describe('piece keyframes', () => {
  const base = makePiece('p', 'Ball', 'layer-1', img(20, 10), { x: 100, y: 50, w: 20, h: 10 }, 0);

  it('starts where it was lifted from, with the pivot in its middle', () => {
    expect(base.pivot).toEqual({ x: 10, y: 5 });
    expect(base.keyframes).toHaveLength(1);
    expect(pieceStateAt(base, 0)).toMatchObject({ x: 110, y: 55, sx: 1, sy: 1, angle: 0, opacity: 1 });
    expect(pieceBounds(base, 0)).toEqual({ x: 99, y: 49, w: 22, h: 12 });
  });

  it('auto-keys: adds a keyframe from what the piece shows there, or changes the one there', () => {
    let keys = setKey(base.keyframes, 10, { x: 210 });
    expect(keys.map((k) => k.frame)).toEqual([0, 10]);
    // A new keyframe between two starts from the in-between state and keeps the segment's easing.
    keys = setKey(keys.map((k) => (k.frame === 0 ? { ...k, easing: 'easeOut' } : k)), 5, { angle: 1 });
    expect(keys.map((k) => k.frame)).toEqual([0, 5, 10]);
    expect(keys[1].easing).toBe('easeOut');
    expect(keys[1].angle).toBe(1);
    expect(keys[1].x).toBeCloseTo(110 + 100 * (1 - 0.5 ** 3));
    // Changing an existing keyframe keeps everything else.
    keys = setKey(keys, 10, { opacity: 0.25 });
    expect(keys[2]).toMatchObject({ x: 210, opacity: 0.25 });
    // The originals are never changed.
    expect(base.keyframes).toHaveLength(1);
  });

  it('removes and moves keyframes, but never the last one or onto a taken frame', () => {
    const keys = setKey(setKey(base.keyframes, 10, { x: 210 }), 20, { x: 0 });
    expect(removeKey(keys, 10)!.map((k) => k.frame)).toEqual([0, 20]);
    expect(removeKey(base.keyframes, 0)).toBeNull();
    expect(removeKey(keys, 7)).toBeNull();
    expect(moveKey(keys, 10, 25)!.map((k) => k.frame)).toEqual([0, 20, 25]);
    expect(moveKey(keys, 10, 20)).toBeNull();
    expect(moveKey(keys, 3, 4)).toBeNull();
    expect(moveKey(keys, 10, -1)).toBeNull();
  });
});

describe('AnimationController', () => {
  let doc: PaintDocument;
  let history: History;
  let changes: number;
  let notices: string[];
  let anim: AnimationController;

  beforeEach(() => {
    doc = new PaintDocument({ width: 400, height: 300 });
    history = new History();
    changes = 0;
    notices = [];
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: (_kind, key) => notices.push(key),
      animationChanged: () => changes++,
    };
    anim = new AnimationController(host);
    anim.namer = (n) => `Piece ${n}`;
  });

  const addOne = () => anim.add(img(10, 10), { x: 20, y: 30, w: 10, h: 10 }, doc.layers[0].id)!;

  it('adds a named, selected piece as one undo step', () => {
    const p = addOne();
    expect(p.name).toBe('Piece 1');
    expect(anim.selected?.id).toBe(p.id);
    expect(anim.animated).toBe(true);
    expect(history.length).toBe(1);
    history.undo();
    expect(doc.pieces).toHaveLength(0);
    history.redo();
    expect(doc.pieces[0].id).toBe(p.id);
    expect(changes).toBeGreaterThan(0);
  });

  it('keys a piece at the current frame and undoes keyframe edits', () => {
    const p = addOne();
    anim.setFrame(12);
    expect(anim.frame).toBe(12);
    expect(anim.setKey(p.id, anim.frame, { x: 300, sx: 2 })).toBe(true);
    expect(history.entries().at(-1)!.label).toBe('history.keyframeAdd');
    expect(pieceStateAt(anim.piece(p.id)!, 6)).toMatchObject({ x: 25 + (300 - 25) / 2, sx: 1.5 });
    expect(anim.moveKey(p.id, 12, 18)).toBe(true);
    expect(anim.piece(p.id)!.keyframes.map((k) => k.frame)).toEqual([0, 18]);
    history.undo();
    history.undo();
    expect(anim.piece(p.id)!.keyframes.map((k) => k.frame)).toEqual([0]);
    // Frames are clamped to the timeline.
    anim.setFrame(999);
    expect(anim.frame).toBe(23);
  });

  it('turns a drag into one undo step, or none if nothing changed', () => {
    const p = addOne();
    const steps = history.length;
    anim.beginDrag();
    for (let i = 1; i <= 5; i++) anim.preview(p.id, (q) => (q.keyframes[0].x = 25 + i * 10));
    expect(anim.endDrag('history.keyframe')).toBe(true);
    expect(history.length).toBe(steps + 1);
    expect(anim.piece(p.id)!.keyframes[0].x).toBe(75);
    anim.beginDrag();
    expect(anim.endDrag('history.keyframe')).toBe(false);
    history.undo();
    expect(anim.piece(p.id)!.keyframes[0].x).toBe(25);
    // Esc during a drag puts it back.
    anim.beginDrag();
    anim.preview(p.id, (q) => (q.keyframes[0].x = 999));
    anim.cancelDrag();
    expect(anim.piece(p.id)!.keyframes[0].x).toBe(25);
  });

  it('renames, moves the pivot without moving the piece, and deletes', () => {
    const p = addOne();
    expect(anim.rename(p.id, '  Ball  ')).toBe(true);
    expect(anim.piece(p.id)!.name).toBe('Ball');
    expect(anim.rename(p.id, 'Ball')).toBe(false);
    anim.setPivot(p.id, { x: 0, y: 0 });
    expect(anim.piece(p.id)!.pivot).toEqual({ x: 0, y: 0 });
    expect(pieceBounds(anim.piece(p.id)!, 0)).toEqual({ x: 19, y: 29, w: 12, h: 12 });
    expect(anim.remove(p.id)).toBe(true);
    expect(anim.selected).toBeNull();
    history.undo();
    expect(anim.piece(p.id)?.name).toBe('Ball');
  });

  it('changes the timeline as an undo step and keeps the frame inside it', () => {
    anim.setFrame(20);
    expect(anim.setTimeline({ length: 10, fps: 24, loop: 'pingpong' })).toBe(true);
    expect(doc.timeline).toMatchObject({ length: 10, fps: 24, loop: 'pingpong', frame: 9 });
    expect(anim.setTimeline({ length: 10 })).toBe(false);
    history.undo();
    expect(doc.timeline).toMatchObject({ length: 24, fps: 12, loop: 'loop' });
  });

  it('refuses more pieces than the limit', () => {
    for (let i = 0; i < 500; i++) doc.pieces.push(makePiece(`x${i}`, '', doc.layers[0].id, img(1, 1), { x: 0, y: 0, w: 1, h: 1 }, 0));
    expect(anim.canAdd()).toBe(false);
    expect(addOne()).toBeNull();
    expect(notices).toContain('notice.tooManyPieces');
  });

  it('counts a piece’s pixels in history only when a step adds or removes it', () => {
    const p = anim.add(img(100, 100), { x: 0, y: 0, w: 100, h: 100 }, doc.layers[0].id)!;
    const added = history.bytes;
    expect(added).toBeGreaterThanOrEqual(40000);
    anim.setKey(p.id, 5, { x: 1 });
    expect(history.bytes - added).toBeLessThan(2000);
  });
});
