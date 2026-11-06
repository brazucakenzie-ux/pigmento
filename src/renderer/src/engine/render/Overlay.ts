import type { Point } from '../core/geometry';
import type { View } from './View';

export interface OverlayTheme {
  accent: string;
  handleFill: string;
  handleStroke: string;
  antsA: string;
  antsB: string;
  grid: string;
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
      c.moveTo(center.x - 7, center.y);
      c.lineTo(center.x - 3, center.y);
      c.moveTo(center.x + 3, center.y);
      c.lineTo(center.x + 7, center.y);
      c.moveTo(center.x, center.y - 7);
      c.lineTo(center.x, center.y - 3);
      c.moveTo(center.x, center.y + 3);
      c.lineTo(center.x, center.y + 7);
      c.stroke();
    }
    c.restore();
  }

  /** Square outline for pixel-exact tools. */
  squareCursor(docX: number, docY: number, size: number): void {
    const s = Math.max(1, Math.round(size));
    const x0 = Math.floor(docX - s / 2 + 0.5);
    const y0 = Math.floor(docY - s / 2 + 0.5);
    const a = this.view.toScreen(x0, y0);
    const b = this.view.toScreen(x0 + s, y0 + s);
    const c = this.ctx;
    c.save();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.max(1, Math.round(b.x - a.x) - 1), Math.max(1, Math.round(b.y - a.y) - 1));
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.strokeRect(Math.round(a.x) - 0.5, Math.round(a.y) - 0.5, Math.round(b.x - a.x) + 1, Math.round(b.y - a.y) + 1);
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
