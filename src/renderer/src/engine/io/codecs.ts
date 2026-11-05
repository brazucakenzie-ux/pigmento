/** Pure codec helpers (no DOM): BMP encoding, DPI metadata read/write for PNG/JPEG/BMP. */

const INCH_PER_METER = 39.3700787;

/** 24-bit bottom-up BMP (what classic Paint writes). Input must already be opaque. */
export function encodeBmp(data: Uint8ClampedArray, w: number, h: number, dpi = 96): Uint8Array {
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const pixelBytes = rowSize * h;
  const fileSize = 14 + 40 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true);
  dv.setUint32(34, pixelBytes, true);
  const ppm = Math.round(dpi * INCH_PER_METER);
  dv.setInt32(38, ppm, true);
  dv.setInt32(42, ppm, true);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < w; x++, dst += 3) {
      const i = src + x * 4;
      out[dst] = data[i + 2];
      out[dst + 1] = data[i + 1];
      out[dst + 2] = data[i];
    }
  }
  return out;
}

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return b.length > 33 && PNG_SIG.every((v, i) => b[i] === v);
}

/** Insert (or replace) a pHYs chunk so the PNG carries its DPI. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) return png;
  const ppm = Math.round(dpi * INCH_PER_METER);
  // Walk chunks, dropping any existing pHYs.
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  let inserted = false;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const end = off + 12 + len;
    if (end > png.length) break;
    if (type !== 'pHYs') chunks.push(png.subarray(off, end));
    if (type === 'IHDR' && !inserted) {
      const chunk = new Uint8Array(21);
      const cv = new DataView(chunk.buffer);
      cv.setUint32(0, 9);
      chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
      cv.setUint32(8, ppm);
      cv.setUint32(12, ppm);
      chunk[16] = 1; // unit: metre
      cv.setUint32(17, crc32(chunk.subarray(4, 17)));
      chunks.push(chunk);
      inserted = true;
    }
    off = end;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Set the JFIF density fields (units = DPI) when the JPEG starts with a JFIF APP0 segment. */
export function jpegWithDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 20 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  if (jpeg[2] !== 0xff || jpeg[3] !== 0xe0) return jpeg;
  if (String.fromCharCode(jpeg[6], jpeg[7], jpeg[8], jpeg[9]) !== 'JFIF') return jpeg;
  const out = jpeg.slice();
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  out[13] = 1;
  out[14] = d >> 8;
  out[15] = d & 0xff;
  out[16] = d >> 8;
  out[17] = d & 0xff;
  return out;
}

/** Read DPI metadata from PNG (pHYs), JPEG (JFIF) or BMP headers; null if absent. */
export function readDpi(bytes: Uint8Array): number | null {
  if (isPng(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 8;
    while (off + 12 <= bytes.length) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'pHYs' && len === 9 && bytes[off + 16] === 1) {
        const ppm = dv.getUint32(off + 8);
        return ppm > 0 ? Math.round(ppm / INCH_PER_METER) : null;
      }
      if (type === 'IDAT') break;
      off += 12 + len;
    }
    return null;
  }
  if (bytes.length > 18 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0) {
    if (String.fromCharCode(bytes[6], bytes[7], bytes[8], bytes[9]) === 'JFIF') {
      const units = bytes[13];
      const xd = (bytes[14] << 8) | bytes[15];
      if (xd > 0 && units === 1) return xd;
      if (xd > 0 && units === 2) return Math.round(xd * 2.54);
    }
    return null;
  }
  if (bytes.length > 46 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ppm = dv.getInt32(38, true);
    return ppm > 0 ? Math.round(ppm / INCH_PER_METER) : null;
  }
  return null;
}
