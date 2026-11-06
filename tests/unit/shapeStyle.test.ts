import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { loadProject, saveProject, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { optionsOfStyle, styleExtrasOf } from '@engine/tools/shapeTools';
import { addImageAsset, assetIdFor, imageAsset } from '@engine/vector/assets';
import type { VectorShape } from '@engine/vector/model';
import { arrowHead, arrowLength, dashArray, gradientStops, linearEnds, outlineReach } from '@engine/vector/style';

const rawCodec: PngCodec = {
  async encode(data, w, h) {
    const out = new Uint8Array(8 + data.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(data, 8);
    return out;
  },
  async decode(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(0), h: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

const RED = { r: 215, g: 38, b: 61, a: 255 };
const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const base: ShapeStyle = { mode: 'both', width: 4, outline: RED, fill: BLUE, radius: 0, antialias: true };

describe('outline helpers', () => {
  it('scales dashes with the width and leaves room for round ends', () => {
    expect(dashArray(undefined, 4, 'butt')).toEqual([]);
    expect(dashArray('solid', 4, 'butt')).toEqual([]);
    expect(dashArray('dash', 4, 'butt')).toEqual([12, 8]);
    expect(dashArray('dash', 4, 'round')).toEqual([8, 12]);
    expect(dashArray('dot', 4, 'butt')).toEqual([4, 4]);
    expect(dashArray('dot', 4, 'round')[1]).toBe(8);
    expect(dashArray('dashDot', 2, 'butt')).toHaveLength(4);
  });

  it('knows how far an outline reaches past the shape', () => {
    expect(outlineReach(10, 'round', false)).toBe(5);
    expect(outlineReach(10, 'miter', false)).toBe(20);
    expect(outlineReach(2, 'round', true)).toBe(arrowLength(2));
  });

  it('builds arrowheads at the tip, pointing along the line', () => {
    const tip = { x: 100, y: 50 };
    const tri = arrowHead('triangle', tip, { x: 1, y: 0 }, 2)!;
    expect(tri.closed).toBe(true);
    expect(tri.points[0]).toEqual(tip);
    const len = arrowLength(2);
    expect(tri.points[1].x).toBeCloseTo(100 - len);
    expect(Math.abs(tri.points[1].y - 50)).toBeCloseTo(len / 2);
    expect(tri.inset).toBeGreaterThan(0);
    const open = arrowHead('open', tip, { x: 0, y: 1 }, 2)!;
    expect(open.closed).toBe(false);
    expect(open.points[1]).toEqual(tip);
    expect(open.inset).toBe(0);
    expect(arrowHead('none', tip, { x: 1, y: 0 }, 2)).toBeNull();
    for (const p of arrowHead('circle', tip, { x: 1, y: 0 }, 2)!.points) expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('uses outline → fill colours unless the gradient has its own, in order', () => {
    expect(gradientStops(undefined, RED, BLUE)).toEqual([
      { pos: 0, color: RED },
      { pos: 1, color: BLUE },
    ]);
    const own = gradientStops({ type: 'linear', angle: 0, stops: [{ pos: 1, color: RED }, { pos: 0.2, color: BLUE }] }, RED, BLUE);
    expect(own.map((s) => s.pos)).toEqual([0.2, 1]);
  });

  it('spans the box with a linear gradient at any angle', () => {
    const [s0, s1] = linearEnds(0, 0, 100, 40, 0);
    expect([s0.x, s0.y + 0, s1.x, s1.y + 0]).toEqual([-50, 0, 50, 0]);
    const [a, b] = linearEnds(0, 0, 100, 40, 90);
    expect(a.y).toBeCloseTo(-20);
    expect(b.y).toBeCloseTo(20);
  });
});

describe('style options', () => {
  it('keep only what is in use', () => {
    expect(styleExtrasOf({ fillKind: 'solid', outlineKind: 'solid', dash: 'solid', arrowStart: 'none', arrowEnd: 'none' })).toEqual({});
    expect(styleExtrasOf({ fillKind: 'pattern', fillPattern: 'dots', fillPatternScale: 3, fillGradientType: 'radial' })).toEqual({
      fillKind: 'pattern',
      fillPattern: { id: 'dots', scale: 3 },
    });
    // A picture fill without a picture stays a colour fill.
    expect(styleExtrasOf({ fillKind: 'image', fillImage: '' })).toEqual({ fillKind: 'image' });
  });

  it('round-trip a shape style through the Move tool options', () => {
    const style: ShapeStyle = {
      ...base,
      fillKind: 'gradient',
      fillGradient: { type: 'angular', angle: 45, stops: [{ pos: 0, color: RED }, { pos: 1, color: { r: 0, g: 0, b: 0, a: 0 } }] },
      outlineKind: 'gradient',
      outlineGradient: { type: 'linear', angle: 90, stops: null },
      dash: 'dashDot',
      cap: 'round',
      join: 'bevel',
      arrowEnd: 'triangle',
    };
    const o = optionsOfStyle(style, { cap: 'round', join: 'bevel' }, true);
    expect(o.hasLines).toBe(true);
    const { mode, width, outline, fill, radius, antialias, ...extras } = style;
    expect([mode, width, outline, fill, radius, antialias]).toBeTruthy();
    expect(styleExtrasOf(o)).toEqual(extras);
  });
});

describe('styled shapes in .pigm', () => {
  it('keep gradients, patterns, dashes, ends, corners and arrowheads', async () => {
    const styled: VectorShape[] = [
      {
        type: 'shape',
        id: 'a',
        shape: 'rect',
        box: { cx: 50, cy: 50, w: 60, h: 40, angle: 0.5 },
        points: [],
        style: { ...base, fillKind: 'gradient', fillGradient: { type: 'radial', angle: 0, stops: [{ pos: 0, color: RED }, { pos: 0.5, color: BLUE }] }, dash: 'dash', join: 'bevel' },
      },
      { type: 'shape', id: 'b', shape: 'ellipse', box: { cx: 20, cy: 20, w: 20, h: 20, angle: 0 }, points: [], style: { ...base, fillKind: 'pattern', fillPattern: { id: 'dots', scale: 2 }, outlineKind: 'gradient', outlineGradient: { type: 'linear', angle: 30, stops: null } } },
      { type: 'shape', id: 'c', shape: 'line', box: null, points: [{ x: 1, y: 1 }, { x: 80, y: 60 }], style: { ...base, mode: 'outline', cap: 'square', arrowStart: 'circle', arrowEnd: 'open' } },
    ];
    const doc = new PaintDocument({ width: 100, height: 100 }, [new VectorLayer('S', 100, 100, styled)]);
    const back = await loadProject(await saveProject(doc, rawCodec), rawCodec);
    const l = back.layers[0];
    if (l.kind !== 'vector') throw new Error('not a shape layer');
    expect(l.objects).toEqual(styled);
  });

  it('store the pictures image fills use, once each, and bring them back', async () => {
    const w = 3;
    const h = 2;
    const data = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37) % 256);
    const id = addImageAsset(w, h, data);
    expect(id).toBe(assetIdFor(w, h, data));
    expect(addImageAsset(w, h, data)).toBe(id);
    const pic = (sid: string, cx: number): VectorShape => ({ type: 'shape', id: sid, shape: 'ellipse', box: { cx, cy: 30, w: 30, h: 20, angle: 0 }, points: [], style: { ...base, fillKind: 'image', fillImage: id } });
    const doc = new PaintDocument({ width: 100, height: 100 }, [new VectorLayer('S', 100, 100, [pic('p1', 20), pic('p2', 60)])]);
    const bytes = await saveProject(doc, rawCodec);
    const names = Object.keys(unzipSync(bytes));
    expect(names.filter((n) => n.startsWith('assets/'))).toEqual(['assets/0001.png']);
    const back = await loadProject(bytes, rawCodec);
    const l = back.layers[0];
    if (l.kind !== 'vector') throw new Error('not a shape layer');
    expect(l.objects).toEqual(doc.layers[0].kind === 'vector' ? doc.layers[0].objects : []);
    expect(imageAsset(id)?.data).toEqual(data);
  });

  it('reject a picture whose pixels do not match its size', async () => {
    const id = addImageAsset(2, 2, new Uint8ClampedArray(16).fill(200));
    const s: VectorShape = { type: 'shape', id: 'x', shape: 'rect', box: { cx: 5, cy: 5, w: 4, h: 4, angle: 0 }, points: [], style: { ...base, fillKind: 'image', fillImage: id } };
    const bytes = await saveProject(new PaintDocument({ width: 10, height: 10 }, [new VectorLayer('S', 10, 10, [s])]), rawCodec);
    const lying: PngCodec = { ...rawCodec, decode: async (b) => ({ ...(await rawCodec.decode(b)), w: 3 }) };
    await expect(loadProject(bytes, lying)).rejects.toThrow();
  });
});
