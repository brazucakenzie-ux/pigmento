import { describe, expect, it } from 'vitest';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { documentToSvg, type SvgExportDeps } from '@engine/io/svgExport';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { hasTrimKeys, mapShapes, trimPart, type VectorShape } from '@engine/vector/model';
import { drawOnKeys, FULL_TRIM, moveTrimKey, removeTrimKey, setTrimKey, trimAt, type TrimKey } from '@engine/vector/trim';

const style: ShapeStyle = { mode: 'outline', width: 4, outline: { r: 215, g: 38, b: 61, a: 255 }, fill: { r: 30, g: 136, b: 229, a: 255 }, radius: 0, antialias: true };
const key = (frame: number, end: number, easing: TrimKey['easing'] = 'linear', start = 0, offset = 0): TrimKey => ({ frame, start, end, offset, easing });
const line = (id: string, extra: Partial<VectorShape> = {}): VectorShape => ({ type: 'shape', id, shape: 'line', box: null, points: [{ x: 0, y: 10 }, { x: 100, y: 10 }], style, ...extra });

describe('a trim keyed on the timeline', () => {
  const keys = [key(10, 0, 'linear'), key(20, 1, 'easeInOut'), key(30, 0.5, 'hold')];

  it('eases from key to key, and holds before the first and after the last', () => {
    expect(trimAt({ trimKeys: keys }, 0)).toEqual({ start: 0, end: 0, offset: 0 });
    expect(trimAt({ trimKeys: keys }, 15)!.end).toBeCloseTo(0.5, 12);
    // Ease in and out: slow at first.
    expect(trimAt({ trimKeys: keys }, 22)!.end).toBeGreaterThan(0.9);
    expect(trimAt({ trimKeys: keys }, 22)!.end).toBeLessThan(1);
    expect(trimAt({ trimKeys: keys }, 25)!.end).toBeCloseTo(0.75, 12);
    expect(trimAt({ trimKeys: keys }, 99)).toEqual({ start: 0, end: 0.5, offset: 0 });
    // Hold: no keys after it, so it stays.
    expect(trimAt({ trimKeys: [key(0, 0, 'hold'), key(10, 1)] }, 9)!.end).toBe(0);
    // The keys win over a trim set once; without keys the set one shows, or none.
    expect(trimAt({ trim: { start: 0.2, end: 0.4, offset: 0 }, trimKeys: keys }, 10)!.start).toBe(0);
    expect(trimAt({ trim: { start: 0.2, end: 0.4, offset: 0 } }, 10)).toEqual({ start: 0.2, end: 0.4, offset: 0 });
    expect(trimAt({}, 10)).toBeUndefined();
  });

  it('adds, changes, moves and removes keys, in frame order', () => {
    const added = setTrimKey(keys, 25, { end: 0.9 }, { start: 0.1, end: 0.2, offset: 0.3 });
    expect(added.map((k) => k.frame)).toEqual([10, 20, 25, 30]);
    // A new key starts from what shows there, and goes on as the key before it did.
    expect(added[2]).toEqual({ frame: 25, start: 0.1, end: 0.9, offset: 0.3, easing: 'easeInOut' });
    const changed = setTrimKey(keys, 20, { easing: 'hold' }, FULL_TRIM);
    expect(changed).toHaveLength(3);
    expect(changed[1]).toEqual({ ...keys[1], easing: 'hold' });
    expect(moveTrimKey(keys, 20, 5)!.map((k) => k.frame)).toEqual([5, 10, 30]);
    expect(moveTrimKey(keys, 20, 30)).toBeNull();
    expect(moveTrimKey(keys, 21, 22)).toBeNull();
    expect(removeTrimKey(keys, 20)!.map((k) => k.frame)).toEqual([10, 30]);
    expect(removeTrimKey(keys, 21)).toBeNull();
  });

  it('draws on or erases behind between two frames, keeping its offset and the keys outside', () => {
    const s = { trimKeys: [key(0, 1, 'linear', 0, 0.25), key(8, 0.5), key(40, 1)] };
    const on = drawOnKeys(s, 'drawOn', 15, 5, 'easeOut');
    expect(on.map((k) => k.frame)).toEqual([0, 5, 15, 40]);
    expect(on[1]).toMatchObject({ start: 0, end: 0, easing: 'easeOut' });
    expect(on[2]).toMatchObject({ start: 0, end: 1 });
    expect(on[1].offset).toBeCloseTo(trimAt(s, 5)!.offset, 12);
    const off = drawOnKeys({}, 'eraseBehind', 0, 23, 'linear');
    expect(off).toEqual([
      { frame: 0, start: 0, end: 1, offset: 0, easing: 'linear' },
      { frame: 23, start: 1, end: 1, offset: 0, easing: 'linear' },
    ]);
    expect(trimAt({ trimKeys: off }, 23)).toEqual({ start: 1, end: 1, offset: 0 });
    expect(drawOnKeys({}, 'drawOn', 7, 7, 'linear')).toHaveLength(1);
  });
});

