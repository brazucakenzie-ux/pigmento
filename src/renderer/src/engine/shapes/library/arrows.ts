import { PathBuilder } from '../path';
import { defineShape, type ShapeDef } from '../ShapeRegistry';
import { fit, mirrorX, mirrorY, pct, rotate, transpose, unit, type Pt } from './util';

const inner = { key: 'inner', min: 5, max: 95, default: 40 };
const head = { key: 'head', min: 10, max: 90, default: 35 };
const shaft = { key: 'shaft', min: 10, max: 90, default: 45 };

/** A right-pointing block arrow in an l×t box: head length hl, shaft thickness st. */
function arrowRight(l: number, t: number, hl: number, st: number): Pt[] {
  const y0 = (t - st) / 2;
  const y1 = (t + st) / 2;
  return [
    [0, y0],
    [l - hl, y0],
    [l - hl, 0],
    [l, t / 2],
    [l - hl, t],
    [l - hl, y1],
    [0, y1],
  ];
}

function arrowBoth(l: number, t: number, hl: number, st: number): Pt[] {
  const y0 = (t - st) / 2;
  const y1 = (t + st) / 2;
  return [
    [0, t / 2],
    [hl, 0],
    [hl, y0],
    [l - hl, y0],
    [l - hl, 0],
    [l, t / 2],
    [l - hl, t],
    [l - hl, y1],
    [hl, y1],
    [hl, t],
  ];
}

const headLen = (p: Record<string, number>, l: number) => Math.min(l * 0.9, pct(p.head) * l);

