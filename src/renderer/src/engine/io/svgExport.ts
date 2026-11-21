import type { RGBA } from '../core/color';
import type { Layer, PaintDocument } from '../doc/Document';
import { toSvgPath } from '../shapes/path';
import type { ImageBuf } from '../raster/transform';
import { imageAsset } from '../vector/assets';
import { shapeOutline } from '../vector/convert';
import type { VectorNode, VectorShape } from '../vector/model';
import { toCmds } from '../vector/pathData';
import { arrowParts, isStrokeOnly, lineStyleOf, shapeFillRule, shapeFrame, trimmedLine, trimmedOutline } from '../vector/render';
import { dashArray, gradientStops, linearEnds, MITER_LIMIT, type ShapeGradient } from '../vector/style';

/**
 * SVG export: shape layers become real paths (with their gradients, patterns, pictures, dashes
 * and arrowheads), pixel layers embedded PNGs; layer opacity, blend modes, visibility and
 * groups are kept. Angular gradients have no SVG equivalent and are written as linear ones.
 */
export interface SvgExportDeps {
  encodePng(data: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array>;
  /** A pattern tile in the given colours (built-in patterns) or as saved. */
  patternTile(id: string, fg: RGBA, bg: RGBA, scale: number): ImageBuf | null;
}

const f = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const hex = (c: RGBA) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** fill="…" (or stroke) with its opacity attribute when not fully opaque. */
const paintAttr = (name: 'fill' | 'stroke', c: RGBA) => `${name}="${hex(c)}"${c.a < 255 ? ` ${name}-opacity="${f(c.a / 255)}"` : ''}`;

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const matrixAttr = (m: readonly number[] | null) => (m ? ` gradientTransform="matrix(${m.map(f).join(' ')})"` : '');

class Writer {
  defs: string[] = [];
  private n = 0;

  constructor(private readonly deps: SvgExportDeps) {}

  id(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  async png(data: Uint8ClampedArray, w: number, h: number): Promise<string> {
    return `data:image/png;base64,${base64(await this.deps.encodePng(data, w, h))}`;
  }

  gradient(g: ShapeGradient | undefined, s: VectorShape): string {
    const { matrix, rect: r } = shapeFrame(s);
    const id = this.id('g');
    const stops = gradientStops(g, s.style.outline, s.style.fill)
      .map((st) => `<stop offset="${f(Math.min(1, Math.max(0, st.pos)))}" stop-color="${hex(st.color)}"${st.color.a < 255 ? ` stop-opacity="${f(st.color.a / 255)}"` : ''}/>`)
      .join('');
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (g?.type === 'radial') {
      this.defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.max(0.5, Math.hypot(r.w, r.h) / 2))}"${matrixAttr(matrix)}>${stops}</radialGradient>`);
    } else {
      const [a, b] = linearEnds(cx, cy, r.w, r.h, g?.angle ?? 0);
      this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"${matrixAttr(matrix)}>${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  }

  async pattern(s: VectorShape): Promise<string | null> {
    const p = s.style.fillPattern;
    if (!p) return null;
    const tile = this.deps.patternTile(p.id, s.style.outline, s.style.fill, Math.max(1, Math.min(8, Math.round(p.scale))));
    if (!tile) return null;
    const id = this.id('p');
    const href = await this.png(new Uint8ClampedArray(tile.data), tile.w, tile.h);
    this.defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tile.w}" height="${tile.h}"><image width="${tile.w}" height="${tile.h}" href="${href}"/></pattern>`);
    return `url(#${id})`;
  }

