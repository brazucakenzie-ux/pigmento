import { beforeEach, describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { applyPreset, cleanTrail, makeTrail, MAX_TRAILS, TRAIL_PRESETS } from '@engine/anim/trail';

const img = (w: number, h: number) => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

describe('trails on a piece', () => {
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

  const rocket = () => anim.add(img(60, 20), { x: 10, y: 10, w: 60, h: 20 }, doc.layers[0].id)!;
  const trailsOf = (id: string) => anim.piece(id)!.trails;

  it('are added as Rocket smoke from the middle, up to four, each an undo step', () => {
    const p = rocket();
    const steps = history.length;
    const id = anim.addTrail(p.id)!;
    expect(history.length).toBe(steps + 1);
    const t = trailsOf(p.id)[0];
    expect(t.id).toBe(id);
    expect(t.emitter).toEqual({ x: 30, y: 10 });
    expect(t).toMatchObject({ kind: 'puffs', brush: 'round-soft', rate: 40, spacing: 6 });
    for (let i = 1; i < MAX_TRAILS; i++) expect(anim.addTrail(p.id, 'sparkles')).not.toBeNull();
    expect(anim.addTrail(p.id)).toBeNull();
    expect(notices).toContain('notice.tooManyTrails');
    expect(trailsOf(p.id)).toHaveLength(MAX_TRAILS);
    history.undo();
    expect(trailsOf(p.id)).toHaveLength(MAX_TRAILS - 1);
  });

  it('are reordered, changed in range, made over as presets and removed', () => {
    const p = rocket();
    const a = anim.addTrail(p.id)!;
    const b = anim.addTrail(p.id, 'cometTail')!;
    expect(anim.moveTrail(p.id, b, -1)).toBe(true);
    expect(trailsOf(p.id).map((t) => t.id)).toEqual([b, a]);
    expect(anim.moveTrail(p.id, b, -1)).toBe(false);
    // Numbers kept in range; colours 2 to 4, in order.
    anim.setTrail(p.id, a, { rate: 1e9, lifetime: 0, size: -5, opacity: 3, driftAngle: 7, colors: [0.9, 0.1, 0.5, 0.3, 0.7].map((pos) => ({ pos, color: { r: 300, g: -4, b: 10, a: 255 } })) });
    const t = trailsOf(p.id).find((x) => x.id === a)!;
    expect(t).toMatchObject({ rate: 1000, lifetime: 0.05, size: 1, opacity: 1 });
    expect(t.driftAngle).toBeCloseTo(7 - 2 * Math.PI, 12);
    expect(t.colors.map((c) => c.pos)).toEqual([0.1, 0.3, 0.5, 0.9]);
    expect(t.colors[0].color).toEqual({ r: 255, g: 0, b: 10, a: 255 });
    // A preset keeps where it comes from, its keys and its seed.
    anim.setTrail(p.id, a, { emitter: { x: 2, y: 3 } });
    anim.keyEmission(p.id, a, 5, 0);
    const before = trailsOf(p.id).find((x) => x.id === a)!;
    expect(anim.presetTrail(p.id, a, 'speedLines')).toBe(true);
    const after = trailsOf(p.id).find((x) => x.id === a)!;
    expect(after).toMatchObject({ emitter: { x: 2, y: 3 }, seed: before.seed, keys: before.keys, stretch: true, brush: 'round-hard' });
    expect(anim.removeTrail(p.id, a)).toBe(true);
    expect(trailsOf(p.id).map((x) => x.id)).toEqual([b]);
  });

  it('have their emission keyed at a frame, shown in the options', () => {
    const p = rocket();
    const id = anim.addTrail(p.id)!;
    anim.select(p.id);
    expect(anim.fields()!.trails[0]).toMatchObject({ id, emission: 1, keyed: false });
    expect(anim.keyEmission(p.id, id, 0, 0, 'hold')).toBe(true);
    expect(anim.keyEmission(p.id, id, 10, 1)).toBe(true);
    // A new key goes on as the key before it does.
    expect(trailsOf(p.id)[0].keys).toEqual([
      { frame: 0, amount: 0, easing: 'hold' },
      { frame: 10, amount: 1, easing: 'hold' },
    ]);
    anim.setFrame(5);
    expect(anim.fields()!.trails[0]).toMatchObject({ emission: 0, keyed: false });
    anim.setFrame(10);
    expect(anim.fields()!.trails[0]).toMatchObject({ emission: 1, keyed: true });
    expect(anim.removeEmissionKey(p.id, id, 10)).toBe(true);
    expect(anim.removeEmissionKey(p.id, id, 10)).toBe(false);
    expect(trailsOf(p.id)[0].keys).toHaveLength(1);
  });

  it('move their emitter by dragging, one undo step', () => {
    const p = rocket();
    const id = anim.addTrail(p.id)!;
    const steps = history.length;
    anim.beginDrag();
    anim.preview(p.id, (q) => (q.trails = q.trails.map((t) => (t.id === id ? { ...t, emitter: { x: 0, y: 10 } } : t))));
    anim.preview(p.id, (q) => (q.trails = q.trails.map((t) => (t.id === id ? { ...t, emitter: { x: 1, y: 10 } } : t))));
    expect(anim.endDrag('history.trailEmitter')).toBe(true);
    expect(history.length).toBe(steps + 1);
    expect(trailsOf(p.id)[0].emitter).toEqual({ x: 1, y: 10 });
    history.undo();
    expect(trailsOf(p.id)[0].emitter).toEqual({ x: 30, y: 10 });
  });

  it('come with copies of the piece, and every preset is a trail that makes sense', () => {
    const p = rocket();
    anim.addTrail(p.id);
    const copy = anim.duplicate(p.id)!;
    expect(anim.piece(copy)!.trails).toHaveLength(1);
    expect(anim.piece(copy)!.trails[0]).not.toBe(anim.piece(p.id)!.trails[0]);
    for (const preset of TRAIL_PRESETS) {
      const t = applyPreset(makeTrail('x', 'puffs', { x: 0, y: 0 }, 1), preset);
      expect(cleanTrail(t)).toEqual(t);
    }
  });
});
