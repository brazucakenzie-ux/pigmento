import { toCss, type RGBA } from '../core/color';
import { rectIntersect, type Point, type Rect } from '../core/geometry';
import type { Overlay } from '../render/Overlay';
import type { Surface } from '../raster/Surface';
import type { Selection } from '../doc/Selection';
import type { TextEditState } from '../tools/Tool';
import type { LiveObject } from './LiveObject';

export interface TextStyle {
  family: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: 'left' | 'center' | 'right';
  color: RGBA;
  /** Opaque background colour, or null for transparent. */
  background: RGBA | null;
}

export const LINE_HEIGHT = 1.25;

export interface TextLayout {
  lines: string[];
  widths: number[];
  px: number;
  lineHeight: number;
  ascent: number;
  descent: number;
  w: number;
  h: number;
  font: string;
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
function measurer(): OffscreenCanvasRenderingContext2D {
  if (!measureCtx) {
    const c = new OffscreenCanvas(4, 4);
    measureCtx = c.getContext('2d')!;
  }
  return measureCtx;
}

export function cssFont(style: TextStyle, px: number): string {
  const fam = style.family.replace(/["\\]/g, '');
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px}px "${fam}", sans-serif`;
}

/**
 * Point text: lines come only from explicit newlines and the box grows to fit, so the layout
 * here matches the CSS `white-space: pre` editor exactly.
 */
export function layoutText(text: string, style: TextStyle, dpi: number, minW: number, minH: number): TextLayout {
  const px = Math.max(1, Math.round((style.sizePt * dpi) / 72));
  const font = cssFont(style, px);
  const m = measurer();
  m.font = font;
  const lines = text.split('\n');
  const widths = lines.map((l) => m.measureText(l).width);
  const probe = m.measureText('Hg');
  const ascent = probe.fontBoundingBoxAscent || px * 0.8;
  const descent = probe.fontBoundingBoxDescent || px * 0.2;
  const lineHeight = Math.round(px * LINE_HEIGHT);
  const w = Math.max(minW, Math.ceil(Math.max(px * 0.5, ...widths)) + 2);
  const h = Math.max(minH, lines.length * lineHeight);
  return { lines, widths, px, lineHeight, ascent, descent, w, h, font };
}

let sessionCounter = 0;

export class TextObject implements LiveObject {
  readonly kind = 'text' as const;
  readonly historyLabel = 'history.text' as const;
  text = '';
  layout: TextLayout;
  readonly session = ++sessionCounter;
  private canvas: OffscreenCanvas | null = null;
  private area: Rect | null = null;

  constructor(
    public x: number,
    public y: number,
    public minW: number,
    public minH: number,
    public style: TextStyle,
    private readonly dpi: number,
    private readonly docW: number,
    private readonly docH: number,
  ) {
    this.layout = layoutText('', style, dpi, minW, minH);
    this.update();
  }

  get isEmpty(): boolean {
    return this.text.trim().length === 0 && !this.style.background;
  }

  setText(text: string): void {
    this.text = text;
    this.update();
  }

  setStyle(style: TextStyle): void {
    this.style = style;
    this.update();
  }

  moveTo(x: number, y: number): void {
    this.x = Math.round(x);
    this.y = Math.round(y);
    this.update();
  }

  boxRect(): Rect {
    return { x: this.x, y: this.y, w: this.layout.w, h: this.layout.h };
  }

  bounds(): Rect | null {
    return this.area;
  }

  update(): void {
    this.layout = layoutText(this.text, this.style, this.dpi, this.minW, this.minH);
    const L = this.layout;
    const box = this.boxRect();
    // Italic overhang and descenders can spill outside the box.
    const pad = Math.ceil(L.px * 0.3);
    const area = rectIntersect(
      { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 },
      { x: 0, y: 0, w: this.docW, h: this.docH },
    );
    this.area = area;
    if (!area) return;
    if (!this.canvas || this.canvas.width !== area.w || this.canvas.height !== area.h) {
      this.canvas = new OffscreenCanvas(area.w, area.h);
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, area.w, area.h);
    ctx.translate(-area.x, -area.y);
    const { style } = this;
    if (style.background) {
      ctx.fillStyle = toCss(style.background);
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.font = L.font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = toCss(style.color);
    ctx.strokeStyle = toCss(style.color);
    const halfLeading = (L.lineHeight - (L.ascent + L.descent)) / 2;
    const thickness = Math.max(1, Math.round(L.px / 15));
    L.lines.forEach((line, i) => {
      const lw = L.widths[i];
      const lx =
        style.align === 'center' ? box.x + (box.w - lw) / 2 : style.align === 'right' ? box.x + box.w - lw - 1 : box.x + 1;
      const baseline = box.y + i * L.lineHeight + halfLeading + L.ascent;
      ctx.fillText(line, lx, baseline);
      if (lw > 0 && (style.underline || style.strike)) {
        if (style.underline) ctx.fillRect(lx, Math.round(baseline + L.px * 0.1), lw, thickness);
        if (style.strike) ctx.fillRect(lx, Math.round(baseline - L.ascent * 0.32), lw, thickness);
      }
    });
  }

  draw(ctx: OffscreenCanvasRenderingContext2D): void {
    if (this.canvas && this.area) ctx.drawImage(this.canvas, this.area.x, this.area.y);
  }

  rasterize(surface: Surface, clip: Selection | null): void {
    if (!this.canvas || !this.area) return;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = ctx.getImageData(0, 0, this.area.w, this.area.h);
    surface.compositeImage(
      this.area,
      { data: img.data, stride: this.area.w, ox: this.area.x, oy: this.area.y },
      'over',
      1,
      clip?.maskView() ?? null,
    );
  }

  /** True if p is on the box border band (used to drag the box). */
  onBorder(p: Point, zoom: number): boolean {
    const b = this.boxRect();
    const t = 8 / zoom;
    const inOuter = p.x >= b.x - t && p.y >= b.y - t && p.x <= b.x + b.w + t && p.y <= b.y + b.h + t;
    const inInner = p.x > b.x + 1 && p.y > b.y + 1 && p.x < b.x + b.w - 1 && p.y < b.y + b.h - 1;
    return inOuter && !inInner;
  }

  contains(p: Point, zoom: number): boolean {
    const b = this.boxRect();
    const t = 8 / zoom;
    return p.x >= b.x - t && p.y >= b.y - t && p.x <= b.x + b.w + t && p.y <= b.y + b.h + t;
  }

  editState(): TextEditState {
    const L = this.layout;
    return {
      text: this.text,
      x: this.x,
      y: this.y,
      w: L.w,
      h: L.h,
      fontCss: L.font,
      fontPx: L.px,
      lineHeightPx: L.lineHeight,
      align: this.style.align,
      color: toCss(this.style.color),
      underline: this.style.underline,
      strike: this.style.strike,
      session: this.session,
    };
  }

  drawOverlay(ov: Overlay): void {
    const b = this.boxRect();
    const a = ov.toScreen({ x: b.x, y: b.y });
    const c = ov.toScreen({ x: b.x + b.w, y: b.y + b.h });
    ov.outlineScreen(
      [
        { x: a.x - 3, y: a.y - 3 },
        { x: c.x + 3, y: a.y - 3 },
        { x: c.x + 3, y: c.y + 3 },
        { x: a.x - 3, y: c.y + 3 },
      ],
      true,
      true,
    );
  }

  cursorAt(): string | null {
    return null;
  }

  dispose(): void {
    this.canvas = null;
  }
}
