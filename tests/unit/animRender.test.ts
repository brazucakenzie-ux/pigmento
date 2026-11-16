import { describe, expect, it } from 'vitest';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { Surface } from '@engine/raster/Surface';
import { compositeLayers } from '@engine/raster/blend';
import { frameExtras } from '@engine/anim/pieceRaster';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';
import type { ImageBuf } from '@engine/raster/transform';

const W = 100;
const H = 60;

function solid(w: number, h: number, rgba: [number, number, number, number]): ImageBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { w, h, data };
}

function setup(layerPixels?: ImageBuf): { doc: PaintDocument; layer: RasterLayer; piece: Piece } {
  const surface = layerPixels ? Surface.fromRGBA(W, H, layerPixels.data) : new Surface(W, H);
  const layer = new RasterLayer('L', surface);
  const doc = new PaintDocument({ width: W, height: H, paper: null }, [layer]);
  const piece = makePiece('p', 'P', layer.id, solid(10, 10, [0, 0, 255, 255]), { x: 0, y: 0, w: 10, h: 10 }, 0);
  doc.pieces.push(piece);
  return { doc, layer, piece };
}

function render(doc: PaintDocument, frame: number): (x: number, y: number) => number[] {
  const data = new Uint8ClampedArray(W * H * 4);
  compositeLayers(doc.layers, { x: 0, y: 0, w: W, h: H }, { data, stride: W, ox: 0, oy: 0 }, undefined, frameExtras(doc, frame));
  return (x, y) => Array.from(data.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
}

describe('pieces in the pixel path', () => {
  it('draws a piece where its keyframes put it at each frame', () => {
    const { doc, piece } = setup();
    piece.keyframes = setKey(piece.keyframes, 10, { x: 55 });
    let px = render(doc, 0);
    expect(px(5, 5)).toEqual([0, 0, 255, 255]);
    expect(px(30, 5)[3]).toBe(0);
    px = render(doc, 5);
    expect(px(30, 5)).toEqual([0, 0, 255, 255]);
    expect(px(5, 5)[3]).toBe(0);
    px = render(doc, 10);
    expect(px(55, 5)).toEqual([0, 0, 255, 255]);
    // Held after the last keyframe.
    expect(render(doc, 40)(55, 5)).toEqual([0, 0, 255, 255]);
  });

  it('fades, turns and stretches about the pivot', () => {
    const { doc, piece } = setup();
    piece.keyframes = setKey(piece.keyframes, 0, { opacity: 0.5 });
    expect(render(doc, 0)(5, 5)[3]).toBeCloseTo(128, -1);

    piece.keyframes = setKey(piece.keyframes, 0, { opacity: 1, x: 50, y: 30, sx: 3, sy: 1 });
    let px = render(doc, 0);
    // 30 × 10 around (50, 30).
    expect(px(37, 30)[3]).toBe(255);
    expect(px(63, 30)[3]).toBe(255);
    expect(px(50, 37)[3]).toBe(0);

    piece.keyframes = setKey(piece.keyframes, 0, { angle: Math.PI / 2 });
    px = render(doc, 0);
    // Now 10 wide and 30 tall.
    expect(px(50, 17)[3]).toBe(255);
    expect(px(50, 43)[3]).toBe(255);
    expect(px(37, 30)[3]).toBe(0);
  });

  it('is part of its layer: hidden with it, and isolated under the layer’s opacity', () => {
    const { doc, layer } = setup(solid(W, H, [255, 0, 0, 255]));
    layer.opacity = 0.5;
    // The piece covers the red layer, then the layer as a whole is half see-through.
    const px = render(doc, 0);
    expect(px(5, 5)[2]).toBe(255);
    expect(px(5, 5)[3]).toBeCloseTo(128, -1);
    expect(px(50, 30)).toEqual([255, 0, 0, px(50, 30)[3]]);
    layer.visible = false;
    expect(render(doc, 0)(5, 5)[3]).toBe(0);
  });

  it('leaves layers without pieces exactly as before', () => {
    const { doc } = setup(solid(W, H, [10, 20, 30, 255]));
    doc.pieces = [];
    expect(frameExtras(doc, 0)).toBeUndefined();
    expect(render(doc, 0)(5, 5)).toEqual([10, 20, 30, 255]);
  });
});