describe('shapes with keyed trims', () => {
  it('are kept when remade, and found in groups', () => {
    const s = line('a', { trimKeys: [key(0, 0), key(5, 1)] });
    expect(trimPart(s)).toEqual({ trimKeys: s.trimKeys });
    expect(hasTrimKeys([line('b'), { type: 'group', id: 'g', children: [s] }])).toBe(true);
    expect(hasTrimKeys([line('b')])).toBe(false);
    const g = mapShapes({ type: 'group', id: 'g', children: [line('b'), line('c')] }, (x) => ({ ...x, trim: { start: 0, end: 0.5, offset: 0 } }));
    expect(g.type === 'group' && g.children.every((c) => c.type === 'shape' && c.trim?.end === 0.5)).toBe(true);
  });

  it('make their layer show the frame shown (and only a layer that has them redraws)', () => {
    const keyed = new VectorLayer('K', 100, 100, [line('a', { trimKeys: [key(0, 0), key(10, 1)] })]);
    const plain = new VectorLayer('P', 100, 100, [line('b')]);
    expect(keyed.keyed).toBe(true);
    expect(plain.keyed).toBe(false);
    const doc = new PaintDocument({ width: 100, height: 100 }, [plain, keyed]);
    expect(doc.hasTrimKeys).toBe(true);
    const v1 = keyed.version;
    const v2 = plain.version;
    doc.showFrame(5);
    expect(keyed.frame).toBe(5);
    expect(keyed.version).toBe(v1 + 1);
    expect(plain.version).toBe(v2);
    doc.showFrame(5);
    expect(keyed.version).toBe(v1 + 1);
    keyed.setObjects([line('a')]);
    expect(keyed.keyed).toBe(false);
    expect(doc.hasTrimKeys).toBe(false);
  });

  it('get a row in the timeline, and make the picture animated', () => {
    const doc = new PaintDocument({ width: 100, height: 100 });
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history: new History(),
      commitLive: () => undefined,
      notify: () => undefined,
      animationChanged: () => undefined,
    };
    const anim = new AnimationController(host);
    expect(anim.animated).toBe(false);
    const shapes = new VectorLayer('S', 100, 100, [line('a'), { type: 'group', id: 'g', children: [line('b', { trimKeys: [key(3, 0, 'easeIn'), key(9, 1)] })] }]);
    doc.layers.push(shapes);
    expect(anim.animated).toBe(true);
    expect(anim.info().shapes).toEqual([
      {
        layerId: shapes.id,
        id: 'b',
        n: 2,
        keys: [
          { frame: 3, easing: 'easeIn' },
          { frame: 9, easing: 'linear' },
        ],
      },
    ]);
  });

  it('export to SVG as they show at the frame shown', async () => {
    const deps: SvgExportDeps = { encodePng: async () => new Uint8Array([1]), patternTile: () => null };
    const s = line('a', { trimKeys: [key(0, 0), key(10, 1)] });
    const doc = new PaintDocument({ width: 100, height: 100, paper: null }, [new VectorLayer('S', 100, 100, [s])]);
    doc.timeline.frame = 5;
    expect(await documentToSvg(doc, deps)).toMatch(/<path d="M0 10L50 10" fill="none" stroke="#d7263d"/);
    doc.timeline.frame = 0;
    expect(await documentToSvg(doc, deps)).not.toContain('<path');
  });
});
