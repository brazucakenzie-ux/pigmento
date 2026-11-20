import type { Point } from '../core/geometry';
import type { View } from './View';

export interface OverlayTheme {
  accent: string;
  handleFill: string;
  handleStroke: string;
  antsA: string;
  antsB: string;
  grid: string;
  guide: string;
  /** Smart alignment guides while dragging. */
  smart: string;
}

export type HandleShape = 'square' | 'circle';

/** Screen-space drawing helpers for tools and live objects (CSS px coordinates). */
export class Overlay {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  antsOffset = 0;
  theme: OverlayTheme = {
    accent: '#4b4be0',
    handleFill: '#ffffff',
    handleStroke: '#4b4be0',
    antsA: '#000000',
    antsB: '#ffffff',
    grid: 'rgba(75, 75, 224, 0.28)',
    guide: '#00a2d6',
    smart: '#e5337f',
  };

  constructor(readonly view: View) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'pg-overlay-canvas';
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  begin(): void {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  toScreen(p: Point): Point {
    return this.view.toScreen(p.x, p.y);
  }

  /** Marching ants along a doc-space polyline. */
  ants(points: readonly Point[], closed = true): void {
    if (points.length < 2) return;
    const c = this.ctx;
    c.save();
    c.beginPath();
    points.forEach((p, i) => {
      const s = this.toScreen(p);
      const x = Math.round(s.x) + 0.5;
      const y = Math.round(s.y) + 0.5;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    if (closed) c.closePath();
    c.lineWidth = 1;
    c.setLineDash([]);
    c.strokeStyle = this.theme.antsB;
    c.stroke();
    c.setLineDash([4, 4]);
    c.lineDashOffset = -this.antsOffset;
    c.strokeStyle = this.theme.antsA;
    c.stroke();
    c.restore();
  }

  /** Marching ants along many closed doc-space outlines (traced masks), stroked as one path. */
  antsMany(outlines: readonly (readonly Point[])[]): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    for (const pts of outlines) {
      if (pts.length < 2) continue;
      for (let i = 0; i < pts.length; i++) {
        const s = this.view.toScreen(pts[i].x, pts[i].y);
        const x = Math.round(s.x) + 0.5;
        const y = Math.round(s.y) + 0.5;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
    }
    c.lineWidth = 1;
    c.setLineDash([]);
    c.strokeStyle = this.theme.antsB;
    c.stroke();
    c.setLineDash([4, 4]);
    c.lineDashOffset = -this.antsOffset;
    c.strokeStyle = this.theme.antsA;
    c.stroke();
    c.restore();
  }

  /** A guide across the whole viewport at document position `pos`. */
  guide(axis: 'x' | 'y', pos: number, active = false): void {
    const c = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const s = this.view.toScreen(pos, pos);
    c.save();
    c.beginPath();
    if (this.view.rotation !== 0) {
      // Turned: a long line through the guide (the viewport clips it).
      const far = (w + h) / this.view.zoom + this.view.docW + this.view.docH;
      const a = axis === 'x' ? this.view.toScreen(pos, -far) : this.view.toScreen(-far, pos);
      const b = axis === 'x' ? this.view.toScreen(pos, far) : this.view.toScreen(far, pos);
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
    } else if (axis === 'x') {
      const x = Math.round(s.x) + 0.5;
      c.moveTo(x, 0);
      c.lineTo(x, h);
    } else {
      const y = Math.round(s.y) + 0.5;
      c.moveTo(0, y);
      c.lineTo(w, y);
    }
    c.lineWidth = active ? 1.5 : 1;
    c.strokeStyle = this.theme.guide;
    c.stroke();
    c.restore();
  }

  /** A smart alignment line from `from` to `to` (document units) at `pos`. */
  smartLine(axis: 'x' | 'y', pos: number, from: number, to: number): void {
    const c = this.ctx;
    const a = axis === 'x' ? this.view.toScreen(pos, from) : this.view.toScreen(from, pos);
    const b = axis === 'x' ? this.view.toScreen(pos, to) : this.view.toScreen(to, pos);
    c.save();
    c.beginPath();
    if (this.view.rotation !== 0) {
      // Turned: along the line itself, 6 px past each end.
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      c.moveTo(a.x - ux * 6, a.y - uy * 6);
      c.lineTo(b.x + ux * 6, b.y + uy * 6);
    } else if (axis === 'x') {
      const x = Math.round(a.x) + 0.5;
      c.moveTo(x, a.y - 6);
      c.lineTo(x, b.y + 6);
    } else {
      const y = Math.round(a.y) + 0.5;
      c.moveTo(a.x - 6, y);
      c.lineTo(b.x + 6, y);
    }
    c.lineWidth = 1;
    c.strokeStyle = this.theme.smart;
    c.stroke();
    c.restore();
  }

  /** Thin accent outline along screen-space points. */
  outlineScreen(points: readonly Point[], closed = true, dashed = false): void {
    if (points.length < 2) return;
    const c = this.ctx;
    c.save();
    c.beginPath();
    points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    if (closed) c.closePath();
    c.lineWidth = 1;
    c.strokeStyle = this.theme.accent;
    if (dashed) c.setLineDash([5, 4]);
    c.stroke();
    c.restore();
  }

  handle(sp: Point, shape: HandleShape = 'square', active = false): void {
    const c = this.ctx;
    const r = active ? 5.5 : 4.5;
    c.save();
    c.beginPath();
    if (shape === 'circle') c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    else c.rect(Math.round(sp.x - r) + 0.5, Math.round(sp.y - r) + 0.5, r * 2, r * 2);
    c.fillStyle = active ? this.theme.accent : this.theme.handleFill;
    c.fill();
    c.lineWidth = 1.25;
    c.strokeStyle = this.theme.handleStroke;
    c.stroke();
    c.restore();
  }

  /** A pivot: a ring with a cross through it. */
  pivot(sp: Point, active = false): void {
    const c = this.ctx;
    const r = active ? 7 : 6;
    c.save();
    c.lineWidth = 3;
    c.strokeStyle = this.theme.handleFill;
    for (const pass of [0, 1]) {
      c.beginPath();
      c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      c.moveTo(sp.x - r - 3, sp.y);
      c.lineTo(sp.x + r + 3, sp.y);
      c.moveTo(sp.x, sp.y - r - 3);
      c.lineTo(sp.x, sp.y + r + 3);
      c.stroke();
      if (pass === 0) {
        c.lineWidth = 1.25;
        c.strokeStyle = this.theme.accent;
      }
    }
    c.restore();
  }

  /** The edge a dragged piece will hinge onto if it's let go now: thick, over a light halo (screen points). */
  hingeEdge(a: Point, b: Point): void {
    const c = this.ctx;
    c.save();
    c.lineCap = 'round';
    for (const [width, style] of [
      [6, this.theme.handleFill],
      [3, this.theme.smart],
    ] as const) {
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.lineWidth = width;
      c.strokeStyle = style;
      c.stroke();
    }
    c.restore();
  }

  line(a: Point, b: Point, dashed = false): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineWidth = 1;
    c.strokeStyle = this.theme.accent;
    if (dashed) c.setLineDash([4, 3]);
    c.stroke();
    c.restore();
  }

  /** Circle outline (brush cursor), drawn twice for visibility on any background. */
  brushCursor(center: Point, radiusPx: number): void {
    const c = this.ctx;
    const r = Math.max(1.5, radiusPx);
    c.save();
    c.beginPath();
    c.arc(center.x, center.y, r, 0, Math.PI * 2);
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.stroke();
    if (r < 4) {
      c.beginPath();
      this.crossPath(center);
      c.stroke();
    }
    c.restore();
  }

  /** A flat nib's cursor: a line across the nib (screen points), with a crosshair while it's tiny. */
  /** A brush outline of any shape (screen points), drawn like `brushCursor` so it shows on any colour. */
  shapeCursor(points: readonly Point[], closed = true): void {
    if (points.length < 2) return;
    const c = this.ctx;
    c.save();
    c.beginPath();
    points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    if (closed) c.closePath();
    c.lineJoin = 'round';
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.stroke();
    c.restore();
  }

  nibCursor(a: Point, b: Point): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8) this.crossPath({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    c.lineCap = 'round';
    c.lineWidth = 2.5;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.stroke();
    c.restore();
  }

  /** Adds a small crosshair with an open centre to the current path. */
  private crossPath(center: Point): void {
    const c = this.ctx;
    c.moveTo(center.x - 7, center.y);
    c.lineTo(center.x - 3, center.y);
    c.moveTo(center.x + 3, center.y);
    c.lineTo(center.x + 7, center.y);
    c.moveTo(center.x, center.y - 7);
    c.lineTo(center.x, center.y - 3);
    c.moveTo(center.x, center.y + 3);
    c.lineTo(center.x, center.y + 7);
  }

  /** Square outline for pixel-exact tools. */
  squareCursor(docX: number, docY: number, size: number): void {
    const s = Math.max(1, Math.round(size));
    const x0 = Math.floor(docX - s / 2 + 0.5);
    const y0 = Math.floor(docY - s / 2 + 0.5);
    const a = this.view.toScreen(x0, y0);
    const b = this.view.toScreen(x0 + s, y0 + s);
    const c = this.ctx;
    if (this.view.rotation !== 0) {
      // Turned: through the square's four corners.
      const pts = [a, this.view.toScreen(x0 + s, y0), b, this.view.toScreen(x0, y0 + s)];
      c.save();
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(0,0,0,0.85)';
      c.stroke();
      c.restore();
      return;
    }
    c.save();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.max(1, Math.round(b.x - a.x) - 1), Math.max(1, Math.round(b.y - a.y) - 1));
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.strokeRect(Math.round(a.x) - 0.5, Math.round(a.y) - 0.5, Math.round(b.x - a.x) + 1, Math.round(b.y - a.y) + 1);
    c.restore();
  }

  /**
   * A perspective guide on the canvas (view only): the horizon through vanishing point vp, and
   * lines running from it out to the canvas's edges, as the edges of a floor, walls and ceiling
   * would. Everything is in document pixels.
   */
  perspectiveGrid(vp: Point, w: number, h: number): void {
    const v = this.view;
    const c = this.ctx;
    const n = 12;
    const ends: Point[] = [];
    for (let i = 0; i <= n; i++) {
      ends.push({ x: (w * i) / n, y: 0 }, { x: (w * i) / n, y: h });
      if (i > 0 && i < n) ends.push({ x: 0, y: (h * i) / n }, { x: w, y: (h * i) / n });
    }
    c.save();
    c.beginPath();
    // Only on the canvas: the guide is about what's in the picture.
    const tl = v.toScreen(0, 0);
    const tr = v.toScreen(w, 0);
    const br = v.toScreen(w, h);
    const bl = v.toScreen(0, h);
    c.moveTo(tl.x, tl.y);
    c.lineTo(tr.x, tr.y);
    c.lineTo(br.x, br.y);
    c.lineTo(bl.x, bl.y);
    c.closePath();
    c.clip();
    c.beginPath();
    const o = v.toScreen(vp.x, vp.y);
    for (const e of ends) {
      const s = v.toScreen(e.x, e.y);
      c.moveTo(o.x, o.y);
      c.lineTo(s.x, s.y);
    }
    const hl = v.toScreen(Math.min(0, vp.x) - w, vp.y);
    const hr = v.toScreen(Math.max(w, vp.x) + w, vp.y);
    c.moveTo(hl.x, hl.y);
    c.lineTo(hr.x, hr.y);
    c.lineWidth = 1;
    c.strokeStyle = this.theme.grid;
    c.setLineDash([4, 4]);
    c.stroke();
    c.restore();
  }

  /** User gridlines every `spacing` document pixels within the visible doc area. */
  gridlines(spacing: number): void {
    const v = this.view;
    if (spacing * v.zoom < 4) return;
    const vis = v.visibleDocRect();
    if (!vis) return;
    const c = this.ctx;
    c.save();
    c.beginPath();
    const x0 = Math.ceil(vis.x / spacing) * spacing;
    const y0 = Math.ceil(vis.y / spacing) * spacing;
    if (v.rotation !== 0) {
      // Turned: each line between its two ends.
      for (let x = x0; x <= vis.x + vis.w; x += spacing) {
        const a = v.toScreen(x, vis.y);
        const b = v.toScreen(x, vis.y + vis.h);
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
      }
      for (let y = y0; y <= vis.y + vis.h; y += spacing) {
        const a = v.toScreen(vis.x, y);
        const b = v.toScreen(vis.x + vis.w, y);
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
      }
      c.lineWidth = 1;
      c.strokeStyle = this.theme.grid;
      c.stroke();
      c.restore();
      return;
    }
    const top = v.toScreen(0, vis.y).y;
    const bottom = v.toScreen(0, vis.y + vis.h).y;
    const left = v.toScreen(vis.x, 0).x;
    const right = v.toScreen(vis.x + vis.w, 0).x;
    for (let x = x0; x <= vis.x + vis.w; x += spacing) {
      const sx = Math.round(v.toScreen(x, 0).x) + 0.5;
      c.moveTo(sx, top);
      c.lineTo(sx, bottom);
    }
    for (let y = y0; y <= vis.y + vis.h; y += spacing) {
      const sy = Math.round(v.toScreen(0, y).y) + 0.5;
      c.moveTo(left, sy);
      c.lineTo(right, sy);
    }
    c.lineWidth = 1;
    c.strokeStyle = this.theme.grid;
    c.stroke();
    c.restore();
  }
}
