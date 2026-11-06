/**
 * Shape outlines as plain commands (testable without a canvas), with a small builder for the
 * shape library and converters to Canvas paths and SVG.
 */
export type PathCmd =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Q'; x1: number; y1: number; x: number; y: number }
  | { op: 'Z' };

type Pt = readonly [number, number];

/** Cubic handle length for a quarter circle. */
const KAPPA = 0.5522847498;

export class PathBuilder {
  readonly cmds: PathCmd[] = [];
  private cx = 0;
  private cy = 0;

  m(x: number, y: number): this {
    this.cmds.push({ op: 'M', x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }

  l(x: number, y: number): this {
    this.cmds.push({ op: 'L', x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }

  c(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.cmds.push({ op: 'C', x1, y1, x2, y2, x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }

  q(x1: number, y1: number, x: number, y: number): this {
    this.cmds.push({ op: 'Q', x1, y1, x, y });
    this.cx = x;
    this.cy = y;
    return this;
  }

  z(): this {
    this.cmds.push({ op: 'Z' });
    return this;
  }

  /** Straight-sided outline through points (closed unless `close` is false). */
  poly(pts: readonly Pt[], close = true): this {
    pts.forEach(([x, y], i) => (i === 0 ? this.m(x, y) : this.l(x, y)));
    if (close) this.z();
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    return this.poly([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]);
  }

  /** Closed polygon with each corner rounded by up to r (never more than half a side). */
  roundPoly(pts: readonly Pt[], r: number): this {
    const n = pts.length;
    if (r <= 0 || n < 3) return this.poly(pts);
    const corner = (i: number) => {
      const [px, py] = pts[(i - 1 + n) % n];
      const [x, y] = pts[i];
      const [nx, ny] = pts[(i + 1) % n];
      const d1 = Math.hypot(px - x, py - y) || 1;
      const d2 = Math.hypot(nx - x, ny - y) || 1;
      const k = Math.min(r, d1 / 2, d2 / 2);
      return {
        a: [x + ((px - x) / d1) * k, y + ((py - y) / d1) * k] as Pt,
        b: [x + ((nx - x) / d2) * k, y + ((ny - y) / d2) * k] as Pt,
        p: [x, y] as Pt,
      };
    };
    const cs = pts.map((_, i) => corner(i));
    this.m(cs[0].b[0], cs[0].b[1]);
    for (let i = 1; i <= n; i++) {
      const k = cs[i % n];
      this.l(k.a[0], k.a[1]).q(k.p[0], k.p[1], k.b[0], k.b[1]);
    }
    return this.z();
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): this {
    return this.roundPoly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      r,
    );
  }

  /** Full ellipse as four cubics (clockwise, or anticlockwise for holes in nonzero shapes). */
  ellipse(cx: number, cy: number, rx: number, ry: number, ccw = false): this {
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    if (!ccw) {
      return this.m(cx + rx, cy)
        .c(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
        .c(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
        .c(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
        .c(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
        .z();
    }
    return this.m(cx + rx, cy)
      .c(cx + rx, cy - ky, cx + kx, cy - ry, cx, cy - ry)
      .c(cx - kx, cy - ry, cx - rx, cy - ky, cx - rx, cy)
      .c(cx - rx, cy + ky, cx - kx, cy + ry, cx, cy + ry)
      .c(cx + kx, cy + ry, cx + rx, cy + ky, cx + rx, cy)
      .z();
  }

  /**
   * Elliptical arc from angle a0 to a1 (radians, y down, so positive is clockwise on screen),
   * as cubics of at most 90°. Starts a new subpath, or joins with a line from the current point.
   */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, join = false): this {
    const x0 = cx + rx * Math.cos(a0);
    const y0 = cy + ry * Math.sin(a0);
    if (join) this.l(x0, y0);
    else this.m(x0, y0);
    const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const step = (a1 - a0) / segs;
    const t = (4 / 3) * Math.tan(step / 4);
    let a = a0;
    for (let i = 0; i < segs; i++) {
      const b = a + step;
      const c0 = Math.cos(a);
      const s0 = Math.sin(a);
      const c1 = Math.cos(b);
      const s1 = Math.sin(b);
      this.c(
        cx + rx * (c0 - t * s0),
        cy + ry * (s0 + t * c0),
        cx + rx * (c1 + t * s1),
        cy + ry * (s1 - t * c1),
        cx + rx * c1,
        cy + ry * s1,
      );
      a = b;
    }
    return this;
  }

  /** Points of a regular polygon (first vertex at `start`, radians). */
  static ngon(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    n: number,
    start = -Math.PI / 2,
  ): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return out;
  }

  /** Points of a star: n tips at the outer radius, valleys at `inner` × that. */
  static star(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    n: number,
    inner: number,
    start = -Math.PI / 2,
  ): Pt[] {
    const out: Pt[] = [];
    for (let i = 0; i < n * 2; i++) {
      const a = start + (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 === 0 ? 1 : inner;
      out.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
    }
    return out;
  }

  /** Horizontal wave from (x0, y) to (x1, y): n humps of height amp (continues the path). */
  wave(x0: number, x1: number, y: number, amp: number, n: number, join = true): this {
    if (join) this.l(x0, y);
    else this.m(x0, y);
    const step = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const xa = x0 + i * step;
      const dir = i % 2 === 0 ? -1 : 1;
      this.c(
        xa + step / 3,
        y + dir * amp * 1.33,
        xa + (2 * step) / 3,
        y + dir * amp * 1.33,
        xa + step,
        y,
      );
    }
    return this;
  }

  /** Current pen position (for shapes that continue from where the last command ended). */
  get pos(): Pt {
    return [this.cx, this.cy];
  }
}

/** Canvas path from commands, shifted by (dx, dy). */
export function toPath2D(cmds: readonly PathCmd[], dx = 0, dy = 0): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c.op === 'M') p.moveTo(c.x + dx, c.y + dy);
    else if (c.op === 'L') p.lineTo(c.x + dx, c.y + dy);
    else if (c.op === 'C')
      p.bezierCurveTo(c.x1 + dx, c.y1 + dy, c.x2 + dx, c.y2 + dy, c.x + dx, c.y + dy);
    else if (c.op === 'Q') p.quadraticCurveTo(c.x1 + dx, c.y1 + dy, c.x + dx, c.y + dy);
    else p.closePath();
  }
  return p;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** SVG path data (gallery thumbnails, SVG export). */
export function toSvgPath(cmds: readonly PathCmd[]): string {
  return cmds
    .map((c) => {
      if (c.op === 'M' || c.op === 'L') return `${c.op}${f(c.x)} ${f(c.y)}`;
      if (c.op === 'C') return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
      if (c.op === 'Q') return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
      return 'Z';
    })
    .join('');
}

/** Bounds of the drawn outline (curves sampled), or null for an empty path. */
export function pathBounds(
  cmds: readonly PathCmd[],
): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  let px = 0;
  let py = 0;
  for (const c of cmds) {
    if (c.op === 'Z') continue;
    if (c.op === 'M' || c.op === 'L') add(c.x, c.y);
    else if (c.op === 'C') {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        add(
          u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
    } else {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const u = 1 - t;
        add(
          u * u * px + 2 * u * t * c.x1 + t * t * c.x,
          u * u * py + 2 * u * t * c.y1 + t * t * c.y,
        );
      }
    }
    px = c.x;
    py = c.y;
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
