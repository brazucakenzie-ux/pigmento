import { toneWeight } from '../brush/retouch';
import { applyLut, clamp255, luma, lut, mapPixels } from './common';
import { bool, curve, num, str, type FilterDef, type FilterParams } from './types';

/** Adjustments change each pixel's colour on its own (no neighbours), keeping alpha. */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number, out: number[]): void {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) {
    out[0] = out[1] = out[2] = l * 255;
    return;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  out[0] = f(hue + 1 / 3) * 255;
  out[1] = f(hue) * 255;
  out[2] = f(hue - 1 / 3) * 255;
}

/** A smooth curve through the points (monotone cubic, so it never overshoots), at x. */
export function smoothCurveAt(pts: readonly (readonly [number, number])[], x: number): number {
  const n = pts.length;
  if (n === 0) return x;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push(dx[i] > 0 ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
  t.push(m[n - 2]);
  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const h = dx[i];
  if (h <= 0) return pts[i + 1][1];
  const s = (x - pts[i][0]) / h;
  const h00 = 2 * s * s * s - 3 * s * s + 1;
  const h10 = s * s * s - 2 * s * s + s;
  const h01 = -2 * s * s * s + 3 * s * s;
  const h11 = s * s * s - s * s;
  return h00 * pts[i][1] + h10 * h * t[i] + h01 * pts[i + 1][1] + h11 * h * t[i + 1];
}

const TONES = ['shadows', 'midtones', 'highlights'] as const;
const AXES = ['cyanRed', 'magentaGreen', 'yellowBlue'] as const;

const balanceParams = TONES.flatMap((tone) =>
  AXES.map((axis, i) => ({
    key: `${tone}.${axis}`,
    type: 'slider' as const,
    labelKey: `filterParam.${axis}` as const,
    section: i === 0 ? (`filterParam.tone.${tone}` as const) : undefined,
    min: -100,
    max: 100,
    default: 0,
  })),
);

export const ADJUSTMENTS: FilterDef[] = [
  {
    id: 'brightnessContrast',
    kind: 'adjustment',
    group: 'tone',
    labelKey: 'filter.brightnessContrast',
    icon: 'brightness',
    params: [
      { key: 'brightness', type: 'slider', labelKey: 'filterParam.brightness', min: -100, max: 100, default: 0 },
      { key: 'contrast', type: 'slider', labelKey: 'filterParam.contrast', min: -100, max: 100, default: 0 },
    ],
    run: ({ data }, p) => {
      const b = num(p, 'brightness', 0) / 200;
      const c = num(p, 'contrast', 0) / 100;
      const k = c > 0 ? 1 / (1 - c * 0.99) : 1 + c;
      return applyLut(data, lut((v) => clamp255(((v / 255 - 0.5) * k + 0.5 + b) * 255)));
    },
  },
  {
    id: 'hueSaturation',
    kind: 'adjustment',
    group: 'color',
    labelKey: 'filter.hueSaturation',
    icon: 'palette',
    params: [
      { key: 'hue', type: 'slider', labelKey: 'filterParam.hue', min: -180, max: 180, unit: '°', default: 0 },
      { key: 'saturation', type: 'slider', labelKey: 'filterParam.saturation', min: -100, max: 100, default: 0 },
      { key: 'lightness', type: 'slider', labelKey: 'filterParam.lightness', min: -100, max: 100, default: 0 },
      { key: 'colorize', type: 'toggle', labelKey: 'filterParam.colorize', default: false },
    ],
    run: ({ data }, p) => {
      const dh = num(p, 'hue', 0);
      const ds = num(p, 'saturation', 0) / 100;
      const dl = num(p, 'lightness', 0) / 100;
      const colorize = bool(p, 'colorize', false);
      return mapPixels(data, (r, g, b, out) => {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (colorize) {
          h = dh;
          s = (ds + 1) / 2;
        } else {
          h += dh;
          s = ds < 0 ? s * (1 + ds) : s + (1 - s) * ds;
        }
        l = dl < 0 ? l * (1 + dl) : l + (1 - l) * dl;
        hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)), out);
      });
    },
  },
  {
    id: 'levels',
    kind: 'adjustment',
    group: 'tone',
    labelKey: 'filter.levels',
    icon: 'levels',
    params: [
      { key: 'inBlack', type: 'slider', labelKey: 'filterParam.inBlack', section: 'filterParam.input', min: 0, max: 254, default: 0 },
      { key: 'gamma', type: 'slider', labelKey: 'filterParam.gamma', min: 0.1, max: 9.99, step: 0.01, default: 1 },
      { key: 'inWhite', type: 'slider', labelKey: 'filterParam.inWhite', min: 1, max: 255, default: 255 },
      { key: 'outBlack', type: 'slider', labelKey: 'filterParam.outBlack', section: 'filterParam.output', min: 0, max: 255, default: 0 },
      { key: 'outWhite', type: 'slider', labelKey: 'filterParam.outWhite', min: 0, max: 255, default: 255 },
    ],
    run: ({ data }, p) => {
      const ib = num(p, 'inBlack', 0);
      const iw = Math.max(ib + 1, num(p, 'inWhite', 255));
      const g = Math.max(0.01, num(p, 'gamma', 1));
      const ob = num(p, 'outBlack', 0);
      const ow = num(p, 'outWhite', 255);
      return applyLut(data, lut((v) => ob + Math.min(1, Math.max(0, (v - ib) / (iw - ib))) ** (1 / g) * (ow - ob)));
    },
  },
  {
    id: 'curves',
    kind: 'adjustment',
    group: 'tone',
    labelKey: 'filter.curves',
    icon: 'curve',
    params: [
      {
        key: 'channel',
        type: 'choice',
        labelKey: 'filterParam.channel',
        default: 'rgb',
        choices: [
          { value: 'rgb', labelKey: 'filterParam.channel.rgb' },
          { value: 'r', labelKey: 'filterParam.channel.r' },
          { value: 'g', labelKey: 'filterParam.channel.g' },
          { value: 'b', labelKey: 'filterParam.channel.b' },
        ],
      },
      ...(['rgb', 'r', 'g', 'b'] as const).map((c) => ({
        key: `curve.${c}`,
        type: 'curve' as const,
        labelKey: `filterParam.channel.${c}` as const,
        default: [
          [0, 0],
          [1, 1],
        ] as const,
        showIf: (p: FilterParams) => str(p, 'channel', 'rgb') === c,
      })),
    ],
    run: ({ data }, p) => {
      const all = curve(p, 'curve.rgb');
      const one = (c: 'r' | 'g' | 'b') => {
        const own = curve(p, `curve.${c}`);
        return lut((v) => 255 * Math.min(1, Math.max(0, smoothCurveAt(all, Math.min(1, Math.max(0, smoothCurveAt(own, v / 255)))))));
      };
      return applyLut(data, one('r'), one('g'), one('b'));
    },
  },
  {
    id: 'colorBalance',
    kind: 'adjustment',
    group: 'color',
    labelKey: 'filter.colorBalance',
    icon: 'balance',
    params: [...balanceParams, { key: 'preserveLuminosity', type: 'toggle', labelKey: 'filterParam.preserveLuminosity', default: true }],
    run: ({ data }, p) => {
      const shift = TONES.map((tone) => AXES.map((axis) => num(p, `${tone}.${axis}`, 0) / 100));
      const keep = bool(p, 'preserveLuminosity', true);
      return mapPixels(data, (r, g, b, out) => {
        const l = luma(r, g, b) / 255;
        let dr = 0;
        let dg = 0;
        let db = 0;
        TONES.forEach((tone, i) => {
          const w = toneWeight(tone, l) * 0.4 * 255;
          dr += shift[i][0] * w;
          dg += shift[i][1] * w;
          db += shift[i][2] * w;
        });
        let nr = clamp255(r + dr);
        let ng = clamp255(g + dg);
        let nb = clamp255(b + db);
        if (keep) {
          const d = luma(r, g, b) - luma(nr, ng, nb);
          nr = clamp255(nr + d);
          ng = clamp255(ng + d);
          nb = clamp255(nb + d);
        }
        out[0] = nr;
        out[1] = ng;
        out[2] = nb;
      });
    },
  },
  {
    id: 'grayscale',
    kind: 'adjustment',
    group: 'color',
    labelKey: 'filter.grayscale',
    icon: 'grayscale',
    params: [],
    run: ({ data }) =>
      mapPixels(data, (r, g, b, out) => {
        out[0] = out[1] = out[2] = luma(r, g, b);
      }),
  },
  {
    id: 'sepia',
    kind: 'adjustment',
    group: 'color',
    labelKey: 'filter.sepia',
    icon: 'sepia',
    params: [{ key: 'amount', type: 'slider', labelKey: 'filterParam.amount', min: 0, max: 100, unit: '%', default: 100 }],
    run: ({ data }, p) => {
      const k = num(p, 'amount', 100) / 100;
      return mapPixels(data, (r, g, b, out) => {
        const sr = 0.393 * r + 0.769 * g + 0.189 * b;
        const sg = 0.349 * r + 0.686 * g + 0.168 * b;
        const sb = 0.272 * r + 0.534 * g + 0.131 * b;
        out[0] = r + (sr - r) * k;
        out[1] = g + (sg - g) * k;
        out[2] = b + (sb - b) * k;
      });
    },
  },
  {
    id: 'invert',
    kind: 'adjustment',
    group: 'color',
    labelKey: 'filter.invert',
    icon: 'invert',
    params: [],
    run: ({ data }) => applyLut(data, lut((v) => 255 - v)),
  },
  {
    id: 'posterize',
    kind: 'adjustment',
    group: 'tone',
    labelKey: 'filter.posterize',
    icon: 'posterize',
    params: [{ key: 'levels', type: 'slider', labelKey: 'filterParam.levels', min: 2, max: 64, default: 4 }],
    run: ({ data }, p) => {
      const n = Math.max(2, Math.round(num(p, 'levels', 4)));
      return applyLut(data, lut((v) => (Math.min(n - 1, Math.floor((v / 256) * n)) * 255) / (n - 1)));
    },
  },
  {
    id: 'threshold',
    kind: 'adjustment',
    group: 'tone',
    labelKey: 'filter.threshold',
    icon: 'threshold',
    params: [{ key: 'level', type: 'slider', labelKey: 'filterParam.level', min: 1, max: 255, default: 128 }],
    run: ({ data }, p) => {
      const t = num(p, 'level', 128);
      return mapPixels(data, (r, g, b, out) => {
        out[0] = out[1] = out[2] = luma(r, g, b) >= t ? 255 : 0;
      });
    },
  },
];
