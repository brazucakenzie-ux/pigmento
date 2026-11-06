import { PathBuilder } from '../path';
import { defineShape, type ShapeDef } from '../ShapeRegistry';
import { fit, pct, plusPts, rotate, unit, type Pt } from './util';

const thickness = { key: 'thickness', min: 5, max: 60, default: 28 };

/** Cubic path through unit-square points: start, then groups of three (two controls + end). */
function curves(
  b: PathBuilder,
  w: number,
  h: number,
  pts: readonly (readonly [number, number])[],
): PathBuilder {
  const u = unit(w, h)(pts);
  b.m(u[0][0], u[0][1]);
  for (let i = 1; i + 2 < u.length; i += 3)
    b.c(u[i][0], u[i][1], u[i + 1][0], u[i + 1][1], u[i + 2][0], u[i + 2][1]);
  return b.z();
}

/** Symbols, maths signs and banners. */
export const SYMBOLS: ShapeDef[] = [
  defineShape('heart', 'symbols', {
    keywords: ['love', 'like', 'valentine'],
    build: (b, w, h) =>
      void curves(b, w, h, [
        [0.5, 1],
        [0.1, 0.7],
        [0, 0.45],
        [0, 0.3],
        [0, 0.1],
        [0.15, 0],
        [0.3, 0],
        [0.4, 0],
        [0.5, 0.1],
        [0.5, 0.2],
        [0.5, 0.1],
        [0.6, 0],
        [0.7, 0],
        [0.85, 0],
        [1, 0.1],
        [1, 0.3],
        [1, 0.45],
        [0.9, 0.7],
        [0.5, 1],
      ]),
  }),
  defineShape('check', 'symbols', {
    keywords: ['tick', 'done', 'yes', 'ok'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0, 0.55],
          [0.15, 0.4],
          [0.38, 0.62],
          [0.85, 0],
          [1, 0.15],
          [0.38, 1],
        ]),
      ),
  }),
  defineShape('cross', 'symbols', {
    keywords: ['x', 'no', 'close', 'delete'],
    params: [{ ...thickness, default: 30 }],
    build: (b, w, h, p) =>
      void b.poly(fit(rotate(plusPts(pct(p.thickness)), Math.PI / 4, 0, 0), w, h)),
  }),
  defineShape('no-symbol', 'symbols', {
    keywords: ['forbidden', 'prohibited', 'ban'],
    fillRule: 'nonzero',
    params: [{ ...thickness, default: 18 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * 0.5;
      b.ellipse(w / 2, h / 2, w / 2, h / 2).ellipse(
        w / 2,
        h / 2,
        (w / 2) * (1 - t),
        (h / 2) * (1 - t),
        true,
      );
      const bar = rotate(
        [
          [-0.95, -t * 0.5],
          [0.95, -t * 0.5],
          [0.95, t * 0.5],
          [-0.95, t * 0.5],
        ],
        Math.PI / 4,
        0,
        0,
      );
      b.poly(bar.map(([x, y]) => [w / 2 + (x * w) / 2, h / 2 + (y * h) / 2] as Pt));
    },
  }),
  defineShape('lightning', 'symbols', {
    keywords: ['bolt', 'flash', 'electric', 'power'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0.58, 0],
          [0.1, 0.56],
          [0.45, 0.56],
          [0.3, 1],
          [0.9, 0.38],
          [0.53, 0.38],
          [0.78, 0],
        ]),
      ),
  }),
  defineShape('gear', 'symbols', {
    keywords: ['cog', 'settings', 'machine'],
    fillRule: 'nonzero',
    params: [
      { key: 'teeth', min: 6, max: 32, default: 10, unit: '' },
      { key: 'hole', min: 0, max: 70, default: 35 },
    ],
    build: (b, w, h, p) => {
      const n = Math.round(p.teeth);
      const pts: Pt[] = [];
      const ro = 1;
      const ri = 0.78;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const s = Math.PI / n;
        pts.push([Math.cos(a - s * 0.55) * ri, Math.sin(a - s * 0.55) * ri]);
        pts.push([Math.cos(a - s * 0.3) * ro, Math.sin(a - s * 0.3) * ro]);
        pts.push([Math.cos(a + s * 0.3) * ro, Math.sin(a + s * 0.3) * ro]);
        pts.push([Math.cos(a + s * 0.55) * ri, Math.sin(a + s * 0.55) * ri]);
      }
      b.poly(fit([...pts, [-1, -1], [1, 1]], w, h).slice(0, pts.length));
      const k = pct(p.hole) * ri;
      if (k > 0) b.ellipse(w / 2, h / 2, (w / 2) * k, (h / 2) * k, true);
    },
  }),
  defineShape('padlock', 'symbols', {
    keywords: ['lock', 'secure', 'private'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.roundRect(0, h * 0.42, w, h * 0.58, Math.min(w, h) * 0.08);
      const t = w * 0.12;
      b.arc(w / 2, h * 0.42, w * 0.36, h * 0.4, Math.PI, Math.PI * 2)
        .l(w * 0.86, h * 0.42)
        .l(w * 0.86 - t, h * 0.42)
        .arc(w / 2, h * 0.42, w * 0.36 - t, h * 0.4 - t, 0, -Math.PI, true)
        .l(w * 0.14, h * 0.42)
        .z();
      b.ellipse(w / 2, h * 0.66, w * 0.08, h * 0.07, true);
    },
  }),
  defineShape('house', 'symbols', {
    keywords: ['home', 'building'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0.5, 0],
          [1, 0.45],
          [0.85, 0.45],
          [0.85, 1],
          [0.15, 1],
          [0.15, 0.45],
          [0, 0.45],
        ]),
      ),
  }),
  defineShape('bookmark', 'symbols', {
    keywords: ['save', 'ribbon', 'flag'],
    params: [{ key: 'notch', min: 0, max: 60, default: 25 }],
    build: (b, w, h, p) =>
      void b.poly([
        [0, 0],
        [w, 0],
        [w, h],
        [w / 2, h * (1 - pct(p.notch))],
        [0, h],
      ]),
  }),
  defineShape('location-pin', 'symbols', {
    keywords: ['map', 'marker', 'place', 'gps'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const r = Math.min(w / 2, h * 0.36);
      const cy = r;
      b.m(w / 2, h)
        .c(w / 2 - r * 0.3, h * 0.75, w / 2 - r, cy + r * 0.75, w / 2 - r, cy)
        .arc(w / 2, cy, r, r, Math.PI, Math.PI * 2, true)
        .c(w / 2 + r, cy + r * 0.75, w / 2 + r * 0.3, h * 0.75, w / 2, h)
        .z();
      b.ellipse(w / 2, cy, r * 0.42, r * 0.42, true);
    },
  }),
  defineShape('shield', 'symbols', {
    keywords: ['security', 'protect', 'badge'],
    build: (b, w, h) => {
      const u = unit(w, h);
      const pts = u([
        [0.5, 0],
        [1, 0.15],
        [1, 0.45],
        [1, 0.75],
        [0.75, 0.9],
        [0.5, 1],
        [0.25, 0.9],
        [0, 0.75],
        [0, 0.45],
        [0, 0.15],
      ]);
      b.m(pts[0][0], pts[0][1])
        .l(pts[1][0], pts[1][1])
        .l(pts[2][0], pts[2][1])
        .c(pts[3][0], pts[3][1], pts[4][0], pts[4][1], pts[5][0], pts[5][1])
        .c(pts[6][0], pts[6][1], pts[7][0], pts[7][1], pts[8][0], pts[8][1])
        .l(pts[9][0], pts[9][1])
        .z();
    },
  }),
  defineShape('crown', 'symbols', {
    keywords: ['king', 'queen', 'royal', 'winner'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const u = unit(w, h);
      b.poly(
        u([
          [0, 0.15],
          [0.27, 0.5],
          [0.5, 0],
          [0.73, 0.5],
          [1, 0.15],
          [0.9, 0.82],
          [0.1, 0.82],
        ]),
      );
      b.poly(
        u([
          [0.1, 0.88],
          [0.9, 0.88],
          [0.9, 1],
          [0.1, 1],
        ]),
      );
    },
  }),
  defineShape('tag', 'symbols', {
    keywords: ['label', 'price'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.poly(
        unit(
          w,
          h,
        )([
          [0.25, 0],
          [1, 0],
          [1, 1],
          [0.25, 1],
          [0, 0.5],
        ]),
      );
      b.ellipse(w * 0.27, h * 0.5, Math.min(w, h) * 0.08, Math.min(w, h) * 0.08, true);
    },
  }),
  defineShape('envelope', 'symbols', {
    keywords: ['mail', 'email', 'letter', 'message'],
    build: (b, w, h) => {
      b.rect(0, 0, w, h);
      b.m(0, 0)
        .l(w / 2, h * 0.58)
        .l(w, 0);
    },
  }),
  defineShape('bell', 'symbols', {
    keywords: ['notification', 'alarm', 'ring'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const u = unit(w, h);
      const p = u([
        [0.5, 0.04],
        [0.76, 0.04],
        [0.84, 0.26],
        [0.84, 0.46],
        [0.84, 0.64],
        [1, 0.82],
        [0, 0.82],
        [0.16, 0.64],
        [0.16, 0.46],
        [0.16, 0.26],
        [0.24, 0.04],
      ]);
      b.m(p[0][0], p[0][1])
        .c(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1])
        .l(p[4][0], p[4][1])
        .l(p[5][0], p[5][1])
        .l(p[6][0], p[6][1])
        .l(p[7][0], p[7][1])
        .l(p[8][0], p[8][1])
        .c(p[9][0], p[9][1], p[10][0], p[10][1], p[0][0], p[0][1])
        .z();
      b.ellipse(w / 2, h * 0.91, w * 0.1, h * 0.09);
    },
  }),
  defineShape('smiley', 'symbols', {
    keywords: ['face', 'happy', 'emoji', 'smile'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.ellipse(w / 2, h / 2, w / 2, h / 2);
      b.ellipse(w * 0.35, h * 0.38, w * 0.06, h * 0.08, true);
      b.ellipse(w * 0.65, h * 0.38, w * 0.06, h * 0.08, true);
      b.m(w * 0.27, h * 0.6)
        .q(w * 0.5, h * 0.82, w * 0.73, h * 0.6)
        .q(w * 0.5, h * 0.95, w * 0.27, h * 0.6)
        .z();
    },
  }),
  defineShape('folded-page', 'symbols', {
    keywords: ['document', 'file', 'note', 'paper'],
    params: [{ key: 'fold', min: 5, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const f = pct(p.fold) * Math.min(w, h);
      b.poly([
        [0, 0],
        [w - f, 0],
        [w, f],
        [w, h],
        [0, h],
      ]);
      b.m(w - f, 0)
        .l(w - f, f)
        .l(w, f);
    },
  }),
  defineShape('folder', 'symbols', {
    keywords: ['directory', 'files'],
    build: (b, w, h) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0, 0],
          [0.38, 0],
          [0.46, 0.14],
          [1, 0.14],
          [1, 1],
          [0, 1],
        ]),
      ),
  }),
  defineShape('battery', 'symbols', {
    keywords: ['power', 'charge', 'energy'],
    fillRule: 'nonzero',
    params: [{ key: 'level', min: 0, max: 100, default: 60 }],
    build: (b, w, h, p) => {
      b.rect(0, 0, w * 0.9, h).rect(w * 0.08, h * 0.15, w * 0.74, h * 0.7);
      b.rect(w * 0.9, h * 0.3, w * 0.1, h * 0.4);
      const lv = pct(p.level) * w * 0.66;
      if (lv > 0.5) b.rect(w * 0.12, h * 0.22, lv, h * 0.56);
    },
  }),
  defineShape('puzzle', 'symbols', {
    keywords: ['piece', 'jigsaw', 'plugin'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.rect(0, h * 0.2, w * 0.8, h * 0.8);
      b.ellipse(w * 0.4, h * 0.12, w * 0.13, h * 0.12);
      b.ellipse(w * 0.88, h * 0.6, w * 0.12, h * 0.13);
    },
  }),

  // ---- maths -------------------------------------------------------------------------------
  defineShape('plus', 'math', {
    keywords: ['add', 'cross', 'positive'],
    params: [thickness],
    build: (b, w, h, p) => void b.poly(fit(plusPts(pct(p.thickness)), w, h)),
  }),
  defineShape('minus', 'math', {
    keywords: ['subtract', 'dash', 'negative'],
    params: [thickness],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * h;
      b.rect(0, (h - t) / 2, w, t);
    },
  }),
  defineShape('multiply', 'math', {
    keywords: ['times', 'x'],
    params: [thickness],
    build: (b, w, h, p) =>
      void b.poly(fit(rotate(plusPts(pct(p.thickness)), Math.PI / 4, 0, 0), w, h)),
  }),
  defineShape('divide', 'math', {
    keywords: ['division', 'obelus'],
    fillRule: 'nonzero',
    params: [{ ...thickness, default: 18 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * h;
      b.rect(0, (h - t) / 2, w, t);
      const r = Math.min(w * 0.12, h * 0.14);
      b.ellipse(w / 2, r, r, r).ellipse(w / 2, h - r, r, r);
    },
  }),
  defineShape('equal', 'math', {
    keywords: ['equals', 'same'],
    fillRule: 'nonzero',
    params: [thickness],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * h;
      b.rect(0, h * 0.15, w, t).rect(0, h * 0.85 - t, w, t);
    },
  }),
  defineShape('not-equal', 'math', {
    keywords: ['unequal', 'different'],
    fillRule: 'nonzero',
    params: [{ ...thickness, default: 20 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * h;
      b.rect(0, h * 0.28, w, t).rect(0, h * 0.72 - t, w, t);
      b.poly([
        [w * 0.6, 0],
        [w * 0.75, 0],
        [w * 0.4, h],
        [w * 0.25, h],
      ]);
    },
  }),
  defineShape('plus-minus', 'math', {
    keywords: ['tolerance', 'approximately'],
    fillRule: 'nonzero',
    params: [{ ...thickness, default: 16 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness);
      const top = fit(plusPts(t * 1.6), w, h * 0.72);
      b.poly(top);
      b.rect(0, h - t * h, w, t * h);
    },
  }),
  defineShape('percent', 'math', {
    keywords: ['%', 'per cent', 'discount'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.poly([
        [w * 0.75, 0],
        [w * 0.92, 0],
        [w * 0.25, h],
        [w * 0.08, h],
      ]);
      b.ellipse(w * 0.2, h * 0.2, w * 0.2, h * 0.2).ellipse(
        w * 0.2,
        h * 0.2,
        w * 0.09,
        h * 0.09,
        true,
      );
      b.ellipse(w * 0.8, h * 0.8, w * 0.2, h * 0.2).ellipse(
        w * 0.8,
        h * 0.8,
        w * 0.09,
        h * 0.09,
        true,
      );
    },
  }),
  defineShape('infinity', 'math', {
    keywords: ['forever', 'loop', 'lemniscate'],
    strokeOnly: true,
    build: (b, w, h) => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 96; i++) {
        const t = (i / 96) * Math.PI * 2;
        const d = 1 + Math.sin(t) * Math.sin(t);
        pts.push([Math.cos(t) / d, (Math.sin(t) * Math.cos(t)) / d]);
      }
      b.poly(fit(pts, w, h), false);
    },
  }),

  // ---- banners -----------------------------------------------------------------------------
  defineShape('ribbon-banner', 'banners', {
    keywords: ['ribbon', 'title', 'award'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const u = unit(w, h);
      b.rect(w * 0.15, 0, w * 0.7, h * 0.72);
      b.poly(
        u([
          [0, 0.28],
          [0.15, 0.28],
          [0.15, 1],
          [0, 1],
          [0.07, 0.64],
        ]),
      );
      b.poly(
        u([
          [1, 0.28],
          [0.85, 0.28],
          [0.85, 1],
          [1, 1],
          [0.93, 0.64],
        ]),
      );
    },
  }),
  defineShape('scroll', 'banners', {
    keywords: ['parchment', 'paper', 'old'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const r = Math.min(w, h) * 0.12;
      b.rect(r, r, w - 2 * r, h - 2 * r);
      b.ellipse(r, h - r * 1.6, r, r * 1.2).ellipse(w - r, r * 1.6, r, r * 1.2);
      b.rect(0, h - r * 1.6, r, r * 0.6).rect(w - r, r, r, r * 0.6);
    },
  }),
  defineShape('scroll-vertical', 'banners', {
    keywords: ['parchment', 'paper', 'list'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const r = Math.min(w, h) * 0.12;
      b.rect(r, r, w - 2 * r, h - 2 * r);
      b.ellipse(r * 1.6, r, r * 1.2, r).ellipse(w - r * 1.6, h - r, r * 1.2, r);
    },
  }),
  defineShape('wave-banner', 'banners', {
    keywords: ['flag', 'wavy'],
    params: [{ key: 'waves', min: 1, max: 6, default: 2, unit: '' }],
    build: (b, w, h, p) => {
      const amp = h * 0.1;
      const n = Math.round(p.waves);
      b.m(0, amp)
        .wave(0, w, amp, amp * 0.9, n, true)
        .l(w, h - amp)
        .wave(w, 0, h - amp, -amp * 0.9, n, true)
        .z();
    },
  }),
  defineShape('double-wave', 'banners', {
    keywords: ['flag', 'wavy', 'cloth'],
    build: (b, w, h) => {
      const amp = h * 0.1;
      b.m(0, amp)
        .wave(0, w, amp, amp * 0.9, 4, true)
        .l(w, h - amp)
        .wave(w, 0, h - amp, -amp * 0.9, 4, true)
        .z();
    },
  }),
  defineShape('flag', 'banners', {
    keywords: ['pole', 'country', 'goal'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      b.rect(0, 0, w * 0.06, h);
      b.m(w * 0.06, h * 0.05)
        .c(w * 0.4, 0, w * 0.65, h * 0.18, w, h * 0.05)
        .l(w, h * 0.55)
        .c(w * 0.65, h * 0.68, w * 0.4, h * 0.45, w * 0.06, h * 0.55)
        .z();
    },
  }),
  defineShape('pennant', 'banners', {
    keywords: ['flag', 'triangle', 'sports'],
    build: (b, w, h) =>
      void b.poly([
        [0, 0],
        [w, h / 2],
        [0, h],
      ]),
  }),
  defineShape('rosette', 'banners', {
    keywords: ['award', 'prize', 'medal', 'badge'],
    fillRule: 'nonzero',
    build: (b, w, h) => {
      const u = unit(w, h);
      b.poly(
        u([
          [0.3, 0.55],
          [0.47, 0.6],
          [0.4, 1],
          [0.3, 0.9],
          [0.18, 0.95],
        ]),
      );
      b.poly(
        u([
          [0.7, 0.55],
          [0.53, 0.6],
          [0.6, 1],
          [0.7, 0.9],
          [0.82, 0.95],
        ]),
      );
      b.poly(fit(PathBuilder.star(0, 0, 1, 1, 16, 0.86), w, h * 0.72));
    },
  }),
  defineShape('ticket', 'banners', {
    keywords: ['coupon', 'admission', 'voucher'],
    build: (b, w, h) => {
      const r = Math.min(w * 0.08, h * 0.18);
      b.m(0, 0)
        .l(w, 0)
        .l(w, h / 2 - r)
        .arc(w, h / 2, r, r, -Math.PI / 2, -Math.PI * 1.5, true)
        .l(w, h)
        .l(0, h)
        .l(0, h / 2 + r)
        .arc(0, h / 2, r, r, Math.PI / 2, -Math.PI / 2, true)
        .z();
    },
  }),
  defineShape('swallowtail', 'banners', {
    keywords: ['ribbon', 'end', 'flag'],
    params: [{ key: 'notch', min: 0, max: 50, default: 20 }],
    build: (b, w, h, p) =>
      void b.poly([
        [0, 0],
        [w, 0],
        [w * (1 - pct(p.notch)), h / 2],
        [w, h],
        [0, h],
      ]),
  }),
];
