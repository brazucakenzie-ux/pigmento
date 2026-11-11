import { describe, expect, it } from 'vitest';
import { alphaBounds, applyColorMask, applyImage, flattenOnto, invertView } from '@engine/raster/pixels';
import { colorDistance, hsvToRgb, parseHex, rgbToHsv, toHex8 } from '@engine/core/color';
import { encodeBmp, jpegWithDpi, pngWithDpi, readDpi, crc32 } from '@engine/io/codecs';
import { px, solid } from './helpers';

describe('alphaBounds (trim)', () => {
  const img = (w: number, h: number, on: [number, number, number?][]) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (const [x, y, a = 255] of on) d[(y * w + x) * 4 + 3] = a;
    return d;
  };

  it('is null for a fully transparent image', () => {
    expect(alphaBounds(img(5, 4, []), 5, 4)).toBeNull();
  });

  it('finds a single pixel anywhere, including corners', () => {
    expect(alphaBounds(img(5, 4, [[0, 0]]), 5, 4)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(alphaBounds(img(5, 4, [[4, 3]]), 5, 4)).toEqual({ x: 4, y: 3, w: 1, h: 1 });
    expect(alphaBounds(img(5, 4, [[2, 1]]), 5, 4)).toEqual({ x: 2, y: 1, w: 1, h: 1 });
  });

  it('spans scattered pixels and counts faint alpha as content', () => {
    const d = img(10, 8, [
      [3, 1, 1],
      [7, 2],
      [1, 5],
      [5, 6, 1],
    ]);
    expect(alphaBounds(d, 10, 8)).toEqual({ x: 1, y: 1, w: 7, h: 6 });
  });

  it('covers the whole image when the edges are opaque', () => {
    const d = new Uint8ClampedArray(3 * 2 * 4).fill(255);
    expect(alphaBounds(d, 3, 2)).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });

  it('ignores colour in fully transparent pixels', () => {
    const d = img(4, 4, [[1, 2]]);
    d[0] = 255; // red but alpha 0 at (0,0)
    expect(alphaBounds(d, 4, 4)).toEqual({ x: 1, y: 2, w: 1, h: 1 });
  });
});

describe('compositing', () => {
  it('source-over with straight alpha', () => {
    const d = solid(1, 1, [0, 0, 255, 255]);
    applyColorMask({ data: d, stride: 1, ox: 0, oy: 0 }, { x: 0, y: 0, w: 1, h: 1 }, { r: 255, g: 0, b: 0, a: 255 }, null, 'over', 0.5);
    expect(px(d, 1, 0, 0)).toEqual([128, 0, 128, 255]);
  });

  it('over onto transparent keeps the source colour', () => {
    const d = solid(1, 1, [0, 0, 0, 0]);
    applyColorMask({ data: d, stride: 1, ox: 0, oy: 0 }, { x: 0, y: 0, w: 1, h: 1 }, { r: 10, g: 20, b: 30, a: 255 }, null, 'over', 0.5);
    expect(px(d, 1, 0, 0)).toEqual([10, 20, 30, 128]);
  });

  it('erase reduces alpha by coverage', () => {
    const d = solid(2, 1, [50, 50, 50, 200]);
    const mask = { data: new Uint8Array([255, 128]), stride: 2, ox: 0, oy: 0, w: 2, h: 1 };
    applyColorMask({ data: d, stride: 2, ox: 0, oy: 0 }, { x: 0, y: 0, w: 2, h: 1 }, { r: 0, g: 0, b: 0, a: 255 }, mask, 'erase', 1);
    expect(d[3]).toBe(0);
    expect(d[7]).toBeGreaterThan(95);
    expect(d[7]).toBeLessThan(105);
  });

  it('clips to a mask view in document coordinates', () => {
    const d = solid(4, 1, [0, 0, 0, 0]);
    const clip = { data: new Uint8Array([255]), stride: 1, ox: 2, oy: 0, w: 1, h: 1 };
    applyColorMask({ data: d, stride: 4, ox: 0, oy: 0 }, { x: 0, y: 0, w: 4, h: 1 }, { r: 1, g: 2, b: 3, a: 255 }, null, 'over', 1, clip);
    expect(d[3]).toBe(0);
    expect(px(d, 4, 2, 0)).toEqual([1, 2, 3, 255]);
  });

  it('composites images and inverts', () => {
    const dst = solid(1, 1, [255, 255, 255, 255]);
    const src = solid(1, 1, [0, 0, 0, 128]);
    applyImage({ data: dst, stride: 1, ox: 0, oy: 0 }, { x: 0, y: 0, w: 1, h: 1 }, { data: src, stride: 1, ox: 0, oy: 0 }, 'over', 1);
    expect(dst[0]).toBe(127);
    invertView({ data: dst, stride: 1, ox: 0, oy: 0 }, { x: 0, y: 0, w: 1, h: 1 });
    expect(dst[0]).toBe(128);
    const t = solid(1, 1, [255, 0, 0, 0]);
    flattenOnto(t, { r: 255, g: 255, b: 255, a: 255 });
    expect(px(t, 1, 0, 0)).toEqual([255, 255, 255, 255]);
  });
});

describe('colour utilities', () => {
  it('parses and formats hex', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
    expect(parseHex('11223344')).toEqual({ r: 17, g: 34, b: 51, a: 68 });
    expect(parseHex('#12345')).toBeNull();
    expect(toHex8({ r: 1, g: 2, b: 3, a: 255 })).toBe('#010203ff');
  });

  it('round-trips HSV', () => {
    for (const c of [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 12, g: 200, b: 99, a: 255 },
      { r: 128, g: 128, b: 128, a: 255 },
    ]) {
      expect(hsvToRgb(rgbToHsv(c))).toEqual(c);
    }
  });

  it('compares premultiplied', () => {
    expect(colorDistance(255, 0, 0, 0, 0, 255, 0, 0)).toBe(0);
    expect(colorDistance(0, 0, 0, 255, 255, 255, 255, 255)).toBe(255);
  });
});

describe('codecs', () => {
  it('encodes a 24-bit bottom-up BMP with DPI', () => {
    const d = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const bmp = encodeBmp(d, 3, 1, 300);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    const dv = new DataView(bmp.buffer);
    expect(dv.getInt32(18, true)).toBe(3);
    expect(dv.getUint16(28, true)).toBe(24);
    expect(bmp.length).toBe(54 + 12); // row padded to 12 bytes
    expect([bmp[54], bmp[55], bmp[56]]).toEqual([0, 0, 255]); // BGR
    expect(readDpi(bmp)).toBe(300);
  });

  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('inserts pHYs into a PNG and reads it back', () => {
    // Minimal PNG: signature + IHDR + IEND (contents don't need to decode for this test).
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0];
    const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    const png = new Uint8Array([...sig, ...ihdr, ...iend]);
    const out = pngWithDpi(png, 300);
    expect(out.length).toBe(png.length + 21);
    expect(readDpi(out)).toBe(300);
    // Re-applying replaces rather than duplicates.
    expect(pngWithDpi(out, 72).length).toBe(out.length);
    expect(readDpi(pngWithDpi(out, 72))).toBe(72);
  });

  it('sets JFIF density', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
    const out = jpegWithDpi(jpg, 150);
    expect(readDpi(out)).toBe(150);
  });
});
