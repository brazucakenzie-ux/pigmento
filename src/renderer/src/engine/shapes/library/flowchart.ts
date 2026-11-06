import { defineShape, type ShapeDef } from '../ShapeRegistry';
import { unit } from './util';

const fc = (
  id: string,
  keywords: string[],
  build: ShapeDef['build'],
  extra: { fillRule?: 'evenodd' | 'nonzero' } = {},
): ShapeDef =>
  defineShape(`flow-${id}`, 'flowchart', {
    keywords: ['flowchart', 'diagram', ...keywords],
    build,
    ...extra,
  });

/** Flowchart symbols. */
export const FLOWCHART: ShapeDef[] = [
  fc('process', ['step', 'box'], (b, w, h) => void b.rect(0, 0, w, h)),
  fc(
    'alt-process',
    ['rounded', 'step'],
    (b, w, h) => void b.roundRect(0, 0, w, h, Math.min(w, h) * 0.18),
  ),
  fc(
    'decision',
    ['if', 'choice', 'diamond'],
    (b, w, h) =>
      void b.poly([
        [w / 2, 0],
        [w, h / 2],
        [w / 2, h],
        [0, h / 2],
      ]),
  ),
  fc(
    'data',
    ['input', 'output', 'parallelogram'],
    (b, w, h) =>
      void b.poly([
        [w * 0.2, 0],
        [w, 0],
        [w * 0.8, h],
        [0, h],
      ]),
  ),
  fc('predefined', ['subroutine', 'function'], (b, w, h) => {
    b.rect(0, 0, w, h);
    b.m(w * 0.1, 0).l(w * 0.1, h);
    b.m(w * 0.9, 0).l(w * 0.9, h);
  }),
  fc('internal-storage', ['memory'], (b, w, h) => {
    b.rect(0, 0, w, h);
    b.m(w * 0.15, 0).l(w * 0.15, h);
    b.m(0, h * 0.15).l(w, h * 0.15);
  }),
  fc('document', ['page', 'report'], (b, w, h) => {
    b.m(0, 0)
      .l(w, 0)
      .l(w, h * 0.82)
      .c(w * 0.75, h * 0.62, w * 0.5, h * 1.02, w * 0.25, h * 0.9)
      .c(w * 0.12, h * 0.84, w * 0.05, h * 0.84, 0, h * 0.86)
      .z();
  }),
  fc(
    'multi-document',
    ['pages', 'reports'],
    (b, w, h) => {
      const u = unit(w, h);
      // Two pages peeking out behind the front one.
      b.poly(
        u([
          [0.2, 0],
          [1, 0],
          [1, 0.72],
          [0.9, 0.72],
          [0.9, 0.1],
          [0.2, 0.1],
        ]),
      );
      b.poly(
        u([
          [0.1, 0.1],
          [0.9, 0.1],
          [0.9, 0.82],
          [0.8, 0.82],
          [0.8, 0.2],
          [0.1, 0.2],
        ]),
      );
      const [x0, y0] = u([[0, 0.2]])[0];
      b.m(x0, y0)
        .l(w * 0.8, h * 0.2)
        .l(w * 0.8, h * 0.84)
        .c(w * 0.6, h * 0.68, w * 0.4, h * 1.02, w * 0.2, h * 0.92)
        .c(w * 0.1, h * 0.87, w * 0.04, h * 0.87, 0, h * 0.89)
        .z();
    },
    { fillRule: 'nonzero' },
  ),
  fc(
    'terminator',
    ['start', 'end', 'stadium', 'pill'],
    (b, w, h) => void b.roundRect(0, 0, w, h, Math.min(w, h) / 2),
  ),
  fc(
    'preparation',
    ['hexagon', 'setup'],
    (b, w, h) =>
      void b.poly([
        [w * 0.2, 0],
        [w * 0.8, 0],
        [w, h / 2],
        [w * 0.8, h],
        [w * 0.2, h],
        [0, h / 2],
      ]),
  ),
  fc(
    'manual-input',
    ['keyboard', 'entry'],
    (b, w, h) =>
      void b.poly([
        [0, h * 0.25],
        [w, 0],
        [w, h],
        [0, h],
      ]),
  ),
  fc(
    'manual-operation',
    ['manual', 'trapezoid'],
    (b, w, h) =>
      void b.poly([
        [0, 0],
        [w, 0],
        [w * 0.8, h],
        [w * 0.2, h],
      ]),
  ),
  fc('connector', ['circle', 'join'], (b, w, h) => void b.ellipse(w / 2, h / 2, w / 2, h / 2)),
  fc(
    'off-page',
    ['connector', 'continue'],
    (b, w, h) =>
      void b.poly([
        [0, 0],
        [w, 0],
        [w, h * 0.75],
        [w / 2, h],
        [0, h * 0.75],
      ]),
  ),
  fc(
    'card',
    ['punch card'],
    (b, w, h) =>
      void b.poly([
        [w * 0.2, 0],
        [w, 0],
        [w, h],
        [0, h],
        [0, h * 0.2],
      ]),
  ),
  fc('punched-tape', ['tape', 'wave'], (b, w, h) => {
    b.m(0, h * 0.12)
      .wave(0, w, h * 0.12, h * 0.09, 2)
      .l(w, h * 0.88)
      .wave(w, 0, h * 0.88, h * 0.09, 2)
      .z();
  }),
  fc('summing-junction', ['sum', 'cross', 'circle'], (b, w, h) => {
    b.ellipse(w / 2, h / 2, w / 2, h / 2);
    const k = Math.SQRT1_2 / 2;
    b.m(w * (0.5 - k), h * (0.5 - k)).l(w * (0.5 + k), h * (0.5 + k));
    b.m(w * (0.5 + k), h * (0.5 - k)).l(w * (0.5 - k), h * (0.5 + k));
  }),
  fc('or', ['plus', 'circle'], (b, w, h) => {
    b.ellipse(w / 2, h / 2, w / 2, h / 2);
    b.m(w / 2, 0).l(w / 2, h);
    b.m(0, h / 2).l(w, h / 2);
  }),
  fc(
    'collate',
    ['hourglass'],
    (b, w, h) => {
      b.poly([
        [0, 0],
        [w, 0],
        [w / 2, h / 2],
      ]);
      b.poly([
        [w / 2, h / 2],
        [w, h],
        [0, h],
      ]);
    },
    { fillRule: 'nonzero' },
  ),
  fc('sort', ['diamond', 'order'], (b, w, h) => {
    b.poly([
      [w / 2, 0],
      [w, h / 2],
      [w / 2, h],
      [0, h / 2],
    ]);
    b.m(0, h / 2).l(w, h / 2);
  }),
  fc(
    'extract',
    ['triangle'],
    (b, w, h) =>
      void b.poly([
        [w / 2, 0],
        [w, h],
        [0, h],
      ]),
  ),
  fc(
    'merge',
    ['triangle', 'combine'],
    (b, w, h) =>
      void b.poly([
        [0, 0],
        [w, 0],
        [w / 2, h],
      ]),
  ),
  fc('stored-data', ['storage'], (b, w, h) => {
    b.m(w * 0.15, 0)
      .l(w, 0)
      .q(w * 0.7, h / 2, w, h)
      .l(w * 0.15, h)
      .q(-w * 0.15, h / 2, w * 0.15, 0)
      .z();
  }),
  fc('delay', ['wait', 'd'], (b, w, h) => {
    b.m(0, 0)
      .l(w / 2, 0)
      .arc(w / 2, h / 2, w / 2, h / 2, -Math.PI / 2, Math.PI / 2, true)
      .l(0, h)
      .z();
  }),
  fc('display', ['screen', 'monitor'], (b, w, h) => {
    b.m(0, h / 2)
      .l(w * 0.18, 0)
      .l(w * 0.8, 0)
      .arc(w * 0.8, h / 2, w * 0.2, h / 2, -Math.PI / 2, Math.PI / 2, true)
      .l(w * 0.18, h)
      .z();
  }),
  fc(
    'disk',
    ['database', 'magnetic disk', 'cylinder'],
    (b, w, h) => {
      const ry = h * 0.12;
      b.m(0, ry)
        .l(0, h - ry)
        .arc(w / 2, h - ry, w / 2, ry, Math.PI, 0, true)
        .l(w, ry)
        .arc(w / 2, ry, w / 2, ry, 0, -Math.PI, true)
        .z();
      b.ellipse(w / 2, ry, w / 2, ry);
    },
    { fillRule: 'nonzero' },
  ),
  fc(
    'direct-access',
    ['drum', 'storage', 'cylinder'],
    (b, w, h) => {
      const rx = w * 0.12;
      b.m(rx, 0)
        .l(w - rx, 0)
        .arc(w - rx, h / 2, rx, h / 2, -Math.PI / 2, Math.PI / 2, true)
        .l(rx, h)
        .arc(rx, h / 2, rx, h / 2, Math.PI / 2, Math.PI * 1.5, true)
        .z();
      b.ellipse(w - rx, h / 2, rx, h / 2);
    },
    { fillRule: 'nonzero' },
  ),
];
