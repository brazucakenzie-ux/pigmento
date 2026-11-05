import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  matApply,
  matAround,
  matChain,
  matInvert,
  matIsIntegerTranslation,
  matRotate,
  matScale,
  matSkew,
  matTranslate,
} from '@engine/core/matrix';
import { affineTransform, flipH, flipV, placeImage, resample, rotate90 } from '@engine/raster/transform';
import { boxFromRect, boxPoint, resizeBox, rotateBox, transformPoints } from '@engine/live/BoxGeom';
import { View } from '@engine/render/View';
import { dragBox, snapAngle45 } from '@engine/core/geometry';
import { px, setPx } from './helpers';

function numbered(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(d, w, x, y, [x, y, 0, 255]);
  return d;
}

describe('matrix math', () => {
  it('composes left to right and inverts', () => {
    const m = matChain(matScale(2), matRotate(Math.PI / 2), matTranslate(10, 0));
    const p = matApply(m, 1, 0); // scale → (2,0), rotate → (0,2), translate → (10,2)
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(2);
    const inv = matInvert(m)!;
    const q = matApply(inv, p.x, p.y);
    expect(q.x).toBeCloseTo(1);
    expect(q.y).toBeCloseTo(0);
    expect(matInvert([0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('rotates around a pivot and detects integer translations', () => {
    const m = matAround(matRotate(Math.PI), { x: 5, y: 5 });
    const p = matApply(m, 0, 0);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
    expect(matIsIntegerTranslation(matTranslate(3, -2))).toBe(true);
    expect(matIsIntegerTranslation(matTranslate(3.5, 0))).toBe(false);
    expect(matIsIntegerTranslation(IDENTITY)).toBe(true);
  });

  it('skews', () => {
    const m = matSkew(Math.PI / 4, 0);
    const p = matApply(m, 0, 10);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });
});

describe('lossless transforms', () => {
  const w = 3;
  const h = 2;
  const img = { w, h, data: numbered(w, h) };

  it('flips', () => {
    const fh = flipH(img);
    expect(px(fh.data, w, 0, 0)).toEqual([2, 0, 0, 255]);
    const fv = flipV(img);
    expect(px(fv.data, w, 0, 0)).toEqual([0, 1, 0, 255]);
    expect(flipH(flipH(img)).data).toEqual(img.data);
  });

  it('rotates by quarter turns', () => {
    const r1 = rotate90(img, 1);
    expect([r1.w, r1.h]).toEqual([2, 3]);
    // Clockwise: the bottom-left source pixel (0,1) becomes the top-left.
    expect(px(r1.data, r1.w, 0, 0)).toEqual([0, 1, 0, 255]);
    expect(px(r1.data, r1.w, 1, 0)).toEqual([0, 0, 0, 255]);
    const r3 = rotate90(img, 3);
    expect(px(r3.data, r3.w, 0, 0)).toEqual([2, 0, 0, 255]);
    expect(rotate90(rotate90(img, 1), 3).data).toEqual(img.data);
    expect(rotate90(rotate90(img, 2), 2).data).toEqual(img.data);
    expect(rotate90(img, -1).data).toEqual(rotate90(img, 3).data);
  });

  it('places into a larger or smaller canvas', () => {
    const p = placeImage(img, 5, 4, 1, 2);
    expect(px(p.data, 5, 1, 2)).toEqual([0, 0, 0, 255]);
    expect(px(p.data, 5, 0, 0)[3]).toBe(0);
    const crop = placeImage(img, 1, 1, -2, -1);
    expect(px(crop.data, 1, 0, 0)).toEqual([2, 1, 0, 255]);
  });
});

describe('resampling', () => {
  it('nearest-neighbour doubles pixels exactly', () => {
    const img = { w: 2, h: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]) };
    const r = resample(img, 4, 2, 'nearest');
    expect(px(r.data, 4, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(px(r.data, 4, 2, 0)).toEqual([0, 0, 255, 255]);
  });

  it('keeps solid colours solid with bilinear and bicubic', () => {
    const d = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < d.length; i += 4) d.set([40, 120, 200, 255], i);
    for (const m of ['bilinear', 'bicubic'] as const) {
      for (const [nw, nh] of [
        [3, 5],
        [20, 13],
      ]) {
        const r = resample({ w: 8, h: 8, data: d }, nw, nh, m);
        for (let i = 0; i < r.data.length; i += 4) {
          expect(Math.abs(r.data[i] - 40)).toBeLessThanOrEqual(1);
          expect(Math.abs(r.data[i + 2] - 200)).toBeLessThanOrEqual(1);
          expect(r.data[i + 3]).toBeGreaterThanOrEqual(254);
        }
      }
    }
  });

  it('does not darken edges next to transparency (premultiplied)', () => {
    const d = new Uint8ClampedArray(4 * 1 * 4);
    d.set([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = resample({ w: 4, h: 1, data: d }, 2, 1, 'bilinear');
    // The filter blends in some of the transparent neighbour's alpha, but its (black) colour
    // must not leak into the RGB of the white pixel.
    const [cr, cg, cb, ca] = px(r.data, 2, 0, 0);
    expect([cr, cg, cb]).toEqual([255, 255, 255]);
    expect(ca).toBeGreaterThan(128);
  });
});

describe('affine warp', () => {
  it('integer translation reproduces the image', () => {
    const img = { w: 4, h: 3, data: numbered(4, 3) };
    const out = affineTransform(img, matTranslate(5, 7), false);
    expect([out.x, out.y, out.w, out.h]).toEqual([5, 7, 4, 3]);
    expect(out.data).toEqual(img.data);
  });

  it('rotating 90° about the centre swaps dimensions', () => {
    const img = { w: 6, h: 2, data: numbered(6, 2) };
    const out = affineTransform(img, matAround(matRotate(Math.PI / 2), { x: 3, y: 1 }), false);
    expect([out.w, out.h]).toEqual([2, 6]);
  });
});

describe('transform handles', () => {
  const start = boxFromRect({ x: 0, y: 0, w: 100, h: 50 });

  it('resizes from a corner keeping the opposite corner fixed', () => {
    const g = resizeBox(start, 'se', { x: 150, y: 80 }, { keepAspect: false, fromCenter: false });
    expect(g.w).toBeCloseTo(150);
    expect(g.h).toBeCloseTo(80);
    const tl = boxPoint(g, -0.5, -0.5);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(0);
  });

  it('resizes an edge on one axis only', () => {
    const g = resizeBox(start, 'w', { x: -20, y: 999 }, { keepAspect: false, fromCenter: false });
    expect(g.w).toBeCloseTo(120);
    expect(g.h).toBeCloseTo(50);
    expect(boxPoint(g, 0.5, 0).x).toBeCloseTo(100);
  });

  it('keeps aspect ratio with Shift and scales from the centre with Alt', () => {
    const a = resizeBox(start, 'se', { x: 200, y: 60 }, { keepAspect: true, fromCenter: false });
    expect(a.w / a.h).toBeCloseTo(2);
    expect(a.w).toBeCloseTo(200);
    const c = resizeBox(start, 'e', { x: 75, y: 25 }, { keepAspect: false, fromCenter: true });
    expect(c.cx).toBeCloseTo(50);
    expect(c.w).toBeCloseTo(50);
  });

  it('flips when dragged past the opposite edge', () => {
    const g = resizeBox(start, 'e', { x: -50, y: 25 }, { keepAspect: false, fromCenter: false });
    expect(g.w).toBeCloseTo(-50);
    expect(boxPoint(g, -0.5, 0).x).toBeCloseTo(0);
  });

  it('resizes correctly when rotated', () => {
    const rotated = { ...start, angle: Math.PI / 2 };
    // Local +x now points down; dragging 'e' downward lengthens the box.
    const e = boxPoint(rotated, 0.5, 0);
    const g = resizeBox(rotated, 'e', { x: e.x, y: e.y + 20 }, { keepAspect: false, fromCenter: false });
    expect(g.w).toBeCloseTo(120);
    const anchor = boxPoint(g, -0.5, 0);
    const anchor0 = boxPoint(rotated, -0.5, 0);
    expect(anchor.x).toBeCloseTo(anchor0.x);
    expect(anchor.y).toBeCloseTo(anchor0.y);
  });

  it('rotates with optional 15° snapping', () => {
    const g = rotateBox(start, { x: 100, y: 25 }, { x: 50, y: 100 }, false);
    expect(g.angle).toBeCloseTo(Math.PI / 2);
    const s = rotateBox(start, { x: 100, y: 25 }, { x: 100, y: 33 }, true);
    expect((s.angle * 180) / Math.PI).toBeCloseTo(15, 0);
  });

  it('transforms free points with the box', () => {
    const pts = transformPoints([{ x: 100, y: 50 }], start, { ...start, w: 200, h: 100, cx: 100, cy: 50 });
    expect(pts[0].x).toBeCloseTo(200);
    expect(pts[0].y).toBeCloseTo(100);
  });
});

describe('drag modifiers', () => {
  it('constrains to a square and draws from the centre', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 30, y: 15 }, true, false)).toEqual({ x: 10, y: 10, w: 20, h: 20 });
    expect(dragBox({ x: 10, y: 10 }, { x: 20, y: 15 }, false, true)).toEqual({ x: 0, y: 5, w: 20, h: 10 });
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 0 }, false, false)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('snaps lines to 45°', () => {
    const p = snapAngle45({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    const q = snapAngle45({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(q.x).toBeCloseTo(q.y);
  });
});

describe('View', () => {
  it('maps doc ⇄ screen and zooms around a point', () => {
    const v = new View();
    v.setViewport(800, 600);
    v.setDocSize(4000, 3000);
    v.zoomAt(1, 400, 300);
    const before = v.toDoc(123, 456);
    v.zoomAt(4, 123, 456);
    const after = v.toDoc(123, 456);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    v.zoomAt(1000, 0, 0);
    expect(v.zoom).toBe(32);
    v.zoomAt(0.00001, 0, 0);
    expect(v.zoom).toBe(0.01);
  });

  it('centres small documents and fits large ones', () => {
    const v = new View();
    v.setViewport(800, 600);
    v.setDocSize(100, 100);
    v.zoomCentered(1);
    expect(v.panX).toBe(350);
    v.setDocSize(4000, 3000);
    v.fit();
    expect(v.docW * v.zoom).toBeLessThanOrEqual(800);
    expect(v.docH * v.zoom).toBeLessThanOrEqual(600);
  });

  it('steps through zoom levels', () => {
    const v = new View();
    v.setViewport(800, 600);
    v.setDocSize(100, 100);
    v.zoomCentered(1);
    expect(v.nextZoom(1)).toBe(1.25);
    expect(v.nextZoom(-1)).toBe(0.75);
  });
});
