import { rectIntersect, type Rect } from '../core/geometry';
import { TILE_SIZE, type Surface, type Tile } from '../raster/Surface';
import type { TransformedImage } from '../raster/transform';
import type { Tiling } from './pieceSample';
import type { Placement } from './space';

/**
 * The CPU path for pieces in 3D: each pixel looks up the piece point it shows through the
 * inverse of the piece's homography, with a mip level picked from how much of the piece falls in
 * the pixel (so a sheet tilted far back or shrunk doesn't shimmer), and edges covered by 4
 * samples, as the screen's 4× multisampling does. Sheets reaching behind the camera show only
 * their part in front of it. Out comes straight RGBA, like `sampleAffine`.
 */

/**
 * Smaller copies of a surface, each half the one before, averaged in premultiplied alpha (8 bits
 * a channel, a third of the piece's own size altogether).
 */
interface MipLevel {
  w: number;
  h: number;
  /** Premultiplied RGBA, 0–255. */
  data: Uint8ClampedArray;
}

interface MipChain {
  tiles: (Tile | null)[];
  levels: MipLevel[];
}

const mips = new WeakMap<Surface, MipChain>();

/** Levels 1, 2… of `src` (level 0 is the surface itself), rebuilt when its tiles change. */
function mipLevels(src: Surface): MipLevel[] {
  const cached = mips.get(src);
  if (cached && cached.tiles.length === src.tiles.length && cached.tiles.every((t, i) => t === src.tiles[i])) return cached.levels;
  const levels: MipLevel[] = [];
  // Level 1 from the surface two rows at a time (premultiplying as it goes, no full-size copy).
  const sw = src.width;
  const sh = src.height;
  let prev: MipLevel = { w: Math.max(1, Math.ceil(sw / 2)), h: Math.max(1, Math.ceil(sh / 2)), data: new Uint8ClampedArray(0) };
  prev.data = new Uint8ClampedArray(prev.w * prev.h * 4);
  const rows = new Uint8ClampedArray(sw * 2 * 4);
  for (let y = 0; y < prev.h; y++) {
    src.readRect({ x: 0, y: 2 * y, w: sw, h: 2 }, rows);
    // An odd last row averages with itself.
    if (2 * y + 1 >= sh) rows.copyWithin(sw * 4, 0, sw * 4);
    for (let x = 0; x < prev.w; x++) {
      const x1 = Math.min(sw - 1, 2 * x + 1);
      const offs = [2 * x * 4, x1 * 4, (sw + 2 * x) * 4, (sw + x1) * 4];
      const d = (y * prev.w + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const o of offs) {
        const al = rows[o + 3];
        r += rows[o] * al;
        g += rows[o + 1] * al;
        b += rows[o + 2] * al;
        a += al;
      }
      prev.data[d] = r / 1020;
      prev.data[d + 1] = g / 1020;
      prev.data[d + 2] = b / 1020;
      prev.data[d + 3] = a / 4;
    }
  }
  levels.push(prev);
  // Each next level from the one before (already premultiplied).
  while (prev.w > 1 || prev.h > 1) {
    const src2 = prev;
    const w = Math.max(1, Math.ceil(src2.w / 2));
    const h = Math.max(1, Math.ceil(src2.h / 2));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = 2 * y;
      const y1 = Math.min(src2.h - 1, y0 + 1);
      for (let x = 0; x < w; x++) {
        const x0 = 2 * x;
        const x1 = Math.min(src2.w - 1, x0 + 1);
        const a = (y0 * src2.w + x0) * 4;
        const b = (y0 * src2.w + x1) * 4;
        const c = (y1 * src2.w + x0) * 4;
        const e = (y1 * src2.w + x1) * 4;
        const d = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) data[d + k] = (src2.data[a + k] + src2.data[b + k] + src2.data[c + k] + src2.data[e + k]) / 4;
      }
    }
    prev = { w, h, data };
    levels.push(prev);
  }
  mips.set(src, { tiles: [...src.tiles], levels });
  return levels;
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/** Premultiplied RGBA accumulated by a sampler. */
type Acc = [number, number, number, number];

