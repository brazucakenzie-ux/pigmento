import { describe, expect, it } from 'vitest';
import { floodFill } from '@engine/raster/floodFill';
import { paintRect, setPx, solid } from './helpers';

describe('floodFill', () => {
  it('fills a closed region and stops at the border', () => {
    const w = 20;
    const h = 20;
    const d = solid(w, h, [255, 255, 255, 255]);
    // Black square outline from (5,5) to (14,14).
    for (let i = 5; i < 15; i++) {
      setPx(d, w, i, 5, [0, 0, 0, 255]);
      setPx(d, w, i, 14, [0, 0, 0, 255]);
      setPx(d, w, 5, i, [0, 0, 0, 255]);
      setPx(d, w, 14, i, [0, 0, 0, 255]);
    }
    const r = floodFill(d, w, h, 10, 10, { tolerance: 0, contiguous: true });
    expect(r.count).toBe(8 * 8);
    expect(r.bounds).toEqual({ x: 6, y: 6, w: 8, h: 8 });
    expect(r.mask[10 * w + 10]).toBe(255);
    expect(r.mask[5 * w + 5]).toBe(0);
    expect(r.mask[0]).toBe(0);
  });

  it('fills the outside when started outside', () => {
    const w = 10;
    const h = 10;
    const d = solid(w, h, [255, 255, 255, 255]);
    paintRect(d, w, { x: 3, y: 3, w: 4, h: 4 }, [255, 0, 0, 255]);
    const r = floodFill(d, w, h, 0, 0, { tolerance: 0, contiguous: true });
    expect(r.count).toBe(100 - 16);
  });

  it('respects tolerance', () => {
    const w = 4;
    const h = 1;
    const d = new Uint8ClampedArray([100, 100, 100, 255, 110, 110, 110, 255, 140, 140, 140, 255, 100, 100, 100, 255]);
    expect(floodFill(d, w, h, 0, 0, { tolerance: 0, contiguous: true }).count).toBe(1);
    // 10% ≈ 25.5 per channel: includes 110 but not 140, and stops there (contiguous).
    expect(floodFill(d, w, h, 0, 0, { tolerance: 10, contiguous: true }).count).toBe(2);
    // Non-contiguous picks up the far 100 too.
    expect(floodFill(d, w, h, 0, 0, { tolerance: 10, contiguous: false }).count).toBe(3);
  });

  it('treats all fully transparent pixels as equal', () => {
    const d = new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255]);
    const r = floodFill(d, 3, 1, 0, 0, { tolerance: 0, contiguous: true });
    expect(r.count).toBe(2);
  });

  it('honours a clip mask', () => {
    const w = 6;
    const h = 1;
    const d = solid(w, h, [0, 0, 0, 255]);
    const clip = new Uint8Array([0, 255, 255, 255, 0, 255]);
    const r = floodFill(d, w, h, 2, 0, { tolerance: 0, contiguous: true, clip });
    expect([...r.mask]).toEqual([0, 255, 255, 255, 0, 0]);
    expect(floodFill(d, w, h, 0, 0, { tolerance: 0, contiguous: true, clip }).count).toBe(0);
  });

  it('fills a 4000×3000 image within the performance budget', () => {
    const w = 4000;
    const h = 3000;
    const d = solid(w, h, [255, 255, 255, 255]);
    const t0 = performance.now();
    const r = floodFill(d, w, h, 10, 10, { tolerance: 15, contiguous: true });
    const ms = performance.now() - t0;
    expect(r.count).toBe(w * h);
    // Budget is 300 ms in the app; allow headroom for slow CI machines.
    expect(ms).toBeLessThan(1500);
  });
});
