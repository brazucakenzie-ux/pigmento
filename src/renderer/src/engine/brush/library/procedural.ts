import { seededRandom } from '../types';
import { makeTip, type Mask, type TipMask } from '../tips';

/**
 * Pigmento's own brush tips and paper grains, generated from seeded noise and simple geometry
 * (nothing is copied from other programs). Tips are 128 px masks; grains tile seamlessly.
 */
const TIP = 128;

function mask(w: number, h: number, f: (x: number, y: number) => number): Mask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.round(Math.min(1, Math.max(0, f(x, y))) * 255);
  return { w, h, data };
}

/** Tileable value noise with `period` cells across `size` px (smoothly interpolated). */
function valueNoise(size: number, period: number, seed: number): (x: number, y: number) => number {
  const rnd = seededRandom(seed);
  const grid = Array.from({ length: period * period }, () => rnd());
  const at = (i: number, j: number) => grid[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
  const cell = size / period;
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Several octaves of value noise, 0–1. */
function fbm(size: number, base: number, octaves: number, seed: number): (x: number, y: number) => number {
  const layers = Array.from({ length: octaves }, (_, k) => valueNoise(size, base * 2 ** k, seed + k * 101));
  return (x, y) => {
    let v = 0;
    let amp = 0.5;
    let total = 0;
    for (const n of layers) {
      v += n(x, y) * amp;
      total += amp;
      amp /= 2;
    }
    return v / total;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Distance from the tip's centre, 0 at the middle and 1 at the edge of the box. */
const radial = (x: number, y: number, n = TIP) => Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;

/** Soft discs at random spots (bristles, droplets, spray). */
function dots(count: number, seed: number, place: (r: () => number) => { x: number; y: number; r: number; v: number }): Mask {
  const rnd = seededRandom(seed);
  const spots = Array.from({ length: count }, () => place(rnd));
  return mask(TIP, TIP, (x, y) => {
    let v = 0;
    for (const s of spots) {
      const d = Math.hypot(x + 0.5 - s.x * TIP, y + 0.5 - s.y * TIP) / (s.r * TIP);
      if (d < 1) v = Math.max(v, s.v * (1 - smooth(0.6, 1, d)));
    }
    return v;
  });
}

/** A filled polygon, anti-aliased by 4×4 supersampling. */
function polygonMask(pts: [number, number][]): Mask {
  const inside = (px: number, py: number) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return mask(TIP, TIP, (x, y) => {
    let n = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside((x + (sx + 0.5) / 4) / TIP, (y + (sy + 0.5) / 4) / TIP)) n++;
    return n / 16;
  });
}

function star(points: number, inner: number, rot = -Math.PI / 2): [number, number][] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = (i % 2 ? inner : 1) * 0.48;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r];
  });
}

/** Thin tapered strokes (grass blades, hairs) from a start point bending to an end. */
function strands(count: number, seed: number, place: (r: () => number) => { x0: number; y0: number; x1: number; y1: number; w: number; bend: number }): Mask {
  const rnd = seededRandom(seed);
  const lines = Array.from({ length: count }, () => place(rnd));
  return mask(TIP, TIP, (x, y) => {
    const px = (x + 0.5) / TIP;
    const py = (y + 0.5) / TIP;
    let v = 0;
    for (const l of lines) {
      // Sample the curve and take the nearest point (cheap enough at 128 px).
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const cx = l.x0 + (l.x1 - l.x0) * t + Math.sin(t * Math.PI) * l.bend;
        const cy = l.y0 + (l.y1 - l.y0) * t;
        const w = l.w * (1 - t * 0.85);
        const d = Math.hypot(px - cx, py - cy) / w;
        if (d < 1) v = Math.max(v, 1 - smooth(0.4, 1, d));
      }
    }
    return v;
  });
}

