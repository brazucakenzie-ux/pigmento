export type Pt = [number, number];
type PtIn = readonly [number, number];

/** Unit-square points (0…1) scaled into a w×h box. */
export const unit =
  (w: number, h: number) =>
  (pts: readonly PtIn[]): Pt[] =>
    pts.map(([x, y]) => [x * w, y * h]);

/** Scale points so their bounds exactly fill the w×h box. */
export function fit(pts: readonly PtIn[], w: number, h: number): Pt[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const sx = x1 > x0 ? w / (x1 - x0) : 1;
  const sy = y1 > y0 ? h / (y1 - y0) : 1;
  return pts.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);
}

/** Rotate points about (cx, cy). */
export function rotate(pts: readonly PtIn[], angle: number, cx: number, cy: number): Pt[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

/** A percentage parameter as a fraction. */
export const pct = (v: number): number => v / 100;

/** Swap x and y (turns a right-pointing design into a down-pointing one). */
export const transpose = (pts: readonly PtIn[]): Pt[] => pts.map(([x, y]) => [y, x]);

/** Mirror horizontally inside a box of width w. */
export const mirrorX = (pts: readonly PtIn[], w: number): Pt[] => pts.map(([x, y]) => [w - x, y]);

/** Mirror vertically inside a box of height h. */
export const mirrorY = (pts: readonly PtIn[], h: number): Pt[] => pts.map(([x, y]) => [x, h - y]);

/** A plus sign with arms `t` (fraction of the size) wide, centred in a 2×2 box at (0, 0). */
export function plusPts(t: number): Pt[] {
  const a = t;
  return [
    [-a, -1],
    [a, -1],
    [a, -a],
    [1, -a],
    [1, a],
    [a, a],
    [a, 1],
    [-a, 1],
    [-a, a],
    [-1, a],
    [-1, -a],
    [-a, -a],
  ];
}
