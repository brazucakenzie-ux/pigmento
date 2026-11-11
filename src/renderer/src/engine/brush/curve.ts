import type { I18nKey } from '../../i18n';
import type { Dynamic } from './types';

/** Editing a dynamic's response curve: points from x = 0 to x = 1, kept in order. */
export type Curve = Dynamic['curve'];

export const MAX_CURVE_POINTS = 16;

export const CURVE_PRESETS: readonly { id: string; labelKey: I18nKey; curve: Curve }[] = [
  {
    id: 'linear',
    labelKey: 'curve.linear',
    curve: [
      [0, 0],
      [1, 1],
    ],
  },
  {
    id: 'soft',
    labelKey: 'curve.soft',
    curve: [
      [0, 0],
      [0.5, 0.2],
      [1, 1],
    ],
  },
  {
    id: 'firm',
    labelKey: 'curve.firm',
    curve: [
      [0, 0],
      [0.5, 0.8],
      [1, 1],
    ],
  },
  {
    id: 's',
    labelKey: 'curve.s',
    curve: [
      [0, 0],
      [0.3, 0.1],
      [0.7, 0.9],
      [1, 1],
    ],
  },
  {
    id: 'reverse',
    labelKey: 'curve.reverse',
    curve: [
      [0, 1],
      [1, 0],
    ],
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Move point `i`. The end points stay at x = 0 and x = 1 (only their height changes); the
 * others stay between their neighbours.
 */
export function moveCurvePoint(c: Curve, i: number, x: number, y: number): Curve {
  if (i < 0 || i >= c.length) return c;
  const last = c.length - 1;
  const nx = i === 0 ? 0 : i === last ? 1 : Math.min(c[i + 1][0], Math.max(c[i - 1][0], clamp01(x)));
  return c.map((p, k) => (k === i ? ([nx, clamp01(y)] as const) : p));
}

/** Add a point in order (no more than `MAX_CURVE_POINTS`); returns the curve and its index. */
export function addCurvePoint(c: Curve, x: number, y: number): { curve: Curve; index: number } {
  if (c.length >= MAX_CURVE_POINTS) return { curve: c, index: -1 };
  const nx = Math.min(0.999, Math.max(0.001, x));
  let index = c.findIndex((p) => p[0] > nx);
  if (index <= 0) index = c.length - 1;
  const curve = [...c.slice(0, index), [nx, clamp01(y)] as const, ...c.slice(index)];
  return { curve, index };
}

/** Remove an inner point (the end points always stay). */
export function removeCurvePoint(c: Curve, i: number): Curve {
  if (i <= 0 || i >= c.length - 1) return c;
  return c.filter((_, k) => k !== i);
}
