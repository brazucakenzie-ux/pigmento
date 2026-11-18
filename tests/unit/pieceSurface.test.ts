import { describe, expect, it } from 'vitest';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { LayerController, type LayerHost } from '@engine/doc/LayerController';
import { History } from '@engine/history/History';
import { Surface } from '@engine/raster/Surface';
import { affineTransform, type ImageBuf } from '@engine/raster/transform';
import { matChain, matRotate, matScale, matTranslate } from '@engine/core/matrix';
import { copyPiece, makePiece, pieceSize, setKey } from '@engine/anim/piece';
import { drawPiece } from '@engine/anim/pieceRaster';
import { sampleAffine } from '@engine/anim/pieceSample';
import { AnimationCommand, captureAnim, type AnimHost } from '@engine/anim/AnimationController';

/** A deterministic picture with see-through parts. */
function noise(w: number, h: number): ImageBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) >>> 24;
  for (let i = 3; i < data.length; i += 16) data[i] = 0;
  return { w, h, data };
}

describe('piece pixels on a tiled surface', () => {
  it('turns an image into a surface with the same pixels and size', () => {
    const img = noise(300, 20);
    const p = makePiece('p', '', 'l', img, { x: 0, y: 0, w: 300, h: 20 }, 0);
    expect(p.src).toBeInstanceOf(Surface);
    expect(pieceSize(p)).toEqual({ w: 300, h: 20 });
    expect(Array.from(p.src.toRGBA())).toEqual(Array.from(img.data));
    expect(p.pivot).toEqual({ x: 150, y: 10 });
  });

  it('samples straight from the tiles exactly as the one-image transform did', () => {
    // Bigger than a tile both ways, so samples cross tile edges.
    const img = noise(530, 300);
    const s = Surface.fromRGBA(img.w, img.h, img.data);
    const m = matChain(matTranslate(-265, -150), matScale(0.7, 1.3), matRotate(0.4), matTranslate(200, 180));
    const area = { x: 20, y: 10, w: 400, h: 380 };
    const a = sampleAffine(s, m, area);
    const b = affineTransform(img, m, true, area);
    expect([a.x, a.y, a.w, a.h]).toEqual([b.x, b.y, b.w, b.h]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('draws only the part of a piece wider than the picture that falls inside it', () => {
    const img = { w: 1000, h: 4, data: new Uint8ClampedArray(1000 * 4 * 4) };
    for (let x = 0; x < 1000; x++) for (let y = 0; y < 4; y++) img.data.set([x % 256, 0, 0, 255], (y * 1000 + x) * 4);
    // Lifted at x = -400: most of it hangs off the left of a 100-pixel picture.
    const p = makePiece('wide', '', 'l', img, { x: -400, y: 0, w: 1000, h: 4 }, 0);
    const view = { data: new Uint8ClampedArray(100 * 4 * 4), stride: 100, ox: 0, oy: 0 };
    drawPiece(view, { x: 0, y: 0, w: 100, h: 4 }, p, 0);
    // Picture pixel x shows piece pixel x + 400.
    for (const x of [0, 37, 99]) expect(view.data[(1 * 100 + x) * 4]).toBe((x + 400) % 256);
  });

  it('a copy shares tiles until one of them is painted on', () => {
    const p = makePiece('p', '', 'l', noise(64, 64), { x: 0, y: 0, w: 64, h: 64 }, 0);
    const before = p.src.toRGBA();
    const c = copyPiece(p, 'q', 'other');
    expect(c).toMatchObject({ id: 'q', layerId: 'other', pivot: p.pivot, keyframes: p.keyframes });
    expect(c.src).not.toBe(p.src);
    expect(c.src.tiles[0]).toBe(p.src.tiles[0]);
    c.src.beginEdit();
    c.src.fillRect({ x: 0, y: 0, w: 8, h: 8 }, { r: 1, g: 2, b: 3, a: 255 });
    c.src.endEdit();
    expect(Array.from(p.src.toRGBA())).toEqual(Array.from(before));
    expect(c.src.getPixel(3, 3)).toEqual({ r: 1, g: 2, b: 3, a: 255 });
  });

  it('duplicating a layer gives its pieces pixels of their own', () => {
    const layer = new RasterLayer('A', new Surface(16, 16));
    const doc = new PaintDocument({ width: 16, height: 16 }, [layer]);
    const host = {
      doc,
      history: new History(),
      commitLive() {},
      notify() {},
      layerChanged() {},
      structureChanged() {},
      savedSelectionsChanged() {},
      guidesChanged() {},
      vectorChanged() {},
      layersChanged() {},
      setSelection() {},
    } satisfies LayerHost;
    const ctl = new LayerController(host);
    ctl.namer = (kind, arg) => `${kind} ${arg}`;
    const p = makePiece('p', '', layer.id, noise(8, 8), { x: 0, y: 0, w: 8, h: 8 }, 0);
    p.keyframes = setKey(p.keyframes, 4, { x: 12 });
    doc.pieces = [p];
    const copyId = ctl.duplicate(layer.id)!;
    const copy = doc.pieces.find((q) => q.layerId === copyId)!;
    expect(copy.src).not.toBe(p.src);
    expect(copy.keyframes).toEqual(p.keyframes);
    expect(Array.from(copy.src.toRGBA())).toEqual(Array.from(p.src.toRGBA()));
  });

  it('an undo step counts the pixels of a piece it adds once', () => {
    const doc = new PaintDocument({ width: 16, height: 16 });
    const host: AnimHost = { doc, history: new History(), commitLive() {}, notify() {}, animationChanged() {} };
    const before = captureAnim(doc);
    doc.pieces = [makePiece('p', '', doc.layers[0].id, noise(300, 10), { x: 0, y: 0, w: 300, h: 10 }, 0)];
    const cmd = new AnimationCommand('history.animateSelection', host, before, captureAnim(doc));
    // Two tiles (300 pixels wide), counted once, plus the small keyframe bookkeeping.
    expect(cmd.bytes).toBeGreaterThanOrEqual(2 * 256 * 256 * 4);
    expect(cmd.bytes).toBeLessThan(2 * 256 * 256 * 4 + 4096);
  });
});
