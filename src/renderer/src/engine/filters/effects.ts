import { alphaOf, blurChannels, clamp255, distanceTo, gaussianRgba, hash2, luma, mapPixels, overColor } from './common';
import { bool, color, num, str, type FilterDef } from './types';

/**
 * Filters read neighbours, so each declares how far (`pad`): bands overlap by that much and
 * the overlap is thrown away. Distances are scaled by `input.scale` for downscaled previews.
 */
const BLACK = { r: 0, g: 0, b: 0, a: 255 };

/** Pixel offset (dx, dy) for an angle in degrees (0 = right, 90 = up) and a distance. */
const offset = (deg: number, d: number) => ({ dx: Math.cos((deg * Math.PI) / 180) * d, dy: -Math.sin((deg * Math.PI) / 180) * d });

export const EFFECTS: FilterDef[] = [
  {
    id: 'gaussianBlur',
    kind: 'filter',
    group: 'blur',
    labelKey: 'filter.gaussianBlur',
    icon: 'blur',
    params: [{ key: 'radius', type: 'slider', labelKey: 'filterParam.radius', min: 0.1, max: 200, step: 0.1, unit: 'px', default: 4 }],
    pad: (p, s) => Math.ceil(num(p, 'radius', 4) * s * 3) + 2,
    run: ({ data, w, h, scale }, p) => gaussianRgba(data, w, h, num(p, 'radius', 4) * scale),
  },
  {
    id: 'motionBlur',
    kind: 'filter',
    group: 'blur',
    labelKey: 'filter.motionBlur',
    icon: 'motion',
    params: [
      { key: 'angle', type: 'slider', labelKey: 'filterParam.angle', min: -180, max: 180, unit: '°', default: 0 },
      { key: 'distance', type: 'slider', labelKey: 'filterParam.distance', min: 1, max: 300, unit: 'px', default: 20 },
    ],
    pad: (p, s) => Math.ceil((num(p, 'distance', 20) * s) / 2) + 2,
    run: ({ data, w, h, scale }, p) => {
      const d = num(p, 'distance', 20) * scale;
      const { dx, dy } = offset(num(p, 'angle', 0), 1);
      // At most 48 samples along the line, read bilinearly, averaged premultiplied.
      const n = Math.max(1, Math.min(48, Math.ceil(d)));
      const out = new Uint8ClampedArray(data.length);
      const px = (x: number, y: number, c: number) => data[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let k = 0; k <= n; k++) {
            const t = n === 0 ? 0 : (k / n - 0.5) * d;
            const sx = x + dx * t;
            const sy = y + dy * t;
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            const fx = sx - x0;
            const fy = sy - y0;
            for (const [ox, oy, wt] of [
              [0, 0, (1 - fx) * (1 - fy)],
              [1, 0, fx * (1 - fy)],
              [0, 1, (1 - fx) * fy],
              [1, 1, fx * fy],
            ] as const) {
              if (wt <= 0) continue;
              const pa = px(x0 + ox, y0 + oy, 3) * wt;
              r += px(x0 + ox, y0 + oy, 0) * pa;
              g += px(x0 + ox, y0 + oy, 1) * pa;
              b += px(x0 + ox, y0 + oy, 2) * pa;
              a += pa;
            }
          }
          const i = (y * w + x) * 4;
          if (a <= 0) continue;
          out[i] = r / a;
          out[i + 1] = g / a;
          out[i + 2] = b / a;
          out[i + 3] = a / (n + 1);
        }
      }
      return out;
    },
  },
  {
    id: 'unsharpMask',
    kind: 'filter',
    group: 'detail',
    labelKey: 'filter.unsharpMask',
    icon: 'sharpen',
    params: [
      { key: 'amount', type: 'slider', labelKey: 'filterParam.amount', min: 1, max: 500, unit: '%', default: 100 },
      { key: 'radius', type: 'slider', labelKey: 'filterParam.radius', min: 0.1, max: 100, step: 0.1, unit: 'px', default: 2 },
      { key: 'threshold', type: 'slider', labelKey: 'filterParam.threshold', min: 0, max: 255, default: 0 },
    ],
    pad: (p, s) => Math.ceil(num(p, 'radius', 2) * s * 3) + 2,
    run: ({ data, w, h, scale }, p) => {
      const blur = gaussianRgba(data, w, h, num(p, 'radius', 2) * scale);
      const k = num(p, 'amount', 100) / 100;
      const th = num(p, 'threshold', 0);
      return mapPixels(data, (r, g, b, out, i) => {
        const d = [r - blur[i], g - blur[i + 1], b - blur[i + 2]];
        const on = Math.abs(luma(d[0], d[1], d[2])) >= th;
        out[0] = clamp255(r + (on ? d[0] * k : 0));
        out[1] = clamp255(g + (on ? d[1] * k : 0));
        out[2] = clamp255(b + (on ? d[2] * k : 0));
      });
    },
  },
  {
    id: 'noise',
    kind: 'filter',
    group: 'detail',
    labelKey: 'filter.noise',
    icon: 'noise',
    params: [
      { key: 'amount', type: 'slider', labelKey: 'filterParam.amount', min: 1, max: 100, unit: '%', default: 20 },
      { key: 'monochrome', type: 'toggle', labelKey: 'filterParam.monochrome', default: true },
    ],
    run: ({ data, w, x0, y0, scale }, p) => {
      const amt = (num(p, 'amount', 20) / 100) * 255;
      const mono = bool(p, 'monochrome', true);
      // Seeded by image position (at full size), so bands and previews agree.
      return mapPixels(data, (r, g, b, out, i) => {
        const pi = i / 4;
        const ix = Math.floor((x0 + (pi % w)) / scale);
        const iy = Math.floor((y0 + Math.floor(pi / w)) / scale);
        const n = (s: number) => (hash2(ix, iy, s) - 0.5) * 2 * amt;
        const m = n(1);
        out[0] = clamp255(r + m);
        out[1] = clamp255(g + (mono ? m : n(2)));
        out[2] = clamp255(b + (mono ? m : n(3)));
      });
    },
  },
  {
    id: 'pixelate',
    kind: 'filter',
    group: 'stylize',
    labelKey: 'filter.pixelate',
    icon: 'pixelate',
    params: [{ key: 'cell', type: 'slider', labelKey: 'filterParam.cell', min: 2, max: 200, unit: 'px', default: 10 }],
    pad: (p, s) => Math.ceil(num(p, 'cell', 10) * s) + 1,
    run: ({ data, w, h, x0, y0, frame, scale }, p) => {
      const cell = Math.max(1, num(p, 'cell', 10) * scale);
      const out = new Uint8ClampedArray(data.length);
      // Cells line up with the area being filtered, wherever the band starts.
      const fx = frame.x * scale;
      const fy = frame.y * scale;
      const cellOf = (v: number, f: number) => Math.floor((v - f) / cell);
      const bx0 = cellOf(x0, fx);
      const bx1 = cellOf(x0 + w - 1, fx);
      const by0 = cellOf(y0, fy);
      const by1 = cellOf(y0 + h - 1, fy);
      for (let cy = by0; cy <= by1; cy++) {
        const ya = Math.max(0, Math.ceil(fy + cy * cell - y0));
        const yb = Math.min(h, Math.ceil(fy + (cy + 1) * cell - y0));
        for (let cx = bx0; cx <= bx1; cx++) {
          const xa = Math.max(0, Math.ceil(fx + cx * cell - x0));
          const xb = Math.min(w, Math.ceil(fx + (cx + 1) * cell - x0));
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          let n = 0;
          for (let y = ya; y < yb; y++) {
            for (let x = xa; x < xb; x++) {
              const i = (y * w + x) * 4;
              const pa = data[i + 3];
              r += data[i] * pa;
              g += data[i + 1] * pa;
              b += data[i + 2] * pa;
              a += pa;
              n++;
            }
          }
          if (!n) continue;
          for (let y = ya; y < yb; y++) {
            for (let x = xa; x < xb; x++) {
              const i = (y * w + x) * 4;
              if (a > 0) {
                out[i] = r / a;
                out[i + 1] = g / a;
                out[i + 2] = b / a;
              }
              out[i + 3] = a / n;
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: 'emboss',
    kind: 'filter',
    group: 'stylize',
    labelKey: 'filter.emboss',
    icon: 'emboss',
    params: [
      { key: 'angle', type: 'slider', labelKey: 'filterParam.angle', min: -180, max: 180, unit: '°', default: 135 },
      { key: 'height', type: 'slider', labelKey: 'filterParam.height', min: 1, max: 10, unit: 'px', default: 2 },
      { key: 'amount', type: 'slider', labelKey: 'filterParam.amount', min: 1, max: 500, unit: '%', default: 100 },
    ],
    pad: (p, s) => Math.ceil(num(p, 'height', 2) * s) + 2,
    run: ({ data, w, h, scale }, p) => {
      const { dx, dy } = offset(num(p, 'angle', 135), Math.max(1, num(p, 'height', 2) * scale));
      const k = num(p, 'amount', 100) / 100;
      const at = (x: number, y: number) => {
        const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
        return luma(data[i], data[i + 1], data[i + 2]);
      };
      return mapPixels(data, (_r, _g, _b, out, i) => {
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        out[0] = out[1] = out[2] = clamp255(128 + (at(x + dx, y + dy) - at(x - dx, y - dy)) * k);
      });
    },
  },
  {
    id: 'edgeDetect',
    kind: 'filter',
    group: 'stylize',
    labelKey: 'filter.edgeDetect',
    icon: 'edges',
    params: [{ key: 'invert', type: 'toggle', labelKey: 'filterParam.darkEdges', default: true }],
    pad: () => 2,
    run: ({ data, w, h }, p) => {
      const dark = bool(p, 'invert', true);
      const L = new Float32Array(w * h);
      for (let q = 0; q < L.length; q++) L[q] = luma(data[q * 4], data[q * 4 + 1], data[q * 4 + 2]);
      const at = (x: number, y: number) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      return mapPixels(data, (_r, _g, _b, out, i) => {
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
        const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
        const m = clamp255(Math.hypot(gx, gy) / 4);
        out[0] = out[1] = out[2] = dark ? 255 - m : m;
      });
    },
  },
  {
    id: 'vignette',
    kind: 'filter',
    group: 'light',
    labelKey: 'filter.vignette',
    icon: 'vignette',
    params: [
      { key: 'amount', type: 'slider', labelKey: 'filterParam.amount', min: -100, max: 100, unit: '%', default: 50 },
      { key: 'size', type: 'slider', labelKey: 'filterParam.size', min: 0, max: 100, unit: '%', default: 50 },
      { key: 'softness', type: 'slider', labelKey: 'filterParam.softness', min: 1, max: 100, unit: '%', default: 50 },
    ],
    run: ({ data, w, x0, y0, frame, scale }, p) => {
      const amt = num(p, 'amount', 50) / 100;
      const inner = (num(p, 'size', 50) / 100) * 0.9;
      const soft = Math.max(0.01, num(p, 'softness', 50) / 100);
      const cx = (frame.x + frame.w / 2) * scale;
      const cy = (frame.y + frame.h / 2) * scale;
      const rx = (frame.w / 2) * scale;
      const ry = (frame.h / 2) * scale;
      const target = amt > 0 ? 0 : 255;
      return mapPixels(data, (r, g, b, out, i) => {
        const q = i / 4;
        const d = Math.hypot((x0 + (q % w) + 0.5 - cx) / rx, (y0 + Math.floor(q / w) + 0.5 - cy) / ry) / Math.SQRT2;
        const t = Math.min(1, Math.max(0, (d - inner) / soft));
        const k = Math.abs(amt) * t * t * (3 - 2 * t);
        out[0] = r + (target - r) * k;
        out[1] = g + (target - g) * k;
        out[2] = b + (target - b) * k;
      });
    },
  },
  {
    id: 'dropShadow',
    kind: 'filter',
    group: 'light',
    labelKey: 'filter.dropShadow',
    icon: 'shadow',
    params: [
      { key: 'angle', type: 'slider', labelKey: 'filterParam.angle', min: -180, max: 180, unit: '°', default: -45 },
      { key: 'distance', type: 'slider', labelKey: 'filterParam.distance', min: 0, max: 200, unit: 'px', default: 10 },
      { key: 'blur', type: 'slider', labelKey: 'filterParam.blur', min: 0, max: 100, unit: 'px', default: 8 },
      { key: 'opacity', type: 'slider', labelKey: 'filterParam.opacity', min: 1, max: 100, unit: '%', default: 60 },
      { key: 'color', type: 'color', labelKey: 'filterParam.color', default: BLACK },
    ],
    pad: (p, s) => Math.ceil((num(p, 'distance', 10) + num(p, 'blur', 8) * 3) * s) + 2,
    run: ({ data, w, h, scale }, p) => {
      const { dx, dy } = offset(num(p, 'angle', -45), num(p, 'distance', 10) * scale);
      const a = alphaOf(data);
      const shadow = new Float32Array(a.length);
      const ox = Math.round(dx);
      const oy = Math.round(dy);
      for (let y = 0; y < h; y++) {
        const sy = y - oy;
        if (sy < 0 || sy >= h) continue;
        for (let x = 0; x < w; x++) {
          const sx = x - ox;
          if (sx >= 0 && sx < w) shadow[y * w + x] = a[sy * w + sx];
        }
      }
      blurChannels(shadow, w, h, 1, num(p, 'blur', 8) * scale);
      const k = num(p, 'opacity', 60) / 100;
      for (let q = 0; q < shadow.length; q++) shadow[q] *= k;
      return overColor(data, shadow, color(p, 'color', BLACK));
    },
  },
  {
    id: 'outerGlow',
    kind: 'filter',
    group: 'light',
    labelKey: 'filter.outerGlow',
    icon: 'glow',
    params: [
      { key: 'size', type: 'slider', labelKey: 'filterParam.size', min: 1, max: 150, unit: 'px', default: 12 },
      { key: 'opacity', type: 'slider', labelKey: 'filterParam.opacity', min: 1, max: 100, unit: '%', default: 75 },
      { key: 'color', type: 'color', labelKey: 'filterParam.color', default: { r: 255, g: 208, b: 64, a: 255 } },
    ],
    pad: (p, s) => Math.ceil(num(p, 'size', 12) * s * 1.5) + 2,
    run: ({ data, w, h, scale }, p) => {
      const glow = alphaOf(data);
      blurChannels(glow, w, h, 1, (num(p, 'size', 12) * scale) / 2);
      const k = (num(p, 'opacity', 75) / 100) * 2;
      for (let q = 0; q < glow.length; q++) glow[q] = Math.min(1, glow[q] * k);
      return overColor(data, glow, color(p, 'color', { r: 255, g: 208, b: 64, a: 255 }));
    },
  },
  {
    id: 'outline',
    kind: 'filter',
    group: 'light',
    labelKey: 'filter.outline',
    icon: 'outline',
    params: [
      { key: 'width', type: 'slider', labelKey: 'filterParam.width', min: 1, max: 100, unit: 'px', default: 3 },
      {
        key: 'position',
        type: 'choice',
        labelKey: 'filterParam.position',
        default: 'outside',
        choices: [
          { value: 'outside', labelKey: 'filterParam.position.outside' },
          { value: 'inside', labelKey: 'filterParam.position.inside' },
        ],
      },
      { key: 'color', type: 'color', labelKey: 'filterParam.color', default: BLACK },
    ],
    pad: (p, s) => Math.ceil(num(p, 'width', 3) * s) + 2,
    run: ({ data, w, h, scale }, p) => {
      const width = num(p, 'width', 3) * scale;
      const c = color(p, 'color', BLACK);
      const inside = str(p, 'position', 'outside') === 'inside';
      const solid = (q: number) => data[q * 4 + 3] >= 128;
      if (!inside) {
        // A ring around the shape: how close each pixel is to it, soft at the outer edge.
        const d = distanceTo(solid, w, h);
        const ring = new Float32Array(d.length);
        for (let q = 0; q < d.length; q++) ring[q] = d[q] <= 0 ? 0 : Math.min(1, Math.max(0, width + 0.5 - d[q]));
        return overColor(data, ring, c);
      }
      // Inside: paint the band along the inner edge over the shape.
      const d = distanceTo((q) => !solid(q), w, h);
      const out = new Uint8ClampedArray(data);
      for (let q = 0; q < d.length; q++) {
        const k = data[q * 4 + 3] === 0 ? 0 : Math.min(1, Math.max(0, width + 0.5 - d[q]));
        if (k <= 0) continue;
        const i = q * 4;
        out[i] = data[i] + (c.r - data[i]) * k;
        out[i + 1] = data[i + 1] + (c.g - data[i + 1]) * k;
        out[i + 2] = data[i + 2] + (c.b - data[i + 2]) * k;
      }
      return out;
    },
  },
];
