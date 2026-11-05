import {
  boundsOfPoints,
  rectCorners,
  rectIntersect,
  rectRoundOut,
  type Point,
  type Rect,
} from '../core/geometry';
import type { MaskView } from '../raster/pixels';

export type SelectionKind = 'rect' | 'polygon' | 'mask';

/** Rasterise a polygon (even-odd) into a mask covering `bounds`, sampling pixel centres. */
export function rasterizePolygon(pts: readonly Point[], bounds: Rect): Uint8Array {
  const mask = new Uint8Array(bounds.w * bounds.h);
  const n = pts.length;
  if (n < 3) return mask;
  const xs: number[] = [];
  for (let row = 0; row < bounds.h; row++) {
    const y = bounds.y + row + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // Pixel x is inside when its centre x+0.5 lies in [xs[k], xs[k+1]).
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5 - bounds.x));
      const x1 = Math.min(bounds.w, Math.ceil(xs[k + 1] - 0.5 - bounds.x));
      if (x1 > x0) mask.fill(255, row * bounds.w + x0, row * bounds.w + x1);
    }
  }
  return mask;
}

/**
 * A pixel selection: a mask over integer `bounds` plus outlines (document coordinates) for
 * drawing marching ants. Immutable; operations return new selections.
 */
export class Selection {
  private constructor(
    readonly bounds: Rect,
    readonly mask: Uint8Array,
    readonly outlines: Point[][],
    readonly kind: SelectionKind,
  ) {}

  static fromRect(r: Rect, docW: number, docH: number): Selection | null {
    const b = rectIntersect(rectRoundOut(r), { x: 0, y: 0, w: docW, h: docH });
    if (!b) return null;
    const mask = new Uint8Array(b.w * b.h).fill(255);
    return new Selection(b, mask, [rectCorners(b)], 'rect');
  }

  static all(docW: number, docH: number): Selection {
    return Selection.fromRect({ x: 0, y: 0, w: docW, h: docH }, docW, docH)!;
  }

  static fromPolygon(pts: readonly Point[], docW: number, docH: number): Selection | null {
    if (pts.length < 3) return null;
    const pb = boundsOfPoints(pts);
    if (!pb) return null;
    const b = rectIntersect(rectRoundOut(pb), { x: 0, y: 0, w: docW, h: docH });
    if (!b) return null;
    const mask = rasterizePolygon(pts, b);
    return Selection.fromMask(b, mask, [pts.map((p) => ({ ...p }))], 'polygon');
  }

  /** Build from a mask, tightening bounds to the non-zero area. Returns null when empty. */
  static fromMask(
    bounds: Rect,
    mask: Uint8Array,
    outlines: Point[][],
    kind: SelectionKind = 'mask',
  ): Selection | null {
    let x0 = bounds.w;
    let y0 = bounds.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < bounds.h; y++) {
      const row = y * bounds.w;
      for (let x = 0; x < bounds.w; x++) {
        if (mask[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    if (x0 === 0 && y0 === 0 && x1 === bounds.w - 1 && y1 === bounds.h - 1) {
      return new Selection({ ...bounds }, mask, outlines, kind);
    }
    const nb = { x: bounds.x + x0, y: bounds.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const nm = new Uint8Array(nb.w * nb.h);
    for (let y = 0; y < nb.h; y++) {
      const si = (y + y0) * bounds.w + x0;
      nm.set(mask.subarray(si, si + nb.w), y * nb.w);
    }
    return new Selection(nb, nm, outlines, kind);
  }

  get isRect(): boolean {
    return this.kind === 'rect';
  }

  maskView(): MaskView {
    const b = this.bounds;
    return { data: this.mask, stride: b.w, ox: b.x, oy: b.y, w: b.w, h: b.h };
  }

  contains(x: number, y: number): boolean {
    const px = Math.floor(x) - this.bounds.x;
    const py = Math.floor(y) - this.bounds.y;
    if (px < 0 || py < 0 || px >= this.bounds.w || py >= this.bounds.h) return false;
    return this.mask[py * this.bounds.w + px] > 127;
  }

  /** Translate by whole pixels (unclipped; the caller clips if needed). */
  translated(dx: number, dy: number): Selection {
    const b = this.bounds;
    return new Selection(
      { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h },
      this.mask,
      this.outlines.map((o) => o.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
      this.kind,
    );
  }

  /** Restrict to the document area. */
  clipped(docW: number, docH: number): Selection | null {
    const c = rectIntersect(this.bounds, { x: 0, y: 0, w: docW, h: docH });
    if (!c) return null;
    if (c.x === this.bounds.x && c.y === this.bounds.y && c.w === this.bounds.w && c.h === this.bounds.h) {
      return this;
    }
    const m = new Uint8Array(c.w * c.h);
    for (let y = 0; y < c.h; y++) {
      const si = (c.y - this.bounds.y + y) * this.bounds.w + (c.x - this.bounds.x);
      m.set(this.mask.subarray(si, si + c.w), y * c.w);
    }
    return Selection.fromMask(c, m, this.outlines, this.kind === 'rect' ? 'rect' : this.kind);
  }

  /** Everything in the document not in this selection. */
  inverted(docW: number, docH: number): Selection | null {
    const doc = { x: 0, y: 0, w: docW, h: docH };
    const m = new Uint8Array(docW * docH).fill(255);
    const b = this.bounds;
    for (let y = 0; y < b.h; y++) {
      const dy = b.y + y;
      if (dy < 0 || dy >= docH) continue;
      for (let x = 0; x < b.w; x++) {
        const dx = b.x + x;
        if (dx < 0 || dx >= docW) continue;
        m[dy * docW + dx] = 255 - this.mask[y * b.w + x];
      }
    }
    return Selection.fromMask(doc, m, [rectCorners(doc), ...this.outlines], 'mask');
  }

  /** Pixel count inside the selection (for status display / tests). */
  area(): number {
    let n = 0;
    for (let i = 0; i < this.mask.length; i++) if (this.mask[i] > 127) n++;
    return n;
  }
}