/** Stars, bursts and arrows. */
export const STARS_ARROWS: ShapeDef[] = [
  ...(
    [
      [4, 38],
      [5, 38],
      [6, 50],
      [7, 45],
      [8, 42],
      [10, 45],
      [12, 50],
      [16, 55],
      [24, 70],
      [32, 75],
    ] as const
  ).map(([n, def]) =>
    defineShape(`star-${n}`, 'stars', {
      keywords: ['star', `${n} points`],
      params: [{ ...inner, default: def }],
      build: (b, w, h, p) => void b.poly(fit(PathBuilder.star(0, 0, 1, 1, n, pct(p.inner)), w, h)),
    }),
  ),
  defineShape('burst', 'stars', {
    keywords: ['explosion', 'boom', 'jagged'],
    params: [
      { key: 'points', min: 6, max: 40, default: 14, unit: '' },
      { ...inner, default: 60 },
    ],
    build: (b, w, h, p) => {
      const n = Math.round(p.points);
      const pts: Pt[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
        // Uneven tips make it look like a burst rather than a star.
        const r =
          i % 2 === 0
            ? 0.82 + 0.18 * Math.abs(Math.sin(i * 1.7))
            : pct(p.inner) * (0.85 + 0.15 * Math.abs(Math.cos(i * 2.3)));
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      b.poly(fit(pts, w, h));
    },
  }),
  defineShape('seal', 'stars', {
    keywords: ['badge', 'scallop', 'stamp', 'certificate'],
    params: [{ key: 'points', min: 6, max: 40, default: 20, unit: '' }],
    build: (b, w, h, p) => {
      const n = Math.round(p.points);
      const cx = w / 2;
      const cy = h / 2;
      const r0 = 0.88;
      const at = (a: number, r: number): Pt => [
        cx + (w / 2) * r * Math.cos(a),
        cy + (h / 2) * r * Math.sin(a),
      ];
      const first = at(-Math.PI / 2, r0);
      b.m(first[0], first[1]);
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const a1 = -Math.PI / 2 + ((i + 1) / n) * Math.PI * 2;
        const c = at((a0 + a1) / 2, 1 / 0.9);
        const e = at(a1, r0);
        b.q(c[0], c[1], e[0], e[1]);
      }
      b.z();
    },
  }),
  defineShape('sparkle', 'stars', {
    keywords: ['twinkle', 'shine', 'glint'],
    params: [{ ...inner, default: 20 }],
    build: (b, w, h, p) => {
      const k = pct(p.inner);
      const cx = w / 2;
      const cy = h / 2;
      b.m(cx, 0)
        .q(cx + (w / 2) * k, cy - (h / 2) * k, w, cy)
        .q(cx + (w / 2) * k, cy + (h / 2) * k, cx, h)
        .q(cx - (w / 2) * k, cy + (h / 2) * k, 0, cy)
        .q(cx - (w / 2) * k, cy - (h / 2) * k, cx, 0)
        .z();
    },
  }),
  defineShape('asterisk', 'stars', {
    keywords: ['star', 'footnote'],
    fillRule: 'nonzero',
    params: [
      { key: 'points', min: 3, max: 12, default: 6, unit: '' },
      { key: 'thickness', min: 4, max: 40, default: 16 },
    ],
    build: (b, w, h, p) => {
      const n = Math.round(p.points);
      const t = pct(p.thickness) / 2;
      const arms: Pt[][] = [];
      for (let i = 0; i < n; i++) {
        arms.push(
          rotate(
            [
              [-t, -1],
              [t, -1],
              [t, 0],
              [-t, 0],
            ],
            (i / n) * Math.PI * 2,
            0,
            0,
          ),
        );
      }
      // Fit all arms together (with a centre square) to the box.
      const all = fit([...arms.flat(), [-1, -1], [1, 1]], w, h);
      const per = 4;
      for (let i = 0; i < n; i++) b.poly(all.slice(i * per, i * per + per));
      b.ellipse(w / 2, h / 2, (w / 2) * t * 1.6, (h / 2) * t * 1.6);
    },
  }),
  defineShape('star-rounded', 'stars', {
    keywords: ['soft', 'star', 'cute'],
    params: [
      { ...inner, default: 50 },
      { key: 'corner', min: 0, max: 50, default: 20 },
    ],
    build: (b, w, h, p) =>
      void b.roundPoly(
        fit(PathBuilder.star(0, 0, 1, 1, 5, pct(p.inner)), w, h),
        pct(p.corner) * Math.min(w, h) * 0.3,
      ),
  }),

  // ---- arrows ------------------------------------------------------------------------------
  defineShape('arrow-right', 'arrows', {
    keywords: ['next', 'forward'],
    params: [head, shaft],
    build: (b, w, h, p) => void b.poly(arrowRight(w, h, headLen(p, w), pct(p.shaft) * h)),
  }),
  defineShape('arrow-left', 'arrows', {
    keywords: ['back', 'previous'],
    params: [head, shaft],
    build: (b, w, h, p) =>
      void b.poly(mirrorX(arrowRight(w, h, headLen(p, w), pct(p.shaft) * h), w)),
  }),
  defineShape('arrow-down', 'arrows', {
    keywords: ['south'],
    params: [head, shaft],
    build: (b, w, h, p) =>
      void b.poly(transpose(arrowRight(h, w, headLen(p, h), pct(p.shaft) * w))),
  }),
  defineShape('arrow-up', 'arrows', {
    keywords: ['north'],
    params: [head, shaft],
    build: (b, w, h, p) =>
      void b.poly(mirrorY(transpose(arrowRight(h, w, headLen(p, h), pct(p.shaft) * w)), h)),
  }),
  defineShape('arrow-left-right', 'arrows', {
    keywords: ['double', 'both ways', 'horizontal'],
    params: [{ ...head, default: 25 }, shaft],
    build: (b, w, h, p) =>
      void b.poly(arrowBoth(w, h, Math.min(w * 0.45, pct(p.head) * w), pct(p.shaft) * h)),
  }),
  defineShape('arrow-up-down', 'arrows', {
    keywords: ['double', 'vertical'],
    params: [{ ...head, default: 25 }, shaft],
    build: (b, w, h, p) =>
      void b.poly(
        transpose(arrowBoth(h, w, Math.min(h * 0.45, pct(p.head) * h), pct(p.shaft) * w)),
      ),
  }),
  defineShape('arrow-quad', 'arrows', {
    keywords: ['four way', 'move', 'cross'],
    params: [
      { key: 'head', min: 5, max: 40, default: 22 },
      { key: 'shaft', min: 5, max: 40, default: 14 },
    ],
    build: (b, w, h, p) => {
      const hl = pct(p.head);
      const s = pct(p.shaft) / 2;
      const hw = Math.min(0.5, s + 0.12);
      const pts: Pt[] = [];
      // One arm (pointing up), repeated four times around the centre (unit box −1…1).
      const arm: Pt[] = [
        [-s, -s],
        [-s, -1 + hl],
        [-hw, -1 + hl],
        [0, -1],
        [hw, -1 + hl],
        [s, -1 + hl],
        [s, -s],
      ];
      for (let i = 0; i < 4; i++) pts.push(...rotate(arm, (i * Math.PI) / 2, 0, 0).slice(0, 6));
      b.poly(fit(pts, w, h));
    },
  }),
  defineShape('arrow-notched', 'arrows', {
    keywords: ['right', 'tail', 'notch'],
    params: [head, shaft, { key: 'notch', min: 0, max: 50, default: 20 }],
    build: (b, w, h, p) => {
      const pts = arrowRight(w, h, headLen(p, w), pct(p.shaft) * h);
      b.poly([...pts, [pct(p.notch) * w * 0.5, h / 2]]);
    },
  }),
  defineShape('arrow-striped', 'arrows', {
    keywords: ['right', 'speed', 'stripes'],
    fillRule: 'nonzero',
    params: [head, shaft],
    build: (b, w, h, p) => {
      const st = pct(p.shaft) * h;
      const y0 = (h - st) / 2;
      b.rect(0, y0, w * 0.04, st).rect(w * 0.08, y0, w * 0.05, st);
      b.poly(
        arrowRight(w * 0.82, h, headLen(p, w * 0.82), st).map(([x, y]) => [x + w * 0.18, y] as Pt),
      );
    },
  }),
  defineShape('chevron', 'arrows', {
    keywords: ['next', 'arrow', 'breadcrumb'],
    params: [{ key: 'thickness', min: 10, max: 90, default: 45 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * w * 0.5;
      b.poly([
        [0, 0],
        [w - t, 0],
        [w, h / 2],
        [w - t, h],
        [0, h],
        [t, h / 2],
      ]);
    },
  }),
  defineShape('double-chevron', 'arrows', {
    keywords: ['fast forward', 'next'],
    fillRule: 'nonzero',
    params: [{ key: 'thickness', min: 10, max: 90, default: 40 }],
    build: (b, w, h, p) => {
      const cw = w * 0.6;
      const t = pct(p.thickness) * cw * 0.5;
      for (const x0 of [0, w - cw]) {
        b.poly([
          [x0, 0],
          [x0 + cw - t, 0],
          [x0 + cw, h / 2],
          [x0 + cw - t, h],
          [x0, h],
          [x0 + t, h / 2],
        ]);
      }
    },
  }),
  defineShape('home-plate', 'arrows', {
    keywords: ['pentagon', 'tag', 'step'],
    params: [{ key: 'head', min: 5, max: 90, default: 25 }],
    build: (b, w, h, p) => {
      const t = pct(p.head) * w;
      b.poly([
        [0, 0],
        [w - t, 0],
        [w, h / 2],
        [w - t, h],
        [0, h],
      ]);
    },
  }),
  defineShape('arrow-u-turn', 'arrows', {
    keywords: ['return', 'back', 'curved'],
    params: [{ key: 'thickness', min: 5, max: 30, default: 18 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * w;
      const hw = t * 1.1;
      const hl = Math.min(h * 0.35, hw * 1.4);
      const xl = t / 2;
      const xr = w - hw;
      const cx = (xl + xr) / 2;
      const ro = (xr - xl) / 2 + t / 2;
      const ri = Math.max(0.5, (xr - xl) / 2 - t / 2);
      const ryo = Math.min(ro, (h - hl) * 0.6);
      const ryi = Math.max(0.5, ryo - t);
      const cy = ryo;
      b.m(xl - t / 2, h)
        .l(xl - t / 2, cy)
        .arc(cx, cy, ro, ryo, Math.PI, Math.PI * 2, true)
        .l(xr + t / 2, h - hl)
        .l(xr + hw, h - hl)
        .l(xr, h)
        .l(xr - hw, h - hl)
        .l(xr - t / 2, h - hl)
        .l(xr - t / 2, cy)
        .arc(cx, cy, ri, ryi, Math.PI * 2, Math.PI, true)
        .l(xl + t / 2, h)
        .z();
    },
  }),
  defineShape('arrow-bent-up', 'arrows', {
    keywords: ['turn', 'corner', 'up'],
    params: [{ key: 'thickness', min: 5, max: 40, default: 22 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * Math.min(w, h);
      const hw = Math.min(w / 2, t * 1.1);
      const hl = Math.min(h * 0.5, hw * 1.3);
      const xc = w - hw;
      b.poly([
        [0, h - t],
        [xc - t / 2, h - t],
        [xc - t / 2, hl],
        [xc - hw, hl],
        [xc, 0],
        [xc + hw, hl],
        [xc + t / 2, hl],
        [xc + t / 2, h],
        [0, h],
      ]);
    },
  }),
  defineShape('arrow-bent-right', 'arrows', {
    keywords: ['turn', 'corner', 'right'],
    params: [{ key: 'thickness', min: 5, max: 40, default: 22 }],
    build: (b, w, h, p) => {
      const t = pct(p.thickness) * Math.min(w, h);
      const hw = Math.min(h / 2, t * 1.1);
      const hl = Math.min(w * 0.5, hw * 1.3);
      const yc = hw;
      b.poly([
        [0, h],
        [0, yc - t / 2],
        [w - hl, yc - t / 2],
        [w - hl, yc - hw],
        [w, yc],
        [w - hl, yc + hw],
        [w - hl, yc + t / 2],
        [t, yc + t / 2],
        [t, h],
      ]);
    },
  }),
  defineShape('arrow-circular', 'arrows', {
    keywords: ['refresh', 'repeat', 'cycle', 'redo'],
    params: [
      { key: 'angle', min: 60, max: 330, default: 270, unit: '°' },
      { key: 'thickness', min: 5, max: 40, default: 18 },
    ],
    build: (b, w, h, p) => {
      const t = pct(p.thickness);
      const a0 = -Math.PI / 2;
      const sweep = (p.angle * Math.PI) / 180;
      const a1 = a0 + sweep - 0.35;
      const cx = w / 2;
      const cy = h / 2;
      // Outer radius leaves room for the head so it stays inside the box.
      const ext = 0.325 * t;
      const ro = 0.5 - ext;
      const ri = Math.max(0.02, ro - t * 0.5);
      const mid = (ro + ri) / 2;
      const at = (a: number, r: number): Pt => [cx + w * r * Math.cos(a), cy + h * r * Math.sin(a)];
      const tip = at(a1 + 0.35, mid);
      const o = at(a1, ro + ext);
      const i = at(a1, ri - ext);
      b.arc(cx, cy, w * ro, h * ro, a0, a1)
        .l(o[0], o[1])
        .l(tip[0], tip[1])
        .l(i[0], i[1])
        .arc(cx, cy, w * ri, h * ri, a1, a0, true)
        .z();
    },
  }),
  defineShape('arrow-callout', 'arrows', {
    keywords: ['box', 'right', 'label'],
    params: [
      { key: 'box', min: 20, max: 85, default: 60 },
      { key: 'shaft', min: 10, max: 60, default: 30 },
    ],
    build: (b, w, h, p) => {
      const bw = pct(p.box) * w;
      const st = (pct(p.shaft) * h) / 2;
      const hw = Math.min(h / 2, st * 2);
      const hl = Math.min(w - bw, hw * 1.2);
      b.poly([
        [0, 0],
        [bw, 0],
        [bw, h / 2 - st],
        [w - hl, h / 2 - st],
        [w - hl, h / 2 - hw],
        [w, h / 2],
        [w - hl, h / 2 + hw],
        [w - hl, h / 2 + st],
        [bw, h / 2 + st],
        [bw, h],
        [0, h],
      ]);
    },
  }),
  defineShape('arrow-callout-down', 'arrows', {
    keywords: ['box', 'down', 'label'],
    params: [
      { key: 'box', min: 20, max: 85, default: 60 },
      { key: 'shaft', min: 10, max: 60, default: 30 },
    ],
    build: (b, w, h, p) => {
      const bh = pct(p.box) * h;
      const st = (pct(p.shaft) * w) / 2;
      const hw = Math.min(w / 2, st * 2);
      const hl = Math.min(h - bh, hw * 1.2);
      b.poly([
        [0, 0],
        [w, 0],
        [w, bh],
        [w / 2 + st, bh],
        [w / 2 + st, h - hl],
        [w / 2 + hw, h - hl],
        [w / 2, h],
        [w / 2 - hw, h - hl],
        [w / 2 - st, h - hl],
        [w / 2 - st, bh],
        [0, bh],
      ]);
    },
  }),
  defineShape('arrow-diagonal', 'arrows', {
    keywords: ['up right', 'northeast', 'trend'],
    params: [head, shaft],
    build: (b, w, h, p) => {
      const pts = arrowRight(1.4, 0.5, headLen(p, 1.4) * 0.6, pct(p.shaft) * 0.5);
      b.poly(fit(rotate(pts, -Math.PI / 4, 0.7, 0.25), w, h));
    },
  }),
  defineShape('arrow-line', 'arrows', {
    keywords: ['line', 'pointer', 'thin'],
    strokeOnly: true,
    params: [{ key: 'head', min: 5, max: 50, default: 20 }],
    build: (b, w, h, p) => {
      const hl = Math.min(w * 0.5, pct(p.head) * w);
      b.m(0, h / 2)
        .l(w, h / 2)
        .m(w - hl, 0)
        .l(w, h / 2)
        .l(w - hl, h);
    },
  }),
  defineShape('arrow-line-double', 'arrows', {
    keywords: ['line', 'both', 'dimension'],
    strokeOnly: true,
    params: [{ key: 'head', min: 5, max: 50, default: 20 }],
    build: (b, w, h, p) => {
      const hl = Math.min(w * 0.45, pct(p.head) * w);
      b.m(0, h / 2)
        .l(w, h / 2)
        .m(w - hl, 0)
        .l(w, h / 2)
        .l(w - hl, h)
        .m(hl, 0)
        .l(0, h / 2)
        .l(hl, h);
    },
  }),

  // ---- callouts ----------------------------------------------------------------------------
  ...(['speech-rect', 'speech-rounded'] as const).map((id) =>
    defineShape(id, 'callouts', {
      keywords: ['speech', 'bubble', 'talk', 'comment'],
      params: [
        { key: 'tail', min: 0, max: 100, default: 25 },
        { key: 'tailLength', min: 5, max: 50, default: 25 },
      ],
      build: (b, w, h, p) => {
        const bh = h * (1 - pct(p.tailLength));
        const tx = pct(p.tail) * w;
        const base = Math.min(w * 0.12, w / 4);
        const bx = Math.min(w - base * 2 - 0.01, Math.max(0.01, tx - base));
        const r = id === 'speech-rounded' ? Math.min(w, bh) * 0.2 : 0;
        b.m(r, 0)
          .l(w - r, 0)
          .q(w, 0, w, r)
          .l(w, bh - r)
          .q(w, bh, w - r, bh)
          .l(bx + base * 2, bh)
          .l(tx, h)
          .l(bx, bh)
          .l(r, bh)
          .q(0, bh, 0, bh - r)
          .l(0, r)
          .q(0, 0, r, 0)
          .z();
      },
    }),
  ),
  defineShape('speech-oval', 'callouts', {
    keywords: ['speech', 'bubble', 'balloon'],
    params: [
      { key: 'tail', min: 0, max: 100, default: 25 },
      { key: 'tailLength', min: 5, max: 50, default: 25 },
    ],
    build: (b, w, h, p) => {
      const bh = h * (1 - pct(p.tailLength));
      const ry = bh / 2;
      const d = 0.28;
      const a0 = Math.PI / 2 - d;
      b.arc(w / 2, ry, w / 2, ry, a0, Math.PI / 2 + d - Math.PI * 2)
        .l(pct(p.tail) * w, h)
        .z();
    },
  }),
  defineShape('speech-top', 'callouts', {
    keywords: ['speech', 'bubble', 'above'],
    params: [
      { key: 'tail', min: 0, max: 100, default: 70 },
      { key: 'tailLength', min: 5, max: 50, default: 25 },
    ],
    build: (b, w, h, p) => {
      const top = h * pct(p.tailLength);
      const tx = pct(p.tail) * w;
      const base = Math.min(w * 0.12, w / 4);
      const bx = Math.min(w - base * 2 - 0.01, Math.max(0.01, tx - base));
      b.poly([
        [0, top],
        [bx, top],
        [tx, 0],
        [bx + base * 2, top],
        [w, top],
        [w, h],
        [0, h],
      ]);
    },
  }),
  defineShape('speech-left', 'callouts', {
    keywords: ['speech', 'bubble', 'side'],
    params: [
      { key: 'tail', min: 0, max: 100, default: 50 },
      { key: 'tailLength', min: 5, max: 50, default: 20 },
    ],
    build: (b, w, h, p) => {
      const left = w * pct(p.tailLength);
      const ty = pct(p.tail) * h;
      const base = Math.min(h * 0.14, h / 4);
      const by = Math.min(h - base * 2 - 0.01, Math.max(0.01, ty - base));
      b.poly([
        [left, 0],
        [w, 0],
        [w, h],
        [left, h],
        [left, by + base * 2],
        [0, ty],
        [left, by],
      ]);
    },
  }),
  defineShape('callout-corner', 'callouts', {
    keywords: ['note', 'pointer'],
    params: [{ key: 'tailLength', min: 5, max: 50, default: 25 }],
    build: (b, w, h, p) => {
      const t = pct(p.tailLength);
      b.poly([
        [0, 0],
        [w, 0],
        [w, h * (1 - t)],
        [w * 0.45, h * (1 - t)],
        [0, h],
        [w * 0.2, h * (1 - t)],
        [0, h * (1 - t)],
      ]);
    },
  }),
  defineShape('callout-line', 'callouts', {
    keywords: ['label', 'annotation', 'leader'],
    params: [{ key: 'tail', min: 0, max: 100, default: 15 }],
    build: (b, w, h, p) => {
      b.rect(w * 0.3, 0, w * 0.7, h * 0.6);
      b.m(w * 0.3, h * 0.6).l(pct(p.tail) * w * 0.3, h);
    },
  }),
  defineShape('thought-cloud', 'callouts', {
    keywords: ['thinking', 'dream', 'idea'],
    fillRule: 'nonzero',
    params: [{ key: 'tail', min: 0, max: 100, default: 20 }],
    build: (b, w, h, p) => {
      cloud(b, w, h * 0.78);
      const tx = pct(p.tail) * w;
      b.ellipse(w * 0.45 + (tx - w * 0.45) * 0.45, h * 0.84, w * 0.06, h * 0.045);
      b.ellipse(w * 0.45 + (tx - w * 0.45) * 0.85, h * 0.95, w * 0.035, h * 0.03);
    },
  }),
  defineShape('shout', 'callouts', {
    keywords: ['exclaim', 'burst', 'yell', 'comic'],
    params: [{ key: 'tail', min: 0, max: 100, default: 15 }],
    build: (b, w, h, p) => {
      const n = 12;
      const pts: Pt[] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? 1 : 0.7 + 0.08 * Math.sin(i * 2.1);
        pts.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]);
      }
      // One tip stretched out as the pointer.
      const k = Math.round((n - 1) * pct(p.tail)) * 2;
      const tip = pts[(n + k) % (n * 2)];
      pts[(n + k) % (n * 2)] = [tip[0] * 1.6, tip[1] * 1.9];
      b.poly(fit(pts, w, h));
    },
  }),
  defineShape('cloud-callout', 'callouts', {
    keywords: ['cloud', 'speech', 'bubble'],
    params: [{ key: 'tail', min: 0, max: 100, default: 30 }],
    fillRule: 'nonzero',
    build: (b, w, h, p) => {
      cloud(b, w, h * 0.8);
      const tx = pct(p.tail) * w;
      b.poly([
        [w * 0.38, h * 0.7],
        [tx, h],
        [w * 0.55, h * 0.72],
      ]);
    },
  }),
];

/** A cloud outline in a w×h box (shared with the nature shapes). */
export function cloud(b: PathBuilder, w: number, h: number): void {
  const u = unit(w, h);
  const [[x0, y0], ...rest] = u([
    [0.25, 0.95],
    [0.05, 0.95],
    [0, 0.72],
    [0.13, 0.6],
    [0.05, 0.33],
    [0.32, 0.18],
    [0.45, 0.3],
    [0.52, 0.02],
    [0.87, 0.05],
    [0.85, 0.36],
    [1.0, 0.38],
    [1.0, 0.65],
    [0.9, 0.72],
    [1.0, 0.88],
    [0.9, 0.97],
    [0.75, 0.95],
  ]);
  b.m(x0, y0);
  for (let i = 0; i + 2 < rest.length; i += 3)
    b.c(rest[i][0], rest[i][1], rest[i + 1][0], rest[i + 1][1], rest[i + 2][0], rest[i + 2][1]);
  b.z();
}
