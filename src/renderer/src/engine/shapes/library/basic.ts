import { PathBuilder } from '../path';
import { defineShape, type ShapeDef } from '../ShapeRegistry';
import { fit, pct, unit } from './util';

const corner = { key: 'corner', min: 0, max: 50, default: 15 };
const thickness = { key: 'thickness', min: 2, max: 48, default: 22 };

/** Basic shapes and polygons. */
export const BASIC: ShapeDef[] = [
  defineShape('rectangle', 'basic', {
    keywords: ['square', 'box', 'rounded'],
    params: [{ ...corner, default: 0 }],
    build: (b, w, h, p) => void b.roundRect(0, 0, w, h, pct(p.corner) * Math.min(w, h)),
  }),
  defineShape('snipped-rect', 'basic', {
    keywords: ['corner', 'cut'],
    params: [{ key: 'snip', min: 0, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const s = pct(p.snip) * Math.min(w, h);
      b.poly([
        [0, 0],
        [w - s, 0],
        [w, s],
        [w, h],
        [0, h],
      ]);
    },
  }),
  defineShape('snipped-2', 'basic', {
    keywords: ['corner', 'cut', 'diagonal'],
    params: [{ key: 'snip', min: 0, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const s = pct(p.snip) * Math.min(w, h);
      b.poly([
        [0, 0],
        [w - s, 0],
        [w, s],
        [w, h],
        [s, h],
        [0, h - s],
      ]);
    },
  }),
  defineShape('chamfered-rect', 'basic', {
    keywords: ['octagon', 'bevel'],
    params: [{ key: 'snip', min: 0, max: 50, default: 20 }],
    build: (b, w, h, p) => {
      const s = pct(p.snip) * Math.min(w, h);
      b.poly([
        [s, 0],
        [w - s, 0],
        [w, s],
        [w, h - s],
        [w - s, h],
        [s, h],
        [0, h - s],
        [0, s],
      ]);
    },
  }),
  defineShape('round-corner', 'basic', {
    keywords: ['tab', 'rounded'],
    params: [{ ...corner, default: 40 }],
    build: (b, w, h, p) => {
      const r = pct(p.corner) * Math.min(w, h);
      b.m(r, 0).l(w, 0).l(w, h).l(0, h).l(0, r).q(0, 0, r, 0).z();
    },
  }),
  defineShape('circle', 'basic', {
    keywords: ['ellipse', 'oval', 'round'],
    build: (b, w, h) => void b.ellipse(w / 2, h / 2, w / 2, h / 2),
  }),
  defineShape('half-circle', 'basic', {
    keywords: ['semicircle', 'dome'],
    build: (b, w, h) => void b.arc(w / 2, h, w / 2, h, Math.PI, Math.PI * 2).z(),
  }),
  defineShape('quarter-circle', 'basic', {
    keywords: ['quadrant', 'pie'],
    build: (b, w, h) =>
      void b
        .m(0, h)
        .l(0, 0)
        .arc(0, h, w, h, -Math.PI / 2, 0, true)
        .z(),
  }),
  defineShape('pie', 'basic', {
    keywords: ['chart', 'slice', 'pac'],
    params: [{ key: 'angle', min: 10, max: 350, default: 270, unit: '°' }],
    build: (b, w, h, p) => {
      const a0 = -Math.PI / 2;
      b.m(w / 2, h / 2)
        .arc(w / 2, h / 2, w / 2, h / 2, a0, a0 + (p.angle * Math.PI) / 180, true)
        .z();
    },
  }),
  defineShape('chord', 'basic', {
    keywords: ['segment'],
    params: [{ key: 'angle', min: 10, max: 350, default: 240, unit: '°' }],
    build: (b, w, h, p) => {
      const a0 = -Math.PI / 2 - (p.angle * Math.PI) / 360;
      b.arc(w / 2, h / 2, w / 2, h / 2, a0, a0 + (p.angle * Math.PI) / 180).z();
    },
  }),
  defineShape('block-arc', 'basic', {
    keywords: ['arch', 'rainbow', 'band'],
    params: [
      { key: 'angle', min: 10, max: 350, default: 180, unit: '°' },
      { ...thickness, default: 25 },
    ],
    build: (b, w, h, p) => {
      const t = pct(p.thickness);
      const a0 = -Math.PI / 2 - (p.angle * Math.PI) / 360;
      const a1 = a0 + (p.angle * Math.PI) / 180;
      b.arc(w / 2, h / 2, w / 2, h / 2, a0, a1)
        .arc(w / 2, h / 2, (w / 2) * (1 - t), (h / 2) * (1 - t), a1, a0, true)
        .z();
    },
  }),
  defineShape('ring', 'basic', {
    keywords: ['donut', 'circle', 'washer'],
    params: [{ ...thickness, default: 25 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness);
      b.ellipse(w / 2, h / 2, w / 2, h / 2).ellipse(
        w / 2,
        h / 2,
        (w / 2) * (1 - t),
        (h / 2) * (1 - t),
      );
    },
  }),
  defineShape('frame', 'basic', {
    keywords: ['border', 'picture'],
    params: [{ ...thickness, default: 15 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * Math.min(w, h);
      b.rect(0, 0, w, h).rect(t, t, Math.max(0.1, w - 2 * t), Math.max(0.1, h - 2 * t));
    },
  }),
  defineShape('half-frame', 'basic', {
    keywords: ['corner', 'angle'],
    params: [{ ...thickness, default: 20 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * Math.min(w, h);
      b.poly([
        [0, 0],
        [w, 0],
        [w - t, t],
        [t, t],
        [t, h - t],
        [0, h],
      ]);
    },
  }),
  defineShape('l-shape', 'basic', {
    keywords: ['corner', 'letter l'],
    params: [{ ...thickness, default: 35 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness);
      b.poly([
        [0, 0],
        [t * w, 0],
        [t * w, (1 - t) * h],
        [w, (1 - t) * h],
        [w, h],
        [0, h],
      ]);
    },
  }),
  defineShape('cylinder', 'basic', {
    keywords: ['can', 'tube', 'database'],
    fillRule: 'nonzero',
    params: [{ key: 'top', min: 5, max: 50, default: 20 }],
    build: (b, w, h, p) => {
      const ry = (pct(p.top) * h) / 2;
      b.m(0, ry)
        .l(0, h - ry)
        .arc(w / 2, h - ry, w / 2, ry, Math.PI, 0, true)
        .l(w, ry)
        .arc(w / 2, ry, w / 2, ry, 0, -Math.PI, true)
        .z()
        .ellipse(w / 2, ry, w / 2, ry);
    },
  }),
  defineShape('cube', 'basic', {
    keywords: ['box', '3d'],
    fillRule: 'nonzero',
    params: [{ key: 'depth', min: 5, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const d = pct(p.depth) * Math.min(w, h);
      b.rect(0, d, w - d, h - d)
        .poly([
          [0, d],
          [d, 0],
          [w, 0],
          [w - d, d],
        ])
        .poly([
          [w - d, d],
          [w, 0],
          [w, h - d],
          [w - d, h],
        ]);
    },
  }),
  defineShape('plaque', 'basic', {
    keywords: ['sign', 'concave', 'label'],
    params: [{ ...corner, default: 20 }],
    build: (b, w, h, p) => {
      const r = pct(p.corner) * Math.min(w, h);
      b.m(r, 0)
        .l(w - r, 0)
        .q(w - r, r, w, r)
        .l(w, h - r)
        .q(w - r, h - r, w - r, h)
        .l(r, h)
        .q(r, h - r, 0, h - r)
        .l(0, r)
        .q(r, r, r, 0)
        .z();
    },
  }),
  defineShape('teardrop', 'basic', {
    keywords: ['drop', 'point'],
    build: (b, w, h) => {
      b.arc(w / 2, h / 2, w / 2, h / 2, -Math.PI / 2, -Math.PI * 2)
        .l(w, 0)
        .z();
    },
  }),
  defineShape('lens', 'basic', {
    keywords: ['eye', 'almond', 'vesica'],
    build: (b, w, h) =>
      void b
        .m(0, h / 2)
        .q(w / 2, -h / 2, w, h / 2)
        .q(w / 2, h * 1.5, 0, h / 2)
        .z(),
  }),

  // ---- polygons ----------------------------------------------------------------------------
  defineShape('triangle', 'polygons', {
    keywords: ['isosceles'],
    params: [{ key: 'apex', min: 0, max: 100, default: 50 }],
    build: (b, w, h, p) =>
      void b.poly([
        [pct(p.apex) * w, 0],
        [w, h],
        [0, h],
      ]),
  }),
  defineShape('right-triangle', 'polygons', {
    keywords: ['triangle', '90'],
    build: (b, w, h) =>
      void b.poly([
        [0, 0],
        [w, h],
        [0, h],
      ]),
  }),
  defineShape('diamond', 'polygons', {
    keywords: ['rhombus', 'lozenge'],
    build: (b, w, h) =>
      void b.poly([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]),
  }),
  defineShape('parallelogram', 'polygons', {
    keywords: ['slanted', 'skew'],
    params: [{ key: 'slant', min: 0, max: 80, default: 25 }],
    build: (b, w, h, p) => {
      const s = pct(p.slant) * w;
      b.poly([
        [s, 0],
        [w, 0],
        [w - s, h],
        [0, h],
      ]);
    },
  }),
  defineShape('trapezoid', 'polygons', {
    keywords: ['trapezium'],
    params: [{ key: 'inset', min: 0, max: 50, default: 22 }],
    build: (b, w, h, p) => {
      const s = pct(p.inset) * w;
      b.poly([
        [s, 0],
        [w - s, 0],
        [w, h],
        [0, h],
      ]);
    },
  }),
  ...(
    [
      ['pentagon', 5, -Math.PI / 2],
      ['hexagon', 6, 0],
      ['heptagon', 7, -Math.PI / 2],
      ['octagon', 8, Math.PI / 8],
      ['nonagon', 9, -Math.PI / 2],
      ['decagon', 10, 0],
      ['dodecagon', 12, Math.PI / 12],
    ] as const
  ).map(([id, n, start]) =>
    defineShape(id, 'polygons', {
      keywords: ['polygon', `${n} sides`],
      build: (b, w, h) => void b.poly(fit(PathBuilder.ngon(0, 0, 1, 1, n, start), w, h)),
    }),
  ),
  defineShape('polygon', 'polygons', {
    keywords: ['regular', 'sides'],
    params: [
      { key: 'sides', min: 3, max: 32, default: 7, unit: '' },
      { ...corner, default: 0 },
    ],
    build: (b, w, h, p) =>
      void b.roundPoly(
        fit(PathBuilder.ngon(0, 0, 1, 1, Math.round(p.sides)), w, h),
        pct(p.corner) * Math.min(w, h) * 0.5,
      ),
  }),
  defineShape('kite', 'polygons', {
    keywords: ['deltoid'],
    params: [{ key: 'apex', min: 10, max: 90, default: 35 }],
    build: (b, w, h, p) =>
      void b.poly(
        unit(
          w,
          h,
        )([
          [0.5, 0],
          [1, pct(p.apex)],
          [0.5, 1],
          [0, pct(p.apex)],
        ]),
      ),
  }),
];