  async shape(s: VectorShape): Promise<string> {
    const st = s.style;
    const line = isStrokeOnly(s);
    const fills = !line && (st.mode === 'fill' || st.mode === 'both');
    const strokes = line || st.mode === 'outline' || st.mode === 'both';
    const arrows = arrowParts(s);
    // Lines with arrowheads end inside the heads, as they are drawn.
    const geom = arrows ? { ...s, points: arrows.points } : s;
    const outline = shapeOutline(geom);
    if (!outline) return '';
    const d = toSvgPath(toCmds(outline.subpaths));
    const rule = shapeFillRule(s);
    const crisp = st.antialias ? '' : ' shape-rendering="crispEdges"';
    const out: string[] = [];
    let fillAttr = 'fill="none"';
    if (fills) {
      const kind = st.fillKind ?? 'solid';
      if (kind === 'gradient') fillAttr = `fill="${this.gradient(st.fillGradient, s)}"`;
      else if (kind === 'pattern') {
        const url = await this.pattern(s);
        fillAttr = url ? `fill="${url}"` : paintAttr('fill', st.fill);
      } else if (kind === 'image' && st.fillImage && imageAsset(st.fillImage)) {
        // The picture covers the box, clipped to the outline (then the outline is drawn over it).
        const a = imageAsset(st.fillImage)!;
        const { matrix, rect: r } = shapeFrame(s);
        const k = Math.max(r.w / a.w, r.h / a.h);
        const clip = this.id('c');
        this.defs.push(`<clipPath id="${clip}"><path d="${d}" clip-rule="${rule}"/></clipPath>`);
        const t = matrix ? ` transform="matrix(${matrix.map(f).join(' ')})"` : '';
        out.push(
          `<g clip-path="url(#${clip})"><image${t} x="${f(r.x + (r.w - a.w * k) / 2)}" y="${f(r.y + (r.h - a.h * k) / 2)}" width="${f(a.w * k)}" height="${f(a.h * k)}" preserveAspectRatio="none" href="${await this.png(a.data, a.w, a.h)}"/></g>`,
        );
        fillAttr = 'fill="none"';
      } else fillAttr = paintAttr('fill', st.fill);
    }
    let strokeAttr = '';
    let strokePaint = '';
    let dashed = false;
    if (strokes && st.width > 0) {
      const { cap, join } = lineStyleOf(s);
      strokePaint = st.outlineKind === 'gradient' ? `"${this.gradient(st.outlineGradient, s)}"` : '';
      const dash = dashArray(st.dash, st.width, cap);
      dashed = dash.length > 0;
      strokeAttr =
        (strokePaint ? `stroke=${strokePaint}` : paintAttr('stroke', st.outline)) +
        ` stroke-width="${f(st.width)}" stroke-linecap="${cap}" stroke-linejoin="${join}"${join === 'miter' ? ` stroke-miterlimit="${MITER_LIMIT}"` : ''}${dash.length ? ` stroke-dasharray="${dash.map(f).join(' ')}"` : ''}`;
    }
    // Trimmed: the fill is the whole shape, and the outline only the part that shows (as on screen).
    const cut = strokeAttr ? trimmedOutline(s, dashed) : null;
    let heads = arrows?.heads ?? [];
    if (cut) {
      if (fillAttr !== 'fill="none"') out.push(`<path d="${toSvgPath(toCmds((shapeOutline(s) ?? outline).subpaths))}" ${fillAttr} fill-rule="${rule}"${crisp}/>`);
      const dashAt = (from: number) => (dashed && from ? ` stroke-dashoffset="${f(from)}"` : '');
      heads = [];
      if (arrows) {
        const line = trimmedLine(cut);
        const parts = line && arrowParts({ ...s, points: line.points });
        const shown = parts && shapeOutline({ ...s, points: parts.points });
        if (line && parts && shown) {
          out.push(`<path d="${toSvgPath(toCmds(shown.subpaths))}" fill="none" ${strokeAttr}${dashAt(line.from)}${crisp}/>`);
          heads = parts.heads;
        }
      } else for (const p of cut) out.push(`<path d="${toSvgPath(p.cmds)}" fill="none" ${strokeAttr}${dashAt(p.from)}${crisp}/>`);
    } else if (fillAttr !== 'fill="none"' || strokeAttr) out.push(`<path d="${d}" ${fillAttr}${strokeAttr ? ` ${strokeAttr}` : ''} fill-rule="${rule}"${crisp}/>`);
    for (const h of heads) {
      const hd = h.points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('') + (h.closed ? 'Z' : '');
      const paint = strokePaint ? strokePaint.slice(1, -1) : null;
      if (h.closed) out.push(`<path d="${hd}" ${paint ? `fill="${paint}"` : paintAttr('fill', st.outline)}${crisp}/>`);
      else out.push(`<path d="${hd}" fill="none" ${paint ? `stroke="${paint}"` : paintAttr('stroke', st.outline)} stroke-width="${f(st.width)}" stroke-linecap="round" stroke-linejoin="round"${crisp}/>`);
    }
    return out.join('');
  }

  async nodes(list: readonly VectorNode[]): Promise<string> {
    const parts: string[] = [];
    for (const n of list) parts.push(n.type === 'group' ? `<g>${await this.nodes(n.children)}</g>` : await this.shape(n));
    return parts.join('');
  }

  async layer(l: Layer): Promise<string> {
    if (!l.visible) return '';
    const opacity = l.opacity < 1 ? ` opacity="${f(l.opacity)}"` : '';
    const blend = l.blend !== 'normal' ? `mix-blend-mode:${l.blend}` : '';
    const name = ` data-name="${esc(l.name)}"`;
    if (l.kind === 'group') {
      const inner: string[] = [];
      for (const c of l.children) inner.push(await this.layer(c));
      // Groups blend their children on their own first, as in the editor.
      return `<g style="isolation:isolate${blend ? `;${blend}` : ''}"${opacity}${name}>${inner.join('')}</g>`;
    }
    const attrs = `${opacity}${blend ? ` style="${blend}"` : ''}${name}`;
    if (l.kind === 'vector') return `<g${attrs}>${await this.nodes(l.objects)}</g>`;
    const b = l.surface.contentBounds();
    if (!b) return '';
    return `<image${attrs} x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" href="${await this.png(l.surface.readRect(b), b.w, b.h)}"/>`;
  }
}

export async function documentToSvg(doc: PaintDocument, deps: SvgExportDeps): Promise<string> {
  const w = new Writer(deps);
  const body: string[] = [];
  if (doc.paper) body.push(`<rect width="${doc.width}" height="${doc.height}" ${paintAttr('fill', doc.paper)}/>`);
  for (const l of doc.layers) body.push(await w.layer(l));
  const defs = w.defs.length ? `<defs>${w.defs.join('')}</defs>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${defs}${body.join('')}</svg>\n`;
}
