import { describe, expect, it } from 'vitest';
import { identityState, type PieceState } from '@engine/anim/interpolate';
import { makePiece, pieceBounds, setKey, type Piece } from '@engine/anim/piece';
import { sampleProjective } from '@engine/anim/pieceProject';
import { drawPiece } from '@engine/anim/pieceRaster';
import { piecePaintMap } from '@engine/anim/piecePaint';
import { placementOf, project, type Space } from '@engine/anim/space';
import { Surface } from '@engine/raster/Surface';
import { perspectiveWarp, type Quad } from '@engine/raster/warp';
import type { ImageBuf } from '@engine/raster/transform';

const space: Space = { cx: 200, cy: 150, f: 500 };

/** Smooth colours (no hard edges), so bilinear results compare closely. */
function gradient(w: number, h: number): ImageBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([(x * 255) / w, (y * 255) / h, 128, 255], (y * w + x) * 4);
  return { w, h, data };
}

/** A checkerboard of single pixels: averages to mid grey. */
function checker(w: number, h: number): ImageBuf {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * w + x) * 4);
  return { w, h, data };
}

const at = (change: Partial<PieceState>): PieceState => ({ ...identityState(200, 150), ...change });

describe('the CPU path for pieces in 3D', () => {
  it('matches the exact perspective warp inside the sheet', () => {
    const img = gradient(120, 80);
    const src = Surface.fromRGBA(img.w, img.h, img.data);
    const pl = placementOf(at({ tilt: 0.5, turn: -0.3 }), { x: 60, y: 40 }, 120, 80, space);
    const q = [project(pl, { x: 0, y: 0 })!, project(pl, { x: 120, y: 0 })!, project(pl, { x: 120, y: 80 })!, project(pl, { x: 0, y: 80 })!] as unknown as Quad;
    const area = { x: 0, y: 0, w: 400, h: 300 };
    const ours = sampleProjective(src, pl, area);
    const ref = perspectiveWarp(img, q, true, area);
    let compared = 0;
    for (let y = 0; y < 300; y += 7) {
      for (let x = 0; x < 400; x += 7) {
        const ri = ((y - ref.y) * ref.w + (x - ref.x)) * 4;
        const oi = ((y - ours.y) * ours.w + (x - ours.x)) * 4;
        if (x < ref.x || y < ref.y || x >= ref.x + ref.w || y >= ref.y + ref.h || ref.data[ri + 3] < 255 || ours.data[oi + 3] < 255) continue;
        for (let k = 0; k < 3; k++) expect(Math.abs(ours.data[oi + k] - ref.data[ri + k])).toBeLessThanOrEqual(2);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('averages detail it shrinks a lot (mip levels), instead of shimmering', () => {
    const img = checker(256, 256);
    const src = Surface.fromRGBA(img.w, img.h, img.data);
    // An eighth of the size, tilted a little: every canvas pixel covers about 64 piece pixels.
    const pl = placementOf(at({ sx: 0.125, sy: 0.125, tilt: 0.2 }), { x: 128, y: 128 }, 256, 256, space);
    const out = sampleProjective(src, pl, { x: 190, y: 140, w: 20, h: 20 });
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i + 3] < 255) continue;
      expect(Math.abs(out.data[i] - 128)).toBeLessThan(24);
    }
  });

  it('covers edge pixels by 4 samples, like the screen’s multisampling', () => {
    const src = Surface.fromRGBA(4, 4, new Uint8ClampedArray(64).fill(255));
    // Barely tilted, so its edges sit where the flat piece's would.
    const s = at({ tilt: 1e-6, x: 10, y: 10 });
    const pl = placementOf(s, { x: 2, y: 2 }, 4, 4, { cx: 10, cy: 10, f: 1e6 });
    const out = sampleProjective(src, pl, { x: 0, y: 0, w: 20, h: 20 });
    const alpha = (x: number, y: number) => out.data[((y - out.y) * out.w + (x - out.x)) * 4 + 3] ?? 0;
    expect(alpha(9, 9)).toBe(255);
    expect(alpha(7, 9)).toBe(0);
  });

  it('runs a repeating floor out to its horizon and leaves the sky empty', () => {
    const img = gradient(64, 64);
    const p: Piece = makePiece('floor', '', 'l', img, { x: 168, y: 300, w: 64, h: 64 }, 0);
    p.repeat = 'both';
    // Flat on the ground, its pivot below the vanishing point.
    p.keyframes = setKey(p.keyframes, 0, { y: 260, tilt: Math.PI / 2 });
    const view = { data: new Uint8ClampedArray(400 * 300 * 4), stride: 400, ox: 0, oy: 0 };
    drawPiece(view, { x: 0, y: 0, w: 400, h: 300 }, p, 0, space);
    const a = (x: number, y: number) => view.data[(y * 400 + x) * 4 + 3];
    // Above the horizon (the vanishing point's height) there's nothing; below it, floor all the way across.
    expect(a(200, 100)).toBe(0);
    expect(a(5, 290)).toBe(255);
    expect(a(395, 200)).toBe(255);
  });

  it('turned round, shows its back mirrored, or nothing when its back is hidden', () => {
    const p = makePiece('p', '', 'l', gradient(40, 20), { x: 180, y: 140, w: 40, h: 20 }, 0);
    p.keyframes = setKey(p.keyframes, 0, { turn: Math.PI - 0.2 });
    const draw = () => {
      const view = { data: new Uint8ClampedArray(400 * 300 * 4), stride: 400, ox: 0, oy: 0 };
      drawPiece(view, { x: 0, y: 0, w: 400, h: 300 }, p, 0, space);
      return view.data[(150 * 400 + 200) * 4 + 3];
    };
    expect(draw()).toBe(255);
    p.back = 'hide';
    expect(draw()).toBe(0);
    expect(pieceBounds(p, 0, space).w).toBeGreaterThan(0);
  });

  it('paints a tilted piece under the pointer, and not where it is seen edge-on', () => {
    const p = makePiece('p', '', 'l', gradient(100, 60), { x: 150, y: 120, w: 100, h: 60 }, 0);
    p.keyframes = setKey(p.keyframes, 0, { tilt: 0.9 });
    const s = p.keyframes[0];
    const map = piecePaintMap(p, s, space, { x: 200, y: 150 })!;
    const q = map.toPiece({ x: 200, y: 150 })!;
    expect(q.x).toBeCloseTo(50, 6);
    expect(q.y).toBeCloseTo(30, 6);
    const back = map.toDoc(map.toPiece({ x: 230, y: 140 })!)!;
    expect(back.x).toBeCloseTo(230, 6);
    expect(back.y).toBeCloseTo(140, 6);
    // Tilted back, the sheet is squeezed up and down: a brush covers more of it than it is wide.
    expect(map.scale).toBeLessThan(1);
    expect(piecePaintMap(p, { ...s, tilt: Math.PI / 2 }, space, { x: 200, y: 150 })).toBeNull();
  });

  it('draws a 4000 × 3000 piece tilted to fill the picture in good time', () => {
    const src = new Surface(4000, 3000);
    src.fillRect({ x: 0, y: 0, w: 4000, h: 3000 }, { r: 40, g: 90, b: 200, a: 255 });
    const pl = placementOf({ ...identityState(2000, 1500), tilt: 0.3, turn: 0.2 }, { x: 2000, y: 1500 }, 4000, 3000, { cx: 2000, cy: 1500, f: 5000 });
    const t0 = performance.now();
    const out = sampleProjective(src, pl, { x: 0, y: 0, w: 4000, h: 3000 });
    const ms = performance.now() - t0;
    expect(out.w * out.h).toBe(12_000_000);
    // A one-off (flatten, still export); the screen uses the GPU.
    expect(ms).toBeLessThan(6_000);
  });
});