export function builtinTips(): Record<string, TipMask> {
  const grain = fbm(TIP, 8, 3, 11);
  const fine = fbm(TIP, 16, 3, 23);
  const streak = valueNoise(TIP, 24, 37);
  const wobble = fbm(TIP, 6, 2, 41);
  return {
    // Chalk: a disc that crumbles at its edge and is speckled inside.
    chalk: makeTip(mask(TIP, TIP, (x, y) => (1 - smooth(0.55, 1, radial(x, y) + (grain(x, y) - 0.5) * 0.6)) * (0.55 + 0.45 * smooth(0.25, 0.7, fine(x, y))))),
    // Charcoal: grainier, a little wider than tall.
    charcoal: makeTip(mask(TIP, TIP, (x, y) => (1 - smooth(0.45, 1, Math.hypot(((x + 0.5) / TIP - 0.5) * 1.6, ((y + 0.5) / TIP - 0.5) * 2.4) + (grain(x, y) - 0.5) * 0.8)) * smooth(0.3, 0.75, fine(x, y)))),
    // Crayon: wax streaks along the stroke.
    crayon: makeTip(mask(TIP, TIP, (x, y) => (1 - smooth(0.6, 0.98, radial(x, y))) * (0.45 + 0.55 * smooth(0.3, 0.6, streak(x * 0.15, y))))),
    // Pencil graphite: small, with grain.
    graphite: makeTip(mask(TIP, TIP, (x, y) => (1 - smooth(0.5, 1, radial(x, y))) * (0.5 + 0.5 * fine(x, y)))),
    // Bristles: a cluster of soft hairs.
    bristle: makeTip(
      dots(16, 53, (r) => {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 0.34;
        return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, r: 0.08 + r() * 0.08, v: 0.55 + r() * 0.45 };
      }),
    ),
    // Watercolour: soft middle, darker rim where the pigment pools, an uneven edge.
    watercolor: makeTip(
      mask(TIP, TIP, (x, y) => {
        const d = radial(x, y) + (wobble(x, y) - 0.5) * 0.25;
        if (d >= 1) return 0;
        const body = 0.45 * (1 - smooth(0.2, 1, d));
        const rim = Math.exp(-(((d - 0.82) / 0.1) ** 2)) * 0.6;
        return Math.min(1, body + rim) * (1 - smooth(0.9, 1, d));
      }),
    ),
    // Splatter: droplets, bigger near the middle.
    splatter: makeTip(
      dots(26, 67, (r) => {
        const a = r() * Math.PI * 2;
        const d = r() ** 0.8 * 0.45;
        return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, r: 0.02 + (1 - d * 2) * 0.09 * r(), v: 1 };
      }),
    ),
    // Spray: many tiny dots, denser in the middle.
    spray: makeTip(
      dots(140, 71, (r) => {
        const a = r() * Math.PI * 2;
        const d = r() ** 1.6 * 0.47;
        return { x: 0.5 + Math.cos(a) * d, y: 0.5 + Math.sin(a) * d, r: 0.012 + r() * 0.012, v: 0.6 + r() * 0.4 };
      }),
    ),
    // Sponge: a disc full of holes.
    sponge: makeTip(mask(TIP, TIP, (x, y) => (1 - smooth(0.7, 1, radial(x, y) + (grain(x, y) - 0.5) * 0.3)) * smooth(0.42, 0.55, fine(x * 2, y * 2)))),
    star: makeTip(polygonMask(star(5, 0.42))),
    // Sparkle: a slim four-pointed star with a glow.
    sparkle: makeTip(
      mask(TIP, TIP, (x, y) => {
        const u = Math.abs((x + 0.5) / TIP - 0.5) * 2;
        const v = Math.abs((y + 0.5) / TIP - 0.5) * 2;
        const ray = Math.max(1 - smooth(0, 0.16 * (1 - v) + 0.01, u) - v * 0.1, 1 - smooth(0, 0.16 * (1 - u) + 0.01, v) - u * 0.1);
        const glow = Math.exp(-((u * u + v * v) / 0.09));
        return Math.max(ray * (1 - Math.max(u, v) ** 2), glow);
      }),
    ),
    // Grass: a tuft of blades rising from the bottom.
    grass: makeTip(
      strands(7, 79, (r) => {
        const x0 = 0.3 + r() * 0.4;
        return { x0, y0: 0.98, x1: x0 + (r() - 0.5) * 0.5, y1: 0.05 + r() * 0.35, w: 0.035 + r() * 0.02, bend: (r() - 0.5) * 0.15 };
      }),
    ),
    // Fur: fine hairs mostly pointing one way.
    fur: makeTip(
      strands(26, 83, (r) => {
        const x0 = 0.15 + r() * 0.7;
        const y0 = 0.3 + r() * 0.6;
        return { x0, y0, x1: x0 + (r() - 0.5) * 0.25, y1: y0 - 0.25 - r() * 0.2, w: 0.012 + r() * 0.01, bend: (r() - 0.5) * 0.08 };
      }),
    ),
    // Leaf: two arcs with a vein.
    leaf: makeTip(
      mask(TIP, TIP, (x, y) => {
        const u = (x + 0.5) / TIP - 0.5;
        const v = (y + 0.5) / TIP - 0.5;
        const half = 0.22 * Math.cos(v * Math.PI) ** 1.3;
        const body = 1 - smooth(half - 0.02, half + 0.01, Math.abs(u));
        const vein = smooth(0.004, 0.012, Math.abs(u));
        return Math.abs(v) < 0.48 ? body * (0.45 + 0.55 * vein) : 0;
      }),
    ),
  };
}

export function builtinTextures(): Record<string, Mask> {
  const P = 256;
  const paper = fbm(P, 16, 4, 101);
  const fibre = valueNoise(P, 64, 131);
  const grain = fbm(P, 64, 2, 151);
  const rnd = seededRandom(171);
  const white = Array.from({ length: P * P }, () => rnd());
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  return {
    // Soft, fibrous paper.
    paper: mask(P, P, (x, y) => 0.25 + 0.75 * (0.75 * paper(x, y) + 0.25 * fibre(x * 0.5, y * 2))),
    // Woven canvas: a fine over-under weave with a little noise.
    canvas: mask(P, P, (x, y) => {
      const wx = 0.5 + 0.5 * Math.sin((x / 8) * Math.PI * 2);
      const wy = 0.5 + 0.5 * Math.sin((y / 8) * Math.PI * 2);
      const over = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? wx : wy;
      return 0.3 + 0.55 * over + 0.15 * paper(x, y);
    }),
    // Coarse noise.
    noise: mask(P, P, (x, y) => white[y * P + x]),
    // Fine grain.
    grain: mask(P, P, (x, y) => 0.15 + 0.85 * grain(x, y)),
    // Ordered dither patterns for pixel brushes.
    bayer: mask(4, 4, (x, y) => (bayer[y * 4 + x] + 0.5) / 16),
    checker: mask(2, 2, (x, y) => ((x + y) % 2 ? 0 : 1)),
  };
}
