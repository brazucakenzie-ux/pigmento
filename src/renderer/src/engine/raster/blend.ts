import type { Rect } from '../core/geometry';
import type { BlendMode, Layer, RasterLayer } from '../doc/Document';
import type { Surface } from './Surface';
import { applyImage, type PixelView } from './pixels';

/**
 * Blend modes from the W3C Compositing and Blending spec (what Canvas 2D implements), applied
 * with source-over in straight alpha. Used for flatten, export, merge and colour sampling so
 * that saved files match what the screen shows.
 */

type Separable = (cb: number, cs: number) => number;

const hardLight: Separable = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));

const SEPARABLE: Partial<Record<BlendMode, Separable>> = {
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: (cb, cs) => Math.min(cb, cs),
  lighten: (cb, cs) => Math.max(cb, cs),
  'color-dodge': (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  'color-burn': (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  'hard-light': hardLight,
  'soft-light': (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  },
  difference: (cb, cs) => Math.abs(cb - cs),
};

type Rgb = [number, number, number];

const lum = (c: Rgb) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

function clipColor(c: Rgb): Rgb {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let out: Rgb = [c[0], c[1], c[2]];
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as Rgb;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as Rgb;
  return out;
}

function setLum(c: Rgb, l: number): Rgb {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
}

const sat = (c: Rgb) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c: Rgb, s: number): Rgb {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  const out: Rgb = [0, 0, 0];
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
    out[mx] = s;
  }
  return out;
}

const NON_SEPARABLE: Partial<Record<BlendMode, (cb: Rgb, cs: Rgb) => Rgb>> = {
  hue: (cb, cs) => setLum(setSat(cs, sat(cb)), lum(cb)),
  saturation: (cb, cs) => setLum(setSat(cb, sat(cs)), lum(cb)),
  color: (cb, cs) => setLum(cs, lum(cb)),
  luminosity: (cb, cs) => setLum(cb, lum(cs)),
};

/** Blend one pixel in place: dst (straight RGBA 0–255) under a source pixel with alpha `as`. */
export function blendPixel(
  d: Uint8ClampedArray,
  di: number,
  sr: number,
  sg: number,
  sb: number,
  as: number,
  mode: BlendMode,
): void {
  if (as <= 0) return;
  const ab = d[di + 3] / 255;
  const cb: Rgb = [d[di] / 255, d[di + 1] / 255, d[di + 2] / 255];
  const cs: Rgb = [sr / 255, sg / 255, sb / 255];
  let mixed: Rgb = cs;
  if (mode !== 'normal' && ab > 0) {
    const sep = SEPARABLE[mode];
    let b: Rgb;
    if (sep) b = [sep(cb[0], cs[0]), sep(cb[1], cs[1]), sep(cb[2], cs[2])];
    else b = NON_SEPARABLE[mode]!(cb, cs);
    // Where the backdrop is transparent the source shows unblended.
    mixed = [(1 - ab) * cs[0] + ab * b[0], (1 - ab) * cs[1] + ab * b[1], (1 - ab) * cs[2] + ab * b[2]];
  }
  const ao = as + ab * (1 - as);
  if (ao <= 0) return;
  for (let k = 0; k < 3; k++) d[di + k] = ((as * mixed[k] + ab * cb[k] * (1 - as)) / ao) * 255;
  d[di + 3] = ao * 255;
}

/** Blend an RGBA source view into dst inside r with a blend mode and opacity. */
export function blendImage(dst: PixelView, r: Rect, src: PixelView, mode: BlendMode, opacity: number): void {
  if (mode === 'normal') {
    applyImage(dst, r, src, 'over', opacity);
    return;
  }
  const d = dst.data;
  const s = src.data;
  for (let y = r.y; y < r.y + r.h; y++) {
    let di = ((y - dst.oy) * dst.stride + (r.x - dst.ox)) * 4;
    let si = ((y - src.oy) * src.stride + (r.x - src.ox)) * 4;
    for (let x = 0; x < r.w; x++, di += 4, si += 4) {
      const a = (s[si + 3] / 255) * opacity;
      if (a > 0) blendPixel(d, di, s[si], s[si + 1], s[si + 2], a, mode);
    }
  }
}

/**
 * Composite a layer list (bottom to top) into `out` inside r. Groups are isolated: their
 * children are composited into a transparent buffer that is then blended as one layer.
 * `skip` lets callers leave a layer out (e.g. hidden-layer export). With `extras`, a layer
 * that has more to draw (its animated pieces) is copied into its own buffer, drawn on, then
 * blended, exactly as the screen does it.
 */
export function compositeLayers(
  layers: Layer[],
  r: Rect,
  out: PixelView,
  skip?: (l: Layer) => boolean,
  extras?: LayerExtras,
): void {
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0 || skip?.(layer)) continue;
    if (layer.kind === 'raster' || layer.kind === 'vector') {
      const surface = (layer.kind === 'raster' && extras?.surfaceOf?.(layer)) || layer.surface;
      if (extras?.covers(layer, r)) {
        const view: PixelView = { data: new Uint8ClampedArray(r.w * r.h * 4), stride: r.w, ox: r.x, oy: r.y };
        surface.forEachTile(r, (tile, sub) => applyImage(view, sub, tile, 'over', 1), false, true);
        extras.draw(layer, r, view);
        blendImage(out, r, view, layer.blend, layer.opacity);
      } else {
        surface.forEachTile(r, (tile, sub) => blendImage(out, sub, tile, layer.blend, layer.opacity), false, true);
      }
    } else {
      const buf = new Uint8ClampedArray(r.w * r.h * 4);
      const view: PixelView = { data: buf, stride: r.w, ox: r.x, oy: r.y };
      compositeLayers(layer.children, r, view, skip, extras);
      blendImage(out, r, view, layer.blend, layer.opacity);
    }
  }
}

/** More for a layer than its own pixels (its animated pieces). */
export interface LayerExtras {
  /** True if `layer` has something more to draw inside r. */
  covers(layer: Layer, r: Rect): boolean;
  /** Draw it into view (an isolated copy of the layer's pixels) inside r. */
  draw(layer: Layer, r: Rect, view: PixelView): void;
  /** The pixels to use for a pixel layer (its drawing for another frame), if not its own. */
  surfaceOf?(layer: RasterLayer): Surface | null;
}
