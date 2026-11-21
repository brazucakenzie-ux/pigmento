import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { attach, detach } from '@engine/anim/links';
import { makeGroup, makePiece, setKey, type Piece } from '@engine/anim/piece';
import { Scene } from '@engine/anim/scene';
import { FLAT_SPACE } from '@engine/anim/space';
import { cleanSpin, fitSpin, moveSpinKey, removeSpinKey, setSpinKey, spinKeyFrame, spinSpeedAt, spunAt, type Spin, type SpinKey } from '@engine/anim/spin';
import type { Easing } from '@engine/anim/interpolate';

const TAU = 2 * Math.PI;
const img = { w: 10, h: 10, data: new Uint8ClampedArray(400) };
const key = (frame: number, spin: number, easing: Easing = 'linear', tilt = 0, turn = 0): SpinKey => ({ frame, spin, tilt, turn, easing });
const spin = (...keys: SpinKey[]): Spin => ({ keys });
/** A piece that doesn't move, spinning as given. */
function spinner(s: Spin | null, id = 'p'): Piece {
  const p = makePiece(id, '', 'L', img, { x: 0, y: 0, w: 10, h: 10 }, 0);
  p.spin = s;
  return p;
}
const motion = (fps: number) => ({ paths: null, fps });

describe('spin speeds', () => {
  it('hold before the first key and after the last, and ease between', () => {
    const s = spin(key(10, 1, 'linear'), key(20, 3, 'hold'));
    expect(spinSpeedAt(s, 0).spin).toBe(1);
    expect(spinSpeedAt(s, 15).spin).toBe(2);
    expect(spinSpeedAt(s, 40).spin).toBe(3);
    expect(spinSpeedAt(spin(key(0, 1, 'hold'), key(10, 3)), 9.9).spin).toBe(1);
  });

  it('add up to the turn so far: steady, ramped, eased or held, never jumping', () => {
    // One turn a second at 12 frames a second.
    expect(spunAt(spinner(spin(key(0, 1))), 12, 12).spin).toBeCloseTo(1, 12);
    expect(spunAt(spinner(spin(key(0, 1))), 6, 12).spin).toBeCloseTo(0.5, 12);
    expect(spunAt(spinner(spin(key(0, -2))), 12, 12).spin).toBeCloseTo(-2, 12);
    // Before the first frame it went at the speed there.
    expect(spunAt(spinner(spin(key(0, 1))), -6, 12).spin).toBeCloseTo(-0.5, 12);
    // Speeding up from 0 to 1 turn a second over a second: half a turn.
    expect(spunAt(spinner(spin(key(0, 0), key(12, 1))), 12, 12).spin).toBeCloseTo(0.5, 9);
    expect(spunAt(spinner(spin(key(0, 0, 'easeInOut'), key(12, 1))), 12, 12).spin).toBeCloseTo(0.5, 4);
    // A held speed jumps, but the turn doesn't.
    const held = spinner(spin(key(0, 0, 'hold'), key(12, 4)));
    expect(spunAt(held, 12, 12).spin).toBeCloseTo(0, 9);
    expect(spunAt(held, 12.5, 12).spin - spunAt(held, 12, 12).spin).toBeCloseTo(4 / 24, 9);
    // Fractions of a frame land between.
    const ramp = spinner(spin(key(0, 0), key(24, 2)));
    const a = spunAt(ramp, 7, 12).spin;
    const b = spunAt(ramp, 8, 12).spin;
    const mid = spunAt(ramp, 7.5, 12).spin;
    expect(mid).toBeGreaterThan(a);
    expect(mid).toBeLessThan(b);
    // Each axis on its own.
    const all = spunAt(spinner(spin(key(0, 1, 'linear', 0.5, -0.25))), 24, 12);
    expect([all.spin, all.tilt, all.turn].map((v) => Math.round(v * 1e9) / 1e9)).toEqual([2, 1, -0.5]);
  });

  it('loop with a looping piece’s moves, the turn going on adding up', () => {
    const p = spinner(spin(key(0, 0), key(10, 1)));
    p.keyframes = setKey(p.keyframes, 10, { x: 50 });
    p.loop = 'loop';
    expect(spunAt(p, 20, 12).spin).toBeCloseTo(2 * spunAt(p, 10, 12).spin, 9);
    expect(spunAt(p, 25, 12).spin).toBeCloseTo(2 * spunAt(p, 10, 12).spin + spunAt(p, 5, 12).spin, 9);
    // A speed keyed on a repeat goes on the frame it repeats.
    expect(spinKeyFrame(p, 17)).toBe(7);
    p.loop = 'off';
    expect(spinKeyFrame(p, 17)).toBe(17);
  });

  it('are keyed, moved and removed one a frame', () => {
    const s = setSpinKey(null, 5, { spin: 2 });
    expect(s.keys).toEqual([key(5, 2)]);
    // A new key starts from the speed there, with the easing of the stretch it splits.
    const t = setSpinKey(setSpinKey(s, 15, { spin: 4, easing: 'easeOut' }), 25, { turn: 1 });
    expect(t.keys.map((k) => [k.frame, k.spin, k.turn, k.easing])).toEqual([
      [5, 2, 0, 'linear'],
      [15, 4, 0, 'easeOut'],
      [25, 4, 1, 'easeOut'],
    ]);
    expect(moveSpinKey(t, 15, 25)).toBeNull();
    expect(moveSpinKey(t, 15, 30)!.keys.map((k) => k.frame)).toEqual([5, 25, 30]);
    expect(removeSpinKey(t, 7)).toBeUndefined();
    expect(removeSpinKey(spin(key(3, 1)), 3)).toBeNull();
    // Out of range comes in range.
    expect(cleanSpin(spin(key(-2, 1e9), key(4.4, Number.NaN)))!.keys).toEqual([key(0, 100), key(4, 0)]);
  });
});