/** Bilinear at piece point (fx, fy) (pixel centres at .5) on level 0, read from the tiles. */
function sampleBase(src: Surface, fx: number, fy: number, wrapX: boolean, wrapY: boolean, acc: Acc, weight: number): void {
  const { width: w, height: h, cols, tiles } = src;
  const x = fx - 0.5;
  const y = fy - 0.5;
  const px = Math.floor(x);
  const py = Math.floor(y);
  const tx = x - px;
  const ty = y - py;
  // Off the edge: wrap round a repeating axis, or carry on the edge pixel (as the screen's clamp does).
  const x0 = wrapX ? mod(px, w) : px < 0 ? 0 : px >= w ? w - 1 : px;
  const x1 = wrapX ? mod(px + 1, w) : px + 1 < 0 ? 0 : px + 1 >= w ? w - 1 : px + 1;
  const y0 = wrapY ? mod(py, h) : py < 0 ? 0 : py >= h ? h - 1 : py;
  const y1 = wrapY ? mod(py + 1, h) : py + 1 < 0 ? 0 : py + 1 >= h ? h - 1 : py + 1;
  // Usually all four taps are in one tile: read them straight from it.
  if (x0 >> 8 === x1 >> 8 && y0 >> 8 === y1 >> 8 && TILE_SIZE === 256) {
    const tile = tiles[(y0 >> 8) * cols + (x0 >> 8)];
    if (!tile) return;
    const a = ((y0 & 255) * 256 + (x0 & 255)) * 4;
    const b = ((y0 & 255) * 256 + (x1 & 255)) * 4;
    const c = ((y1 & 255) * 256 + (x0 & 255)) * 4;
    const d = ((y1 & 255) * 256 + (x1 & 255)) * 4;
    const wa = (1 - tx) * (1 - ty) * weight;
    const wb = tx * (1 - ty) * weight;
    const wc = (1 - tx) * ty * weight;
    const wd = tx * ty * weight;
    const pa = (tile[a + 3] / 255) * wa;
    const pb = (tile[b + 3] / 255) * wb;
    const pc = (tile[c + 3] / 255) * wc;
    const pd = (tile[d + 3] / 255) * wd;
    acc[0] += tile[a] * pa + tile[b] * pb + tile[c] * pc + tile[d] * pd;
    acc[1] += tile[a + 1] * pa + tile[b + 1] * pb + tile[c + 1] * pc + tile[d + 1] * pd;
    acc[2] += tile[a + 2] * pa + tile[b + 2] * pb + tile[c + 2] * pc + tile[d + 2] * pd;
    acc[3] += tile[a + 3] * wa + tile[b + 3] * wb + tile[c + 3] * wc + tile[d + 3] * wd;
    return;
  }
  for (let k = 0; k < 4; k++) {
    const qx = k & 1 ? x1 : x0;
    const qy = k >> 1 ? y1 : y0;
    const wt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty) * weight;
    if (wt === 0) continue;
    const tile = tiles[((qy / TILE_SIZE) | 0) * cols + ((qx / TILE_SIZE) | 0)];
    if (!tile) continue;
    const si = ((qy % TILE_SIZE) * TILE_SIZE + (qx % TILE_SIZE)) * 4;
    const a = tile[si + 3];
    const pa = (a / 255) * wt;
    acc[0] += tile[si] * pa;
    acc[1] += tile[si + 1] * pa;
    acc[2] += tile[si + 2] * pa;
    acc[3] += a * wt;
  }
}

