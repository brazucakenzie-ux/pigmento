import { describe, expect, it } from 'vitest';
import { floodFill } from '@engine/raster/floodFill';
import { Surface } from '@engine/raster/Surface';

describe('fast paths for big fills', () => {
  it('matches pixels of exactly the seed colour and still uses the tolerance for the rest', () => {
    // A 6×1 row: seed red, red, near-red, transparent black, transparent white, blue.
    const data = new Uint8ClampedArray([200, 0, 0, 255, 200, 0, 0, 255, 205, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255]);
    const tight = floodFill(data, 6, 1, 0, 0, { tolerance: 0, contiguous: false });
    expect([...tight.mask]).toEqual([255, 255, 0, 0, 0, 0]);
    const loose = floodFill(data, 6, 1, 0, 0, { tolerance: 5, contiguous: false });
    expect([...loose.mask]).toEqual([255, 255, 255, 0, 0, 0]);
    // Transparent pixels match each other whatever their RGB.
    const clear = floodFill(data, 6, 1, 3, 0, { tolerance: 0, contiguous: true });
    expect([...clear.mask]).toEqual([0, 0, 0, 255, 255, 0]);
  });

  it('fills fully covered tiles with the colour exactly as blending would', () => {
    const w = 600;
    const h = 300;
    const mask = new Uint8Array(w * h).fill(255);
    // A soft-edged hole, so some tiles take the blending path.
    for (let x = 500; x < 520; x++) mask[150 * w + x] = 128;
    const view = { data: mask, stride: w, ox: 0, oy: 0, w, h };
    const fast = new Surface(w, h);
    fast.compositeColor({ x: 0, y: 0, w, h }, { r: 10, g: 120, b: 230, a: 255 }, view, 'over', 1);
    // The same fill through the general path (half a percent less opacity rounds the same).
    const slow = new Surface(w, h);
    slow.compositeColor({ x: 0, y: 0, w, h }, { r: 10, g: 120, b: 230, a: 255 }, view, 'over', 0.999999);
    expect(fast.getPixel(10, 10)).toEqual({ r: 10, g: 120, b: 230, a: 255 });
    expect(fast.getPixel(510, 150)).toEqual(slow.getPixel(510, 150));
    expect(fast.toRGBA()).toEqual(slow.toRGBA());
  });
});
