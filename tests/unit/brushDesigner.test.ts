import { describe, expect, it } from 'vitest';
import { addCurvePoint, CURVE_PRESETS, MAX_CURVE_POINTS, moveCurvePoint, removeCurvePoint, type Curve } from '@engine/brush/curve';
import { cropMask, editorMask, fitMask, invertMask, padSquare, paintMask, resizeMask, softenMask, textureFromImage, tipFromImage, TIP_EDITOR_SIZE } from '@engine/brush/masks';
import { BUILTIN_BRUSHES } from '@engine/brush/library';
import { BRUSH_FORMAT, BRUSH_FORMAT_VERSION, CustomBrushSchema, decodeMaskData, encodeMaskData } from '@shared/brushFormat';

const LINEAR: Curve = [
  [0, 0],
  [1, 1],
];

/** w×h RGBA, every pixel from `fn`. */
function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { w, h, data };
}

describe('response curves', () => {
  it('keeps the end points at the edges and the rest in order', () => {
    expect(moveCurvePoint(LINEAR, 0, 0.5, 0.3)).toEqual([
      [0, 0.3],
      [1, 1],
    ]);
    expect(moveCurvePoint(LINEAR, 1, 0.2, 2)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const { curve, index } = addCurvePoint(LINEAR, 0.5, 0.8);
    expect(index).toBe(1);
    expect(curve).toEqual([
      [0, 0],
      [0.5, 0.8],
      [1, 1],
    ]);
    const more = addCurvePoint(curve, 0.25, 0.1);
    expect(more.index).toBe(1);
    // A middle point can't pass its neighbours.
    expect(moveCurvePoint(more.curve, 1, 0.9, 0.5)[1]).toEqual([0.5, 0.5]);
    expect(removeCurvePoint(more.curve, 1)).toEqual(curve);
    expect(removeCurvePoint(more.curve, 0)).toBe(more.curve);
  });

  it('stops adding points at the limit', () => {
    let c: Curve = LINEAR;
    for (let i = 0; i < 30; i++) c = addCurvePoint(c, Math.random(), Math.random()).curve;
    expect(c).toHaveLength(MAX_CURVE_POINTS);
    expect(c.every((p, i) => i === 0 || p[0] >= c[i - 1][0])).toBe(true);
    expect(addCurvePoint(c, 0.5, 0.5).index).toBe(-1);
  });

  it('has presets that start at x = 0 and end at x = 1', () => {
    for (const p of CURVE_PRESETS) {
      expect(p.curve[0][0]).toBe(0);
      expect(p.curve[p.curve.length - 1][0]).toBe(1);
    }
  });
});

describe('tips and textures from pictures', () => {
  it('makes a tip from dark paint, cropped and centred in a square', () => {
    // A 10×4 black bar on white, in a 30×20 picture.
    const img = image(30, 20, (x, y) => (x >= 5 && x < 15 && y >= 8 && y < 12 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const tip = tipFromImage(img, 'dark')!;
    expect([tip.w, tip.h]).toEqual([10, 10]);
    // The bar sits in the middle rows.
    expect(tip.data[0]).toBe(0);
    expect(tip.data[3 * 10 + 5]).toBe(255);
    expect(tip.data[5 * 10 + 9]).toBe(255);
    expect(tip.data[9 * 10 + 5]).toBe(0);
    expect(tipFromImage(image(8, 8, () => [255, 255, 255, 255]), 'dark')).toBeNull();
  });

  it('uses a PNG’s alpha when it has transparency, else its dark parts', () => {
    const white = image(8, 8, (x) => (x < 4 ? [255, 255, 255, 255] : [255, 255, 255, 0]));
    const a = tipFromImage(white, 'alpha')!;
    expect(a.w).toBe(8);
    expect(a.data[2 * 8 + 2]).toBe(255);
    // Opaque: dark paints, as with a selection.
    const grey = image(4, 4, () => [64, 64, 64, 255]);
    expect(tipFromImage(grey, 'alpha')!.data[0]).toBe(191);
  });

  it('keeps big pictures to the tip size', () => {
    const big = image(1000, 500, () => [0, 0, 0, 255]);
    const tip = tipFromImage(big, 'dark')!;
    expect([tip.w, tip.h]).toEqual([256, 256]);
    const tex = textureFromImage(image(1024, 256, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])));
    expect([tex.w, tex.h]).toEqual([512, 128]);
    // Alternating columns average to grey.
    expect(Math.abs(tex.data[0] - 128)).toBeLessThanOrEqual(1);
  });

  it('resizes, crops, pads, inverts and softens masks', () => {
    const m = { w: 4, h: 2, data: new Uint8Array([0, 255, 255, 0, 0, 255, 255, 0]) };
    expect(resizeMask(m, 2, 1).data).toEqual(new Uint8Array([128, 128]));
    expect(cropMask(m)).toEqual({ w: 2, h: 2, data: new Uint8Array([255, 255, 255, 255]) });
    expect(padSquare(m).h).toBe(4);
    expect(padSquare(m).data.slice(4, 8)).toEqual(new Uint8Array([0, 255, 255, 0]));
    expect(invertMask(m).data[0]).toBe(255);
    expect(fitMask(m, 2)).toMatchObject({ w: 2, h: 1 });
    const dot = paintMask(editorMask(null), 24, 24, 3, 255);
    expect(dot.data[24 * TIP_EDITOR_SIZE + 24]).toBe(255);
    expect(dot.data[24 * TIP_EDITOR_SIZE + 30]).toBe(0);
    const soft = softenMask(dot);
    expect(soft.data[24 * TIP_EDITOR_SIZE + 24]).toBe(255);
    expect(soft.data[24 * TIP_EDITOR_SIZE + 27]).toBeGreaterThan(0);
    expect(soft.data[24 * TIP_EDITOR_SIZE + 27]).toBeLessThan(255);
    expect(editorMask({ w: 96, h: 96, data: new Uint8Array(96 * 96).fill(200) })).toMatchObject({ w: TIP_EDITOR_SIZE, h: TIP_EDITOR_SIZE });
  });
});

describe('personal brush files', () => {
  const base = {
    format: BRUSH_FORMAT,
    version: BRUSH_FORMAT_VERSION,
    id: 'my-00000000-0000-4000-8000-000000000000',
    name: 'Test',
    category: 'custom',
    tip: null,
    texture: null,
    createdAt: 1,
  };

  it('accepts every built-in brush’s settings', () => {
    for (const b of BUILTIN_BRUSHES) {
      const r = CustomBrushSchema.safeParse({ ...base, category: b.category, settings: b.settings });
      expect(r.success, b.id).toBe(true);
    }
  });

  it('round-trips mask data through base64', () => {
    const data = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
    expect(decodeMaskData(encodeMaskData(data))).toEqual(data);
  });

  it('rejects broken or inconsistent brushes', () => {
    const settings = BUILTIN_BRUSHES[0].settings;
    const ok = (over: Record<string, unknown>) => CustomBrushSchema.safeParse({ ...base, settings, ...over }).success;
    expect(ok({})).toBe(true);
    expect(ok({ id: 'round' })).toBe(false);
    expect(ok({ name: '  ' })).toBe(false);
    expect(ok({ category: 'nope' })).toBe(false);
    // Its own tip, but none stored with it.
    expect(ok({ settings: { ...settings, tip: { kind: 'image', id: 'own' } } })).toBe(false);
    const tip = { w: 2, h: 2, data: encodeMaskData(new Uint8Array([0, 255, 255, 0])) };
    expect(ok({ settings: { ...settings, tip: { kind: 'image', id: 'own' } }, tip })).toBe(true);
    // Mask data that doesn't match its size, or isn't base64.
    expect(ok({ tip: { ...tip, w: 3 } })).toBe(false);
    expect(ok({ tip: { ...tip, data: '!!!!!!!!' } })).toBe(false);
    expect(ok({ tip: { w: 600, h: 1, data: '' } })).toBe(false);
    // Out-of-range or extra-strange values.
    expect(ok({ settings: { ...settings, size: 0 } })).toBe(false);
    expect(ok({ settings: { ...settings, count: 1.5 } })).toBe(false);
    expect(ok({ settings: { ...settings, tip: { kind: 'image', id: '../x' } } })).toBe(false);
    expect(ok({ settings: { ...settings, dynamics: { size: { source: 'pressure', curve: [[0.5, 0], [0.2, 1]], min: 0 } } } })).toBe(false);
    expect(ok({ settings: { ...settings, dynamics: { colour: { source: 'pressure', curve: [[0, 0], [1, 1]], min: 0 } } } })).toBe(false);
  });
});