describe('spinning pieces', () => {
  it('turn on top of their keyframes, in 2D and 3D', () => {
    const p = spinner(spin(key(0, 0.25, 'linear', 0.5, 1)));
    p.keyframes = setKey(p.keyframes, 0, { angle: 0.1, tilt: 0.2 });
    const s = new Scene([p], 6, FLAT_SPACE, motion(12)).stateAt(p, 6);
    expect(s.angle).toBeCloseTo(0.1 + TAU / 8, 12);
    expect(s.tilt).toBeCloseTo(0.2 + TAU / 4, 12);
    expect(s.turn).toBeCloseTo(TAU / 2, 12);
    // Its keyframes are untouched.
    expect(p.keyframes[0].angle).toBe(0.1);
  });

  it('carry the pieces in a group round with them', () => {
    const g = makeGroup('g', '', 'L', { x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0 }, [{ ...makePiece('x', '', 'L', img, { x: 0, y: 0, w: 1, h: 1 }, 0).keyframes[0], x: 0, y: 0 }]);
    g.spin = spin(key(0, 0.25));
    const blade = makePiece('b', '', 'L', img, { x: 0, y: 0, w: 10, h: 10 }, 0);
    blade.link = { parent: 'g', hinge: null };
    blade.keyframes = setKey(blade.keyframes, 0, { x: 100, y: 0 });
    // A quarter turn after a second: the blade's pivot has swung from the right to straight down.
    const scene = new Scene([g, blade], 12, FLAT_SPACE, motion(12));
    const at = scene.worldOf(blade, blade.pivot);
    expect(at[0]).toBeCloseTo(0, 9);
    expect(at[1]).toBeCloseTo(100, 9);
  });

  it('fit to the timeline turn a whole number of times, so a loop runs on without a jump', () => {
    // 0.3 turns a second over 48 frames at 12 a second is 1.2 turns: fitted, one.
    const p = spinner(spin(key(0, 0.3)));
    const fit = fitSpin(p, 48, 12)!;
    expect(fit.keys[0].spin).toBeCloseTo(0.25, 12);
    p.spin = fit;
    const at = (f: number) => new Scene([p], f, FLAT_SPACE, motion(12)).stateAt(p, f).angle;
    expect(at(48) - at(0)).toBeCloseTo(TAU, 9);
    // The last frame is one step short of where it started.
    expect(at(0) + TAU - at(47)).toBeCloseTo(TAU / 48, 9);
    // Keyed speeds scale alike; a slow one goes round at least once, backwards too; a still axis stays still.
    const ramp = fitSpin(spinner(spin(key(0, 0), key(24, -0.1, 'linear', 0, 0))), 48, 12)!;
    expect(spunAt(spinner(ramp), 48, 12).spin).toBeCloseTo(-1, 9);
    expect(ramp.keys.map((k) => k.tilt)).toEqual([0, 0]);
    expect(fitSpin(spinner(null), 48, 12)).toBeNull();
  });

  it('stay put on every keyframe when they follow another piece or let go of it', () => {
    const parent = makePiece('a', '', 'L', img, { x: 0, y: 0, w: 10, h: 10 }, 0);
    const p = spinner(spin(key(0, 0.5)), 'p');
    p.keyframes = setKey(setKey(p.keyframes, 0, { x: 40, y: 0 }), 12, { x: 80, y: 0 });
    const linked = attach([parent, p], 'p', 'a', 0, FLAT_SPACE, motion(12)) as Piece[];
    const q = linked.find((x) => x.id === 'p')!;
    // Its spin isn't baked into its keyframes, and it shows as it did.
    expect(q.keyframes.map((k) => Math.round(k.angle * 1e9) / 1e9)).toEqual([0, 0]);
    expect(q.spin).toEqual(p.spin);
    const before = new Scene([parent, p], 12, FLAT_SPACE, motion(12)).corners(p);
    const after = new Scene(linked, 12, FLAT_SPACE, motion(12)).corners(q);
    after.forEach((c, i) => expect([c.x, c.y].map((v) => Math.round(v * 1e6))).toEqual([before[i].x, before[i].y].map((v) => Math.round(v * 1e6))));
    const free = detach(linked, 'p', FLAT_SPACE, motion(12)).find((x) => x.id === 'p')!;
    expect(free.keyframes.map((k) => Math.round(k.angle * 1e9) / 1e9)).toEqual([0, 0]);
  });
});

