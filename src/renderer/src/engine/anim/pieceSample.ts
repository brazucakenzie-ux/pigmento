import { rectIntersect, type Rect } from '../core/geometry';
import { matApplyRect, matInvert, type Mat } from '../core/matrix';
import { TILE_SIZE, type Surface } from '../raster/Surface';
import type { TransformedImage } from '../raster/transform';

/** Tiling for a repeating piece: the axes it repeats along, and how far its tiles have slid. */
export interface Tiling {
  x: boolean;
  y: boolean;
  scrollX: number;
  scrollY: number;
}

const mod = (v: number, n: number): number => ((v % n) + n) % n;

/**
 * A surface drawn through the affine m (its pixels → document pixels) inside `area`: bilinear
 * sampling in premultiplied space, read straight from the tiles, so a big piece is never copied
 * whole. The same maths as `affineTransform`, so the result matches what pieces looked like
 * when their pixels were one image. With `tiling`, copies continue along the repeated axes
 * (samples wrap across the seams, as the screen's pattern does), slid by the scroll.
 */
export function sampleAffine(src: Surface, m: Mat, area: Rect, tiling: Tiling | null = null): TransformedImage {
  const empty = (r: Rect): TransformedImage => ({ x: r.x, y: r.y, w: 0, h: 0, data: new Uint8ClampedArray(0) });
  const wrapX = tiling?.x === true;
  const wrapY = tiling?.y === true;
  let r: Rect | null = area;
  if (!wrapX && !wrapY) {
    const b = matApplyRect(m, { x: 0, y: 0, w: src.width, h: src.height });
    const box = { x: Math.floor(b.x + 1e-6), y: Math.floor(b.y + 1e-6), w: 0, h: 0 };
    box.w = Math.ceil(b.x + b.w - 1e-6) - box.x;
    box.h = Math.ceil(b.y + b.h - 1e-6) - box.y;
    r = rectIntersect(box, area);
  }
  const inv = matInvert(m);
  if (!r || !inv) return empty(area);
  const { x: x0, y: y0, w: ow, h: oh } = r;
  const out = new Uint8ClampedArray(ow * oh * 4);
  const { width: w, height: h, cols, tiles } = src;
  const [ia, ib, ic, id, ie, iff] = inv;
  const sx0 = wrapX ? tiling!.scrollX : 0;
  const sy0 = wrapY ? tiling!.scrollY : 0;
  for (let oy = 0; oy < oh; oy++) {
    const dy = y0 + oy + 0.5;
    for (let ox = 0; ox < ow; ox++) {
      const dx = x0 + ox + 0.5;
      const fx = ia * dx + ic * dy + ie - sx0 - 0.5;
      const fy = ib * dx + id * dy + iff - sy0 - 0.5;
      const px = Math.floor(fx);
      const py = Math.floor(fy);
      if ((!wrapX && (px < -1 || px >= w)) || (!wrapY && (py < -1 || py >= h))) continue;
      const tx = fx - px;
      const ty = fy - py;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      for (let k = 0; k < 4; k++) {
        let qx = px + (k & 1);
        let qy = py + (k >> 1);
        if (wrapX) qx = mod(qx, w);
        else if (qx < 0 || qx >= w) continue;
        if (wrapY) qy = mod(qy, h);
        else if (qy < 0 || qy >= h) continue;
        const wt = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
        if (wt === 0) continue;
        const tile = tiles[((qy / TILE_SIZE) | 0) * cols + ((qx / TILE_SIZE) | 0)];
        if (!tile) continue;
        const si = ((qy % TILE_SIZE) * TILE_SIZE + (qx % TILE_SIZE)) * 4;
        const sa = tile[si + 3] * wt;
        cr += tile[si] * sa;
        cg += tile[si + 1] * sa;
        cb += tile[si + 2] * sa;
        ca += sa;
      }
      if (ca > 0) {
        const di = (oy * ow + ox) * 4;
        out[di] = cr / ca;
        out[di + 1] = cg / ca;
        out[di + 2] = cb / ca;
        out[di + 3] = ca;
      }
    }
  }
  return { x: x0, y: y0, w: ow, h: oh, data: out };
}