/** Bilinear on a smaller level (its pixel coordinates are the piece's divided by 2^level). */
function sampleLevel(l: MipLevel, fx: number, fy: number, wrapX: boolean, wrapY: boolean, acc: Acc, weight: number): void {
  const x = fx - 0.5;
  const y = fy - 0.5;
  const px = Math.floor(x);
  const py = Math.floor(y);
  const tx = x - px;
  const ty = y - py;
  for (let k = 0; k < 4; k++) {
    let qx = px + (k & 1);
    let qy = py + (k >> 1);
    qx = wrapX ? mod(qx, l.w) : Math.min(l.w - 1, Math.max(0, qx));
    qy = wrapY ? mod(qy, l.h) : Math.min(l.h - 1, Math.max(0, qy));
    const wt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty) * weight;
    if (wt === 0) continue;
    const si = (qy * l.w + qx) * 4;
    acc[0] += l.data[si] * wt;
    acc[1] += l.data[si + 1] * wt;
    acc[2] += l.data[si + 2] * wt;
    acc[3] += l.data[si + 3] * wt;
  }
}

/**
 * Coverage samples sit on a rotated grid in each pixel, like 4× multisampling:
 * (0.375, 0.125), (0.875, 0.375), (0.125, 0.625), (0.625, 0.875).
 */

/**
 * `src` drawn through placement `pl` inside `area` (document pixels). With `tiling`, copies go
 * on along the repeated axes, out to the horizon; otherwise it's the sheet's own box.
 */
/** `shade` multiplies its colours (shading by the light, 1 = as it is). */
export function sampleProjective(src: Surface, pl: Placement, area: Rect, tiling: Tiling | null = null, bounds: Rect | null = null, shade = 1): TransformedImage {
  const r = bounds && !tiling ? rectIntersect(area, bounds) : area;
  const inv = pl.inv;
  if (!r || !inv) return { x: area.x, y: area.y, w: 0, h: 0, data: new Uint8ClampedArray(0) };
  const { x: x0, y: y0, w: ow, h: oh } = r;
  const out = new Uint8ClampedArray(ow * oh * 4);
  const { width: w, height: h } = src;
  const wrapX = tiling?.x === true;
  const wrapY = tiling?.y === true;
  const scrollX = wrapX ? tiling!.scrollX : 0;
  const scrollY = wrapY ? tiling!.scrollY : 0;
  const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inv;
  let levels: MipLevel[] | null = null;
  const acc: Acc = [0, 0, 0, 0];
  /** Whether a canvas point is on the sheet, in front of the camera (one coverage sample). */
  const onSheet = (px: number, py: number): boolean => {
    const z = i6 * px + i7 * py + i8;
    if (!(z > 0)) return false;
    if (!wrapX) {
      const u = (i0 * px + i1 * py + i2) / z;
      if (u < 0 || u > w) return false;
    }
    if (!wrapY) {
      const v = (i3 * px + i4 * py + i5) / z;
      if (v < 0 || v > h) return false;
    }
    return true;
  };
  const sampleAt = (lv: number, u: number, v: number, wt: number): void => {
    if (lv === 0) sampleBase(src, u, v, wrapX, wrapY, acc, wt);
    else {
      const k = 2 ** lv;
      sampleLevel(levels![lv - 1], u / k, v / k, wrapX, wrapY, acc, wt);
    }
  };
  for (let oy = 0; oy < oh; oy++) {
    const cy = y0 + oy + 0.5;
    // Along a row the homography's three parts change by a constant each step.
    let nu = i0 * (x0 + 0.5) + i1 * cy + i2;
    let nv = i3 * (x0 + 0.5) + i4 * cy + i5;
    let nz = i6 * (x0 + 0.5) + i7 * cy + i8;
    for (let ox = 0; ox < ow; ox++, nu += i0, nv += i3, nz += i6) {
      // The colour at the pixel's centre (at an edge, the nearest point on the sheet).
      const z = nz;
      const cx = x0 + ox + 0.5;
      let u = z > 0 ? nu / z : Number.NaN;
      let v = z > 0 ? nv / z : Number.NaN;
      // How far one pixel reaches across the piece (the inverse's Jacobian), for the mip level and edges.
      const ux = (i0 - u * i6) / z;
      const uy = (i1 - u * i7) / z;
      const vx = (i3 - v * i6) / z;
      const vy = (i4 - v * i7) / z;
      const reach = Math.sqrt(Math.max(ux * ux + vx * vx, uy * uy + vy * vy));
      // Coverage: well inside the sheet every sample is on it; near an edge (or the camera), count 4.
      let covered = 4;
      const inside = z > 0 && (wrapX || (u > reach && u < w - reach)) && (wrapY || (v > reach && v < h - reach));
      if (!inside) {
        const dx = cx - 0.5;
        const dy = cy - 0.5;
        covered = 0;
        if (onSheet(dx + 0.375, dy + 0.125)) covered++;
        if (onSheet(dx + 0.875, dy + 0.375)) covered++;
        if (onSheet(dx + 0.125, dy + 0.625)) covered++;
        if (onSheet(dx + 0.625, dy + 0.875)) covered++;
        if (covered === 0 || !(z > 0)) continue;
      }
      if (!wrapX) u = u < 0 ? 0 : u > w ? w : u;
      if (!wrapY) v = v < 0 ? 0 : v > h ? h : v;
      u -= scrollX;
      v -= scrollY;
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      if (reach <= 1) sampleBase(src, u, v, wrapX, wrapY, acc, 1);
      else {
        levels ??= mipLevels(src);
        const lod = Math.log2(reach);
        const lo = Math.min(Math.floor(lod), levels.length);
        const hi = Math.min(lo + 1, levels.length);
        const t = Math.min(1, lod - Math.floor(lod));
        if (lo === hi) sampleAt(lo, u, v, 1);
        else {
          sampleAt(lo, u, v, 1 - t);
          sampleAt(hi, u, v, t);
        }
      }
      const a = (acc[3] * covered) / 4;
      if (a <= 0) continue;
      const di = (oy * ow + ox) * 4;
      // Back from premultiplied (the colour is the sheet's; coverage scales only its alpha).
      const k = (255 * shade) / acc[3];
      out[di] = acc[0] * k;
      out[di + 1] = acc[1] * k;
      out[di + 2] = acc[2] * k;
      out[di + 3] = a;
    }
  }
  return { x: x0, y: y0, w: ow, h: oh, data: out };
}

