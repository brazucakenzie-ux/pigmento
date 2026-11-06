import { defineShape, type ShapeDef } from '../ShapeRegistry';
import { cloud } from './arrows';
import { fit, pct, rotate, unit, type Pt } from './util';

/** Brackets and frames (lines) and nature shapes. */
export const NATURE: ShapeDef[] = [
  defineShape('bracket-left', 'brackets', {
    keywords: ['square bracket', '['],
    strokeOnly: true,
    params: [{ key: 'corner', min: 0, max: 50, default: 0 }],
    build: (b, w, h, p) => {
      const r = pct(p.corner) * Math.min(w, h);
      b.m(w, 0)
        .l(r, 0)
        .q(0, 0, 0, r)
        .l(0, h - r)
        .q(0, h, r, h)
        .l(w, h);
    },
  }),
  defineShape('bracket-right', 'brackets', {
    keywords: ['square bracket', ']'],
    strokeOnly: true,
    params: [{ key: 'corner', min: 0, max: 50, default: 0 }],
    build: (b, w, h, p) => {
      const r = pct(p.corner) * Math.min(w, h);
      b.m(0, 0)
        .l(w - r, 0)
        .q(w, 0, w, r)
        .l(w, h - r)
        .q(w, h, w - r, h)
        .l(0, h);
    },
  }),
  defineShape('bracket-pair', 'brackets', {
    keywords: ['square brackets', '[ ]'],
    strokeOnly: true,
    build: (b, w, h) => {
      const t = w * 0.12;
      b.m(t, 0).l(0, 0).l(0, h).l(t, h);
      b.m(w - t, 0)
        .l(w, 0)
        .l(w, h)
        .l(w - t, h);
    },
  }),
  defineShape('brace-left', 'brackets', {
    keywords: ['curly brace', '{'],
    strokeOnly: true,
    build: (b, w, h) => {
      b.m(w, 0)
        .q(w * 0.5, 0, w * 0.5, h * 0.15)
        .l(w * 0.5, h * 0.38)
        .q(w * 0.5, h * 0.5, 0, h * 0.5)
        .q(w * 0.5, h * 0.5, w * 0.5, h * 0.62)
        .l(w * 0.5, h * 0.85)
        .q(w * 0.5, h, w, h);
    },
  }),
  defineShape('brace-right', 'brackets', {
    keywords: ['curly brace', '}'],
    strokeOnly: true,
    build: (b, w, h) => {
      b.m(0, 0)
        .q(w * 0.5, 0, w * 0.5, h * 0.15)
        .l(w * 0.5, h * 0.38)
        .q(w * 0.5, h * 0.5, w, h * 0.5)
        .q(w * 0.5, h * 0.5, w * 0.5, h * 0.62)
        .l(w * 0.5, h * 0.85)
        .q(w * 0.5, h, 0, h);
    },
  }),
  defineShape('brace-pair', 'brackets', {
    keywords: ['curly braces', '{ }'],
    strokeOnly: true,
    build: (b, w, h) => {
      const bw = w * 0.14;
      b.m(bw, 0)
        .q(bw * 0.5, 0, bw * 0.5, h * 0.15)
        .l(bw * 0.5, h * 0.38)
        .q(bw * 0.5, h * 0.5, 0, h * 0.5)
        .q(bw * 0.5, h * 0.5, bw * 0.5, h * 0.62)
        .l(bw * 0.5, h * 0.85)
        .q(bw * 0.5, h, bw, h);
      const x = w - bw;
      b.m(x, 0)
        .q(x + bw * 0.5, 0, x + bw * 0.5, h * 0.15)
        .l(x + bw * 0.5, h * 0.38)
        .q(x + bw * 0.5, h * 0.5, w, h * 0.5)
        .q(x + bw * 0.5, h * 0.5, x + bw * 0.5, h * 0.62)
        .l(x + bw * 0.5, h * 0.85)
        .q(x + bw * 0.5, h, x, h);
    },
  }),
  defineShape('parentheses', 'brackets', {
    keywords: ['round brackets', '( )'],
    strokeOnly: true,
    build: (b, w, h) => {
      b.m(w * 0.16, 0).q(-w * 0.08, h / 2, w * 0.16, h);
      b.m(w * 0.84, 0).q(w * 1.08, h / 2, w * 0.84, h);
    },
  }),
  defineShape('corner-marks', 'brackets', {
    keywords: ['crop', 'focus', 'viewfinder'],
    strokeOnly: true,
    params: [{ key: 'length', min: 5, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const k = pct(p.length);
      const lx = w * k;
      const ly = h * k;
      b.m(0, ly).l(0, 0).l(lx, 0);
      b.m(w - lx, 0)
        .l(w, 0)
        .l(w, ly);
      b.m(w, h - ly)
        .l(w, h)
        .l(w - lx, h);
      b.m(lx, h)
        .l(0, h)
        .l(0, h - ly);
    },
  }),
  defineShape('angle-brackets', 'brackets', {
    keywords: ['code', 'chevrons', '< >'],
    strokeOnly: true,
    build: (b, w, h) => {
      b.m(w * 0.3, 0)
        .l(0, h / 2)
        .l(w * 0.3, h);
      b.m(w * 0.7, 0)
        .l(w, h / 2)
        .l(w * 0.7, h);
    },
  }),
  defineShape('double-frame', 'brackets', {
    keywords: ['border', 'frame', 'certificate'],
    strokeOnly: true,
    params: [{ key: 'gap', min: 2, max: 30, default: 8 }],
    build: (b, w, h, p) => {
      const g = pct(p.gap) * Math.min(w, h);
      b.rect(0, 0, w, h).rect(g, g, Math.max(0.1, w - 2 * g), Math.max(0.1, h - 2 * g));
    },
  }),

  // ---- nature ------------------------------------------------------------------------------
  defineShape('leaf', 'nature', {
    keywords: ['plant', 'eco', 'green'],
    build: (b, w, h) => {
      b.m(0, h)
        .c(0, h * 0.35, w * 0.35, 0, w, 0)
        .c(w, h * 0.65, w * 0.65, h, 0, h)
        .z();
      b.m(0, h).l(w * 0.72, h * 0.28);
    },
  }),
  defineShape('flower', 'nature', {
    keywords: ['blossom', 'daisy', 'petals'],
    fillRule: 'nonzero',
    params: [
      { key: 'petals', min: 3, max: 16, default: 6, unit: '' },
      { key: 'centre', min: 10, max: 60, default: 30 },
    ],
    build: (b, w, h, p) => {
      const n = Math.round(p.petals);
      // Petals run from the rim of the centre to the edge, so no outline crosses the centre.
      const r0 = pct(p.centre);
      const all: Pt[][] = [];
      for (let i = 0; i < n; i++) {
        const petal: Pt[] = [];
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          petal.push([(1 + r0) / 2 + ((1 - r0) / 2) * Math.cos(a), 0.18 * Math.sin(a)]);
        }
        all.push(rotate(petal, (i / n) * Math.PI * 2 - Math.PI / 2, 0, 0));
      }
      const scaled = fit([...all.flat(), [-1, -1], [1, 1]], w, h);
      for (let i = 0; i < n; i++) b.poly(scaled.slice(i * 24, i * 24 + 24));
      b.ellipse(w / 2, h / 2, (w / 2) * r0, (h / 2) * r0);
    },
  }),
  defineShape('sun', 'nature', {
    keywords: ['sunny', 'weather', 'bright', 'day'],
    fillRule: 'nonzero',
    params: [{ key: 'rays', min: 4, max: 32, default: 12, unit: '' }],
    build: (b, w, h, p) => {
      const n = Math.round(p.rays);
      b.ellipse(w / 2, h / 2, w * 0.3, h * 0.3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const s = Math.PI / n / 2.2;
        const pt = (ang: number, r: number): Pt => [
          w / 2 + (w / 2) * r * Math.cos(ang),
          h / 2 + (h / 2) * r * Math.sin(ang),
        ];
        b.poly([pt(a - s, 0.72), pt(a, 1), pt(a + s, 0.72)]);
      }
    },
  }),
  defineShape('moon', 'nature', {
    keywords: ['crescent', 'night', 'sleep'],
    params: [{ key: 'thickness', min: 10, max: 90, default: 45 }],
    build: (b, w, h, p) => {
      const k = 1 - pct(p.thickness);
      // Outer edge bulges left; the inner edge's bulge sets how thick the crescent is.
      b.m(w, 0)
        .c(-w * 0.3, 0, -w * 0.3, h, w, h)
        .c(w * (0.3 + 0.7 * k) - w * 0.3, h * 0.85, w * (0.3 + 0.7 * k) - w * 0.3, h * 0.15, w, 0)
        .z();
    },
  }),
  defineShape('cloud', 'nature', {
    keywords: ['weather', 'sky', 'storage'],
    build: (b, w, h) => cloud(b, w, h),
  }),
  defineShape('raindrop', 'nature', {
    keywords: ['water', 'drop', 'liquid', 'rain'],
    build: (b, w, h) => {
      b.m(w / 2, 0)
        .c(w / 2, 0, w, h * 0.5, w, h * 0.68)
        .c(w, h * 0.88, w * 0.78, h, w / 2, h)
        .c(w * 0.22, h, 0, h * 0.88, 0, h * 0.68)
        .c(0, h * 0.5, w / 2, 0, w / 2, 0)
        .z();
    },
  }),
  defineShape('snowflake', 'nature', {
    keywords: ['winter', 'cold', 'snow', 'ice'],
    strokeOnly: true,
    build: (b, w, h) => {
      const lines: Pt[][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const arm: Pt[] = [
          [0, 0],
          [Math.cos(a), Math.sin(a)],
        ];
        lines.push(arm);
        for (const r of [0.45, 0.7]) {
          const bx = Math.cos(a) * r;
          const by = Math.sin(a) * r;
          const len = 0.22;
          lines.push([
            [bx + Math.cos(a - 0.7) * len, by + Math.sin(a - 0.7) * len],
            [bx, by],
            [bx + Math.cos(a + 0.7) * len, by + Math.sin(a + 0.7) * len],
          ]);
        }
      }
      const flat = lines.flat();
      const scaled = fit([...flat, [-1, -1], [1, 1]], w, h);
      let k = 0;
      for (const l of lines) {
        b.poly(scaled.slice(k, k + l.length), false);
        k += l.length;
      }
    },
  }),
  defineShape('pine-tree', 'nature', {
    keywords: ['tree', 'forest', 'christmas', 'fir'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0.5, 0],
          [0.82, 0.35],
          [0.66, 0.35],
          [0.92, 0.66],
          [0.6, 0.66],
          [0.6, 1],
          [0.4, 1],
          [0.4, 0.66],
          [0.08, 0.66],
          [0.34, 0.35],
          [0.18, 0.35],
        ]),
      ),
  }),
  defineShape('mountain', 'nature', {
    keywords: ['peak', 'hill', 'landscape'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0, 1],
          [0.34, 0.25],
          [0.5, 0.5],
          [0.7, 0],
          [1, 1],
        ]),
      ),
  }),
  defineShape('wave', 'nature', {
    keywords: ['sea', 'ocean', 'water'],
    params: [{ key: 'waves', min: 1, max: 10, default: 3, unit: '' }],
    build: (b, w, h, p) => {
      const amp = h * 0.18;
      b.m(0, h)
        .l(0, h * 0.4)
        .wave(0, w, h * 0.4, amp, Math.round(p.waves), true)
        .l(w, h)
        .z();
    },
  }),
  defineShape('flame', 'nature', {
    keywords: ['fire', 'hot', 'burn', 'trending'],
    build: (b, w, h) => {
      b.m(w * 0.5, 0)
        .c(w * 0.62, h * 0.22, w * 0.95, h * 0.38, w * 0.92, h * 0.68)
        .c(w * 0.9, h * 0.9, w * 0.72, h, w * 0.5, h)
        .c(w * 0.26, h, w * 0.08, h * 0.88, w * 0.08, h * 0.64)
        .c(w * 0.08, h * 0.44, w * 0.28, h * 0.36, w * 0.32, h * 0.18)
        .c(w * 0.4, h * 0.3, w * 0.46, h * 0.38, w * 0.44, h * 0.48)
        .c(w * 0.56, h * 0.34, w * 0.56, h * 0.14, w * 0.5, 0)
        .z();
    },
  }),
  defineShape('clover', 'nature', {
    keywords: ['luck', 'shamrock', 'leaf'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.ellipse(w * 0.5, h * 0.24, w * 0.22, h * 0.22)
        .ellipse(w * 0.27, h * 0.55, w * 0.22, h * 0.22)
        .ellipse(w * 0.73, h * 0.55, w * 0.22, h * 0.22);
      b.poly([
        [w * 0.47, h * 0.55],
        [w * 0.53, h * 0.55],
        [w * 0.6, h],
        [w * 0.52, h],
      ]);
    },
  }),
  defineShape('spiral', 'nature', {
    keywords: ['swirl', 'snail', 'hypnotic'],
    strokeOnly: true,
    params: [{ key: 'turns', min: 1, max: 8, default: 3, unit: '' }],
    build: (b, w, h, p) => {
      const turns = Math.round(p.turns);
      const steps = turns * 48;
      const pts: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const a = t * turns * Math.PI * 2;
        pts.push([w / 2 + (w / 2) * t * Math.cos(a), h / 2 + (h / 2) * t * Math.sin(a)]);
      }
      b.poly(pts, false);
    },
  }),
  defineShape('waves', 'nature', {
    keywords: ['water', 'wind', 'lines'],
    strokeOnly: true,
    build: (b, w, h) => {
      for (const y of [0.2, 0.5, 0.8]) b.wave(0, w, h * y, h * 0.1, 4, false);
    },
  }),
];