describe('spin in the animation controller', () => {
  function setup() {
    const doc = new PaintDocument({ width: 100, height: 100 });
    const history = new History();
    const notices: string[] = [];
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: (_kind, k) => void notices.push(k),
      animationChanged: () => undefined,
    };
    const anim = new AnimationController(host);
    const p = anim.add(img, { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    return { doc, history, anim, p, notices };
  }

  it('key speeds as undo steps, never the piece’s keyframes', () => {
    const { history, anim, p } = setup();
    anim.select(p.id);
    expect(anim.fields()!.spin).toBeNull();
    expect(anim.setSpin(p.id, 0, { spin: 1 })).toBe(true);
    expect(anim.setSpin(p.id, 0, { spin: 1 })).toBe(false);
    expect(anim.setSpin(p.id, 24, { spin: 3, easing: 'easeIn' })).toBe(true);
    expect(anim.piece(p.id)!.keyframes.length).toBe(1);
    expect(anim.info().pieces[0].spinKeys).toEqual([
      { frame: 0, easing: 'linear' },
      { frame: 24, easing: 'easeIn' },
    ]);
    anim.setFrame(12);
    expect(anim.fields()!.spin).toMatchObject({ spin: 2, keyed: false, easing: 'linear', keys: [0, 24], at: 12 });
    expect(anim.moveSpinKey(p.id, 24, 30)).toBe(true);
    expect(anim.removeSpinKey(p.id, 0)).toBe(true);
    expect(anim.piece(p.id)!.spin!.keys.map((k) => k.frame)).toEqual([30]);
    history.undo();
    history.undo();
    history.undo();
    expect(anim.piece(p.id)!.spin!.keys.map((k) => [k.frame, k.spin])).toEqual([[0, 1]]);
    history.undo();
    expect(anim.piece(p.id)!.spin).toBeNull();
  });

  it('fit to the timeline and stop as undo steps', () => {
    const { doc, history, anim, p } = setup();
    doc.timeline.length = 48;
    doc.timeline.fps = 12;
    anim.setSpin(p.id, 0, { spin: 0.3 });
    expect(anim.fitSpin(p.id)).toBe(true);
    expect(anim.piece(p.id)!.spin!.keys[0].spin).toBeCloseTo(0.25, 12);
    // Already fitted: nothing to do.
    expect(anim.fitSpin(p.id)).toBe(false);
    expect(anim.stopSpin(p.id)).toBe(true);
    expect(anim.piece(p.id)!.spin).toBeNull();
    expect(anim.stopSpin(p.id)).toBe(false);
    history.undo();
    expect(anim.piece(p.id)!.spin!.keys[0].spin).toBeCloseTo(0.25, 12);
  });

  it('key a looping piece’s speed where its repeat is read, and refuse a hinged piece', () => {
    const { anim, p, notices } = setup();
    anim.setKey(p.id, 10, { x: 60 });
    anim.setPieceLoop(p.id, 'loop');
    anim.setSpin(p.id, 0, { spin: 1 });
    anim.setSpin(p.id, 17, { spin: 2 });
    expect(anim.piece(p.id)!.spin!.keys.map((k) => k.frame)).toEqual([0, 7]);
    anim.select(p.id);
    anim.setFrame(17);
    expect(anim.fields()!.spin).toMatchObject({ keyed: true, at: 7, spin: 2 });
    anim.piece(p.id)!.link = { parent: 'x', hinge: { edge: 'n', childEdge: 's', offset: 0, along: 1, across: 1 } };
    expect(anim.setSpin(p.id, 0, { spin: 5 })).toBe(false);
    expect(notices).toContain('notice.spinHinged');
  });

  it('keep a spinning piece in place on its keyframes when its pivot moves', () => {
    const { anim, p, doc } = setup();
    anim.setKey(p.id, 12, { x: 60 });
    anim.setSpin(p.id, 0, { spin: 0.125 });
    const corners = (f: number) => anim.scene(f).corners(doc.pieces[0]).map((c) => [Math.round(c.x * 1e6), Math.round(c.y * 1e6)]);
    const before = [corners(0), corners(12)];
    expect(anim.setPivot(p.id, { x: 0, y: 0 })).toBe(true);
    expect([corners(0), corners(12)]).toEqual(before);
  });
});