/** One sheet of a batch drawn together (see sampleProjectiveBatch). */
export interface BatchSheet {
  src: Surface;
  pl: Placement;
  /** Multiplies its colours (shading by the light). */
  shade: number;
  /** Multiplies its alpha (its opacity). */
  opacity: number;
  /** Where its box is on the canvas (document pixels, rounded out). */
  bounds: Rect;
}

/** The 4 coverage samples' offsets in a pixel (the rotated grid above). */
const SAMPLES = [0.375, 0.125, 0.875, 0.375, 0.125, 0.625, 0.625, 0.875];

/**
 * Sheets drawn together inside `area`, back to front, as one image: each of a pixel's 4 coverage
 * samples takes the sheets over it in turn (as the screen's multisampling does), so where two
 * sheets meet along an edge (a hinge) the seam is as solid as the faces either side of it, not
 * lighter, as two pictures each smoothed at that edge would be. Out comes straight RGBA.
 */
export function sampleProjectiveBatch(sheets: readonly BatchSheet[], area: Rect): TransformedImage {
  let r: Rect | null = null;
  for (const s of sheets) {
    const b = rectIntersect(area, s.bounds);
    if (!b) continue;
    r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b;
  }
  if (!r) return { x: area.x, y: area.y, w: 0, h: 0, data: new Uint8ClampedArray(0) };
  const { x: x0, y: y0, w: ow, h: oh } = r;
  const out = new Uint8ClampedArray(ow * oh * 4);
  // A row's samples: 4 a pixel, premultiplied RGBA (0–255) each.
  const row = new Float32Array(ow * 16);
  const acc: Acc = [0, 0, 0, 0];
  const levelsOf = new Map<Surface, MipLevel[]>();
  for (let oy = 0; oy < oh; oy++) {
    row.fill(0);
    const cy = y0 + oy + 0.5;
    let any = false;
    for (const sheet of sheets) {
      const inv = sheet.pl.inv;
      const b = sheet.bounds;
      if (!inv || cy < b.y || cy > b.y + b.h) continue;
      const { src, shade, opacity } = sheet;
      const { width: w, height: h } = src;
      const [i0, i1, i2, i3, i4, i5, i6, i7, i8] = inv;
      const onSheet = (px: number, py: number): boolean => {
        const z = i6 * px + i7 * py + i8;
        if (!(z > 0)) return false;
        const u = (i0 * px + i1 * py + i2) / z;
        if (u < 0 || u > w) return false;
        const v = (i3 * px + i4 * py + i5) / z;
        return v >= 0 && v <= h;
      };
      const xa = Math.max(x0, b.x);
      const xb = Math.min(x0 + ow, b.x + b.w);
      for (let x = xa; x < xb; x++) {
        const cx = x + 0.5;
        const z = i6 * cx + i7 * cy + i8;
        if (!(z > 0)) continue;
        let u = (i0 * cx + i1 * cy + i2) / z;
        let v = (i3 * cx + i4 * cy + i5) / z;
        const ux = (i0 - u * i6) / z;
        const uy = (i1 - u * i7) / z;
        const vx = (i3 - v * i6) / z;
        const vy = (i4 - v * i7) / z;
        const reach = Math.sqrt(Math.max(ux * ux + vx * vx, uy * uy + vy * vy));
        let mask = 15;
        if (!(u > reach && u < w - reach && v > reach && v < h - reach)) {
          mask = 0;
          for (let s = 0; s < 4; s++) if (onSheet(x + SAMPLES[s * 2], y0 + oy + SAMPLES[s * 2 + 1])) mask |= 1 << s;
          if (!mask) continue;
        }
        u = u < 0 ? 0 : u > w ? w : u;
        v = v < 0 ? 0 : v > h ? h : v;
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        if (reach <= 1) sampleBase(src, u, v, false, false, acc, 1);
        else {
          let levels = levelsOf.get(src);
          if (!levels) levelsOf.set(src, (levels = mipLevels(src)));
          const lod = Math.log2(reach);
          const lo = Math.min(Math.floor(lod), levels.length);
          const hi = Math.min(lo + 1, levels.length);
          const t = Math.min(1, lod - Math.floor(lod));
          const at = (lv: number, wt: number) => (lv === 0 ? sampleBase(src, u, v, false, false, acc, wt) : sampleLevel(levels[lv - 1], u / 2 ** lv, v / 2 ** lv, false, false, acc, wt));
          if (lo === hi) at(lo, 1);
          else {
            at(lo, 1 - t);
            at(hi, t);
          }
        }
        const a = acc[3] * opacity;
        if (a <= 0) continue;
        const cr = acc[0] * shade * opacity;
        const cg = acc[1] * shade * opacity;
        const cb = acc[2] * shade * opacity;
        const keep = 1 - a / 255;
        const base = (x - x0) * 16;
        for (let s = 0; s < 4; s++) {
          if (!(mask & (1 << s))) continue;
          const o = base + s * 4;
          row[o] = cr + row[o] * keep;
          row[o + 1] = cg + row[o + 1] * keep;
          row[o + 2] = cb + row[o + 2] * keep;
          row[o + 3] = a + row[o + 3] * keep;
        }
        any = true;
      }
    }
    if (!any) continue;
    for (let ox = 0; ox < ow; ox++) {
      const o = ox * 16;
      const a = (row[o + 3] + row[o + 7] + row[o + 11] + row[o + 15]) / 4;
      if (a <= 0) continue;
      const k = 255 / (4 * a);
      const di = (oy * ow + ox) * 4;
      out[di] = (row[o] + row[o + 4] + row[o + 8] + row[o + 12]) * k;
      out[di + 1] = (row[o + 1] + row[o + 5] + row[o + 9] + row[o + 13]) * k;
      out[di + 2] = (row[o + 2] + row[o + 6] + row[o + 10] + row[o + 14]) * k;
      out[di + 3] = a;
    }
  }
  return { x: x0, y: y0, w: ow, h: oh, data: out };
}
