import { rectIntersect, rectUnion, type Rect } from '../core/geometry';
import type { MaskView } from './pixels';

/**
 * Document-sized 8-bit coverage buffer for the stroke in progress. Dabs accumulate with
 * `max`, so overlapping dabs never exceed the stroke's opacity (no build-up within a stroke).
 */
export class StrokeBuffer {
  readonly mask: Uint8Array;
  bounds: Rect | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.mask = new Uint8Array(w * h);
  }

  view(): MaskView {
    return { data: this.mask, stride: this.w, ox: 0, oy: 0, w: this.w, h: this.h };
  }

  /** Clear only the touched region (cheap between strokes on big canvases). */
  reset(): void {
    const b = this.bounds;
    if (b) {
      for (let y = b.y; y < b.y + b.h; y++) this.mask.fill(0, y * this.w + b.x, y * this.w + b.x + b.w);
    }
    this.bounds = null;
  }

  private touch(r: Rect): Rect | null {
    const c = rectIntersect(r, { x: 0, y: 0, w: this.w, h: this.h });
    if (c) this.bounds = rectUnion(this.bounds, c);
    return c;
  }

  /** Aliased square of `size` px centred on (x, y): Paint-style pencil/eraser pixels. */
  stampSquare(x: number, y: number, size: number): Rect | null {
    const s = Math.max(1, Math.round(size));
    const x0 = Math.floor(x - s / 2 + 0.5);
    const y0 = Math.floor(y - s / 2 + 0.5);
    const r = this.touch({ x: x0, y: y0, w: s, h: s });
    if (!r) return null;
    for (let yy = r.y; yy < r.y + r.h; yy++) this.mask.fill(255, yy * this.w + r.x, yy * this.w + r.x + r.w);
    return r;
  }

  /** Aliased line of squares between two points (Bresenham). */
  lineSquare(x0: number, y0: number, x1: number, y1: number, size: number): Rect | null {
    let ax = Math.floor(x0);
    let ay = Math.floor(y0);
    const bx = Math.floor(x1);
    const by = Math.floor(y1);
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    let dirty: Rect | null = null;
    for (;;) {
      dirty = rectUnion(dirty, this.stampSquare(ax + 0.5, ay + 0.5, size));
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
    return dirty;
  }

  /**
   * Anti-aliased round dab. `hardness` 1 = crisp edge, 0 = fully soft falloff. `strength`
   * (0–1) scales the dab's coverage.
   */
  stampDab(cx: number, cy: number, radius: number, hardness: number, strength = 1): Rect | null {
    const rad = Math.max(0.5, radius);
    const r = this.touch({
      x: Math.floor(cx - rad - 1),
      y: Math.floor(cy - rad - 1),
      w: Math.ceil(rad * 2 + 3),
      h: Math.ceil(rad * 2 + 3),
    });
    if (!r) return null;
    const hard = Math.min(1, Math.max(0, hardness));
    const inner = rad * hard;
    const soft = rad - inner;
    const m = this.mask;
    for (let y = r.y; y < r.y + r.h; y++) {
      const dy = y + 0.5 - cy;
      let i = y * this.w + r.x;
      for (let x = r.x; x < r.x + r.w; x++, i++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy);
        let cov = rad - d + 0.5; // anti-aliased edge
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        if (d > inner && soft > 0) {
          const t = (d - inner) / soft;
          const fall = t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
          if (fall < cov) cov = fall;
        }
        const v = (cov * strength * 255 + 0.5) | 0;
        if (v > m[i]) m[i] = v;
      }
    }
    return r;
  }
}

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

/**
 * Places dabs evenly along a polyline at a spacing that may depend on pressure, carrying the
 * leftover distance across segments so dab density is independent of input event rate.
 */
export class DabSpacer {
  private last: StrokePoint | null = null;
  /** Distance travelled since the last dab was placed. */
  private sinceDab = 0;

  constructor(
    private readonly spacing: (p: StrokePoint) => number,
    private readonly dab: (p: StrokePoint) => Rect | null,
  ) {}

  begin(p: StrokePoint): Rect | null {
    this.last = p;
    this.sinceDab = 0;
    return this.dab(p);
  }

  to(p: StrokePoint): Rect | null {
    const a = this.last;
    if (!a) return this.begin(p);
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    let dirty: Rect | null = null;
    let pos = 0;
    for (;;) {
      const u0 = pos / len;
      const here: StrokePoint = {
        x: a.x + dx * u0,
        y: a.y + dy * u0,
        pressure: a.pressure + (p.pressure - a.pressure) * u0,
      };
      const need = Math.max(0.25, this.spacing(here)) - this.sinceDab;
      if (pos + need > len) {
        this.sinceDab += len - pos;
        break;
      }
      pos += Math.max(0, need);
      this.sinceDab = 0;
      const u = pos / len;
      dirty = rectUnion(
        dirty,
        this.dab({ x: a.x + dx * u, y: a.y + dy * u, pressure: a.pressure + (p.pressure - a.pressure) * u }),
      );
    }
    this.last = p;
    return dirty;
  }
}
