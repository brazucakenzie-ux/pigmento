/** Small image helpers for unit tests. */
export function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set(rgba, i);
  return d;
}

export function px(d: Uint8ClampedArray, w: number, x: number, y: number): number[] {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

export function setPx(d: Uint8ClampedArray, w: number, x: number, y: number, rgba: number[]): void {
  d.set(rgba, (y * w + x) * 4);
}

/** Paint a filled rect into an RGBA buffer. */
export function paintRect(
  d: Uint8ClampedArray,
  w: number,
  r: { x: number; y: number; w: number; h: number },
  rgba: number[],
): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) setPx(d, w, x, y, rgba);
}
