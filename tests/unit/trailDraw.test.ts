import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';
import { frameExtras } from '@engine/anim/pieceRaster';
import { applyPreset, makeTrail, type Trail } from '@engine/anim/trail';
import { paintPuffs, pieceTrailsAt, puffBounds, puffTip, TIP_SIZE, type PuffQuad } from '@engine/anim/trailDraw';

const view = (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), stride: w, ox: 0, oy: 0 });
const px = (v: ReturnType<typeof view>, x: number, y: number) => Array.from(v.data.subarray((y * v.stride + x) * 4, (y * v.stride + x) * 4 + 4));
const RED = { r: 255, g: 0, b: 0, a: 255 };

/** A puff 2·len long along `angle` and 2·wid across. */
function puff(x: number, y: number, len: number, wid: number, angle: number, alpha = 1): PuffQuad {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x, y, ax: c * len, ay: s * len, bx: -s * wid, by: c * wid, color: RED, alpha };
}

describe('puffs on the CPU', () => {
  it('are the tip’s coverage in their colour, laid over what is there', () => {
    const tip = puffTip('no-such-brush');
    expect(tip.w).toBe(TIP_SIZE);
    const v = view(64, 64);
    paintPuffs(v, { x: 0, y: 0, w: 64, h: 64 }, [puff(32, 32, 10, 10, 0, 0.5)], tip);
    // Soft in the middle (a soft round tip), half opacity, nothing outside it.
    const mid = px(v, 32, 32);
    expect(mid[0]).toBe(255);
    expect(mid[3]).toBeGreaterThan(90);
    expect(mid[3]).toBeLessThanOrEqual(128);
    expect(px(v, 32, 44)[3]).toBe(0);
    expect(px(v, 5, 5)[3]).toBe(0);
    // Only inside the area asked for.
    const part = view(64, 64);
    paintPuffs(part, { x: 0, y: 0, w: 32, h: 64 }, [puff(32, 32, 10, 10, 0)], tip);
    expect(px(part, 33, 32)[3]).toBe(0);
    expect(px(part, 30, 32)[3]).toBeGreaterThan(0);
  });

  it('stretch along their angle', () => {
    const tip = puffTip('no-such-brush');
    const v = view(100, 100);
    // 40 long, turned a quarter (pointing down), 8 wide.
    paintPuffs(v, { x: 0, y: 0, w: 100, h: 100 }, [puff(50, 50, 20, 4, Math.PI / 2)], tip);
    expect(px(v, 50, 62)[3]).toBeGreaterThan(0);
    expect(px(v, 62, 50)[3]).toBe(0);
    const b = puffBounds(puff(50, 50, 20, 4, Math.PI / 2));
    expect(b.h).toBeGreaterThan(b.w);
  });
});

describe('trails as drawn', () => {
  /** A piece moving left to right across 200 px over 20 frames, with a trail from its middle. */
  function doc(trail: Partial<Trail>, depth = 0): { d: PaintDocument; p: Piece } {
    const d = new PaintDocument({ width: 400, height: 200 });
    const p = makePiece('p', '', d.layers[0].id, { w: 20, h: 10, data: new Uint8ClampedArray(800).fill(255) }, { x: 0, y: 0, w: 20, h: 10 }, 0);
    p.keyframes = setKey(setKey(p.keyframes, 0, { x: 100, y: 100, depth, easing: 'linear' }), 20, { x: 300, y: 100, depth });
    p.trails = [{ ...applyPreset(makeTrail('t', 'puffs', { x: 10, y: 5 }, 3), 'rocketSmoke'), drift: 0, spread: 0, ...trail }];
    d.pieces = [p];
    return { d, p };
  }

  it('lay puffs where the emitter went, sized as the camera sees them', () => {
    const { d, p } = doc({ rate: 0, spacing: 20, growth: 1, size: 10 });
    const [flat] = pieceTrailsAt(d, p, 10);
    expect(flat.puffs.length).toBeGreaterThan(3);
    for (const q of flat.puffs) {
      expect(q.y).toBeCloseTo(100, 6);
      expect(q.x).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(q.x).toBeLessThanOrEqual(200 + 1e-6);
      expect(Math.hypot(q.bx, q.by)).toBeCloseTo(5, 6);
    }
    // Pushed back in 3D: smaller, by the camera's scale there.
    const deep = doc({ rate: 0, spacing: 20, growth: 1, size: 10 }, 500);
    const [far] = pieceTrailsAt(deep.d, deep.p, 10);
    const space = deep.d.spaceAt(10);
    for (const q of far.puffs) expect(Math.hypot(q.bx, q.by)).toBeCloseTo((5 * space.f) / (space.f + 500), 6);
  });

  it('show in the picture’s pixels too, behind the piece, even where the piece isn’t', () => {
    const { d } = doc({ rate: 0, spacing: 4, size: 16, growth: 1, opacity: 1, fade: 0, colors: [{ pos: 0, color: RED }, { pos: 1, color: RED }] });
    const extras = frameExtras(d, 15)!;
    const layer = d.layers[0];
    // Far behind the piece, only the trail is there.
    expect(extras.covers(layer, { x: 150, y: 90, w: 10, h: 20 })).toBe(true);
    const v = { data: new Uint8ClampedArray(400 * 200 * 4), stride: 400, ox: 0, oy: 0 };
    extras.draw(layer, { x: 0, y: 0, w: 400, h: 200 }, v);
    expect(px(v as ReturnType<typeof view>, 160, 100)[0]).toBe(255);
    expect(px(v as ReturnType<typeof view>, 160, 100)[1]).toBe(0);
    // The piece (white) sits over its own trail.
    expect(px(v as ReturnType<typeof view>, 250, 100)).toEqual([255, 255, 255, 255]);
    expect(px(v as ReturnType<typeof view>, 160, 150)[3]).toBe(0);
  });

  it('draw an echo as the piece where it was', () => {
    const { d } = doc({ kind: 'echo', copies: 2, gap: 5, opacity: 1, fade: 0 });
    const v = { data: new Uint8ClampedArray(400 * 200 * 4), stride: 400, ox: 0, oy: 0 };
    frameExtras(d, 15)!.draw(d.layers[0], { x: 0, y: 0, w: 400, h: 200 }, v);
    // The piece now (x = 250), and copies at frames 10 and 5 (x = 200 and 150).
    for (const x of [250, 200, 150]) expect(px(v as ReturnType<typeof view>, x, 100)[3]).toBe(255);
    expect(px(v as ReturnType<typeof view>, 120, 100)[3]).toBe(0);
  });
});
