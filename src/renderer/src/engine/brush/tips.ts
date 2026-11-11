/**
 * Image tips and grain textures: greyscale masks (0 = nothing, 255 = full) kept by id. Built-in
 * ones are generated procedurally; personal ones come from the Brush Designer and brush packs.
 * Tips keep a chain of halved copies so small dabs of a big tip don't sparkle.
 */
export interface Mask {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
}

export interface TipMask extends Mask {
  /** The same mask at 1/2, 1/4, … size (down to 8 px). */
  readonly mips: readonly Mask[];
}

/** Halve a mask (box filter). */
function halve(m: Mask): Mask {
  const w = Math.max(1, m.w >> 1);
  const h = Math.max(1, m.h >> 1);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(m.w - 1, x * 2);
      const y0 = Math.min(m.h - 1, y * 2);
      const x1 = Math.min(m.w - 1, x0 + 1);
      const y1 = Math.min(m.h - 1, y0 + 1);
      data[y * w + x] = (m.data[y0 * m.w + x0] + m.data[y0 * m.w + x1] + m.data[y1 * m.w + x0] + m.data[y1 * m.w + x1] + 2) >> 2;
    }
  }
  return { w, h, data };
}

export function makeTip(m: Mask): TipMask {
  const mips: Mask[] = [];
  let cur: Mask = m;
  while (cur.w > 8 && cur.h > 8) {
    cur = halve(cur);
    mips.push(cur);
  }
  return { ...m, mips };
}

/** The copy of a tip best suited to a dab `size` px across. */
export function tipLevel(t: TipMask, size: number): Mask {
  let best: Mask = t;
  for (const m of t.mips) {
    if (Math.max(m.w, m.h) < size * 1.5) break;
    best = m;
  }
  return best;
}

/** Bilinear sample at (u, v) in 0–1 (outside reads 0), as 0–1. */
export function sampleMask(m: Mask, u: number, v: number): number {
  const fx = u * m.w - 0.5;
  const fy = v * m.h - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.data[y * m.w + x]);
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return (top * (1 - ty) + bottom * ty) / 255;
}

class MaskStore<T extends Mask> {
  private items = new Map<string, T>();

  set(id: string, m: T): void {
    this.items.set(id, m);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  ids(): string[] {
    return [...this.items.keys()];
  }
}

export const tipStore = new MaskStore<TipMask>();
export const textureStore = new MaskStore<Mask>();
