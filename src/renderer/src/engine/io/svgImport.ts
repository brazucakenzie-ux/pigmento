import type { RGBA } from '../core/color';
import type { ShapeStyle } from '../live/ShapeObject';
import type { PathCmd } from '../shapes/path';
import { vectorId, type VectorShape } from '../vector/model';
import { fromCmds } from '../vector/pathData';
import type { CapStyle, JoinStyle } from '../vector/style';

/**
 * SVG import: paths and basic shapes become editable paths on a shape layer. The file is read
 * with a small XML reader of our own (no DOM, no entity expansion, no scripts, styles sheets,
 * external references, images or text): only geometry and simple fill/stroke styles are used.
 */
export const MAX_SVG_ELEMENTS = 20000;
export const MAX_SVG_POINTS = 1_000_000;
const MAX_DEPTH = 64;

export class SvgImportError extends Error {
  constructor(readonly key: 'error.svgInvalid' | 'error.svgEmpty' | 'error.svgTooComplex') {
    super(key);
  }
}

// ---- XML ------------------------------------------------------------------------------------

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,4});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Elements and attributes only (text, comments, CDATA, processing instructions and DOCTYPEs are skipped). */
export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  let count = 0;
  let i = 0;
  const n = text.length;
  const skipPast = (end: string) => {
    const k = text.indexOf(end, i);
    if (k < 0) throw new SvgImportError('error.svgInvalid');
    i = k + end.length;
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (text.startsWith('<!--', i)) skipPast('-->');
    else if (text.startsWith('<![CDATA[', i)) skipPast(']]>');
    else if (text.startsWith('<?', i)) skipPast('?>');
    else if (text.startsWith('<!', i)) {
      // A DOCTYPE, maybe with an internal subset in brackets (its entities are not used).
      const bracket = text.indexOf('[', i);
      const close = text.indexOf('>', i);
      if (bracket >= 0 && close >= 0 && bracket < close) {
        i = bracket;
        skipPast(']');
      }
      skipPast('>');
    } else if (text.startsWith('</', i)) {
      const close = text.indexOf('>', i);
      if (close < 0) throw new SvgImportError('error.svgInvalid');
      i = close + 1;
      if (stack.length > 1) stack.pop();
    } else {
      const m = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(i, i + 200));
      if (!m) {
        i++;
        continue;
      }
      i += m[0].length;
      const attrs: Record<string, string> = {};
      const attr = /\s*([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
      for (;;) {
        attr.lastIndex = i;
        const a = attr.exec(text);
        if (!a) break;
        attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
        i = attr.lastIndex;
      }
      while (i < n && /\s/.test(text[i])) i++;
      const selfClosing = text.startsWith('/>', i);
      if (selfClosing) i += 2;
      else if (text[i] === '>') i++;
      else throw new SvgImportError('error.svgInvalid');
      if (++count > MAX_SVG_ELEMENTS) throw new SvgImportError('error.svgTooComplex');
      if (stack.length > MAX_DEPTH + 1) throw new SvgImportError('error.svgTooComplex');
      const el: XmlElement = { name: m[1].replace(/^.*:/, ''), attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
    }
  }
  return root;
}

// ---- numbers, transforms --------------------------------------------------------------------

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
const nums = (s: string): number[] => (s.match(NUM) ?? []).map(Number).filter(Number.isFinite);
const len = (s: string | undefined, fallback = 0): number => {
  if (s === undefined) return fallback;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : fallback;
};

export function parseTransform(s: string | undefined): M {
  let m = IDENTITY;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let r = re.exec(s); r; r = re.exec(s)) {
    const a = nums(r[2]);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let t: M = IDENTITY;
    if (r[1] === 'matrix' && a.length >= 6) t = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (r[1] === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (r[1] === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (r[1] === 'rotate') {
      const c = Math.cos(rad);
      const sn = Math.sin(rad);
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      t = mul(mul([1, 0, 0, 1, cx, cy], [c, sn, -sn, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (r[1] === 'skewX') t = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (r[1] === 'skewY') t = [1, Math.tan(rad), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

// ---- path data ------------------------------------------------------------------------------

/** One elliptical arc (SVG endpoint form) as cubic Béziers. */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): PathCmd[] {
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return [{ op: 'L', x: x2, y: y2 }];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  if (sweep && dt < 0) dt += Math.PI * 2;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: PathCmd[] = [];
  const pt = (t: number) => {
    const ex = Math.cos(t) * rx;
    const ey = Math.sin(t) * ry;
    return { x: cos * ex - sin * ey + cx, y: sin * ex + cos * ey + cy, dx: -Math.sin(t) * rx, dy: Math.cos(t) * ry };
  };
  for (let s = 0; s < segs; s++) {
    const a = t1 + s * step;
    const b = a + step;
    const p = pt(a);
    const q = pt(b);
    const d1 = { x: cos * p.dx - sin * p.dy, y: sin * p.dx + cos * p.dy };
    const d2 = { x: cos * q.dx - sin * q.dy, y: sin * q.dx + cos * q.dy };
    out.push({ op: 'C', x1: p.x + k * d1.x, y1: p.y + k * d1.y, x2: q.x - k * d2.x, y2: q.y - k * d2.y, x: q.x, y: q.y });
  }
  // Land exactly on the end point.
  const last = out[out.length - 1];
  if (last.op === 'C') {
    last.x = x2;
    last.y = y2;
  }
  return out;
}

/** SVG path data as absolute commands (arcs become curves, shorthand curves are expanded). */
export function parsePathData(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  let i = 0;
  const n = d.length;
  const skip = () => {
    while (i < n && /[\s,]/.test(d[i])) i++;
  };
  const num = (): number | null => {
    skip();
    NUM.lastIndex = 0;
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 64));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): boolean | null => {
    skip();
    if (d[i] === '0' || d[i] === '1') return d[i++] === '1';
    return null;
  };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastC: { x: number; y: number } | null = null;
  let lastQ: { x: number; y: number } | null = null;
  let cmd = '';
  while (i < n) {
    skip();
    if (i >= n) break;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(d[i])) cmd = d[i++];
    else if (!cmd || cmd === 'Z' || cmd === 'z') break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      out.push({ op: 'Z' });
      cx = sx;
      cy = sy;
      lastC = lastQ = null;
      continue;
    }
    if (C === 'M' || C === 'L' || C === 'T') {
      const x = num();
      const y = num();
      if (x === null || y === null) break;
      if (C === 'T') {
        const q: { x: number; y: number } = lastQ ? { x: 2 * cx - lastQ.x, y: 2 * cy - lastQ.y } : { x: cx, y: cy };
        out.push({ op: 'Q', x1: q.x, y1: q.y, x: x + ox, y: y + oy });
        lastQ = q;
        lastC = null;
      } else {
        out.push({ op: C === 'M' ? 'M' : 'L', x: x + ox, y: y + oy });
        lastC = lastQ = null;
      }
      cx = x + ox;
      cy = y + oy;
      if (C === 'M') {
        sx = cx;
        sy = cy;
        // More pairs after a moveto are lines.
        cmd = rel ? 'l' : 'L';
      }
    } else if (C === 'H' || C === 'V') {
      const v = num();
      if (v === null) break;
      if (C === 'H') cx = v + ox;
      else cy = v + oy;
      out.push({ op: 'L', x: cx, y: cy });
      lastC = lastQ = null;
    } else if (C === 'C' || C === 'S') {
      const a = C === 'C' ? [num(), num(), num(), num(), num(), num()] : [null, null, num(), num(), num(), num()];
      if (a.slice(2).some((v) => v === null) || (C === 'C' && (a[0] === null || a[1] === null))) break;
      const c1 = C === 'C' ? { x: a[0]! + ox, y: a[1]! + oy } : lastC ? { x: 2 * cx - lastC.x, y: 2 * cy - lastC.y } : { x: cx, y: cy };
      const c2 = { x: a[2]! + ox, y: a[3]! + oy };
      cx = a[4]! + ox;
      cy = a[5]! + oy;
      out.push({ op: 'C', x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: cx, y: cy });
      lastC = c2;
      lastQ = null;
    } else if (C === 'Q') {
      const a = [num(), num(), num(), num()];
      if (a.some((v) => v === null)) break;
      const q = { x: a[0]! + ox, y: a[1]! + oy };
      cx = a[2]! + ox;
      cy = a[3]! + oy;
      out.push({ op: 'Q', x1: q.x, y1: q.y, x: cx, y: cy });
      lastQ = q;
      lastC = null;
    } else if (C === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = flag();
      const sweep = flag();
      const x = num();
      const y = num();
      if (rx === null || ry === null || rot === null || large === null || sweep === null || x === null || y === null) break;
      out.push(...arcToCubics(cx, cy, rx, ry, rot, large, sweep, x + ox, y + oy));
      cx = x + ox;
      cy = y + oy;
      lastC = lastQ = null;
    }
    if (out.length > MAX_SVG_POINTS) throw new SvgImportError('error.svgTooComplex');
  }
  // A path must start with a moveto.
  return out.length && out[0].op === 'M' ? out : [];
}

// ---- basic shapes ---------------------------------------------------------------------------

const KAPPA = 0.5522847498;

function ellipseCmds(cx: number, cy: number, rx: number, ry: number): PathCmd[] {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    { op: 'M', x: cx + rx, y: cy },
    { op: 'C', x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
    { op: 'C', x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
    { op: 'C', x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
    { op: 'C', x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
    { op: 'Z' },
  ];
}

function rectCmds(x: number, y: number, w: number, h: number, rxIn: number, ryIn: number): PathCmd[] {
  const rx = Math.min(w / 2, rxIn || ryIn);
  const ry = Math.min(h / 2, ryIn || rxIn);
  if (rx <= 0 || ry <= 0) {
    return [{ op: 'M', x, y }, { op: 'L', x: x + w, y }, { op: 'L', x: x + w, y: y + h }, { op: 'L', x, y: y + h }, { op: 'Z' }];
  }
  const kx = rx * (1 - KAPPA);
  const ky = ry * (1 - KAPPA);
  return [
    { op: 'M', x: x + rx, y },
    { op: 'L', x: x + w - rx, y },
    { op: 'C', x1: x + w - kx, y1: y, x2: x + w, y2: y + ky, x: x + w, y: y + ry },
    { op: 'L', x: x + w, y: y + h - ry },
    { op: 'C', x1: x + w, y1: y + h - ky, x2: x + w - kx, y2: y + h, x: x + w - rx, y: y + h },
    { op: 'L', x: x + rx, y: y + h },
    { op: 'C', x1: x + kx, y1: y + h, x2: x, y2: y + h - ky, x, y: y + h - ry },
    { op: 'L', x, y: y + ry },
    { op: 'C', x1: x, y1: y + ky, x2: x + kx, y2: y, x: x + rx, y },
    { op: 'Z' },
  ];
}

function pointsCmds(s: string | undefined, close: boolean): PathCmd[] {
  const v = nums(s ?? '');
  const out: PathCmd[] = [];
  for (let k = 0; k + 1 < v.length; k += 2) out.push({ op: k === 0 ? 'M' : 'L', x: v[k], y: v[k + 1] });
  if (close && out.length > 2) out.push({ op: 'Z' });
  return out;
}

function shapeCmds(el: XmlElement): PathCmd[] {
  const a = el.attrs;
  switch (el.name) {
    case 'path':
      return parsePathData(a.d ?? '');
    case 'rect': {
      const w = len(a.width);
      const h = len(a.height);
      return w > 0 && h > 0 ? rectCmds(len(a.x), len(a.y), w, h, len(a.rx), len(a.ry)) : [];
    }
    case 'circle': {
      const r = len(a.r);
      return r > 0 ? ellipseCmds(len(a.cx), len(a.cy), r, r) : [];
    }
    case 'ellipse': {
      const rx = len(a.rx);
      const ry = len(a.ry);
      return rx > 0 && ry > 0 ? ellipseCmds(len(a.cx), len(a.cy), rx, ry) : [];
    }
    case 'line':
      return [
        { op: 'M', x: len(a.x1), y: len(a.y1) },
        { op: 'L', x: len(a.x2), y: len(a.y2) },
      ];
    case 'polyline':
      return pointsCmds(a.points, false);
    case 'polygon':
      return pointsCmds(a.points, true);
    default:
      return [];
  }
}

function transformCmds(cmds: readonly PathCmd[], m: M): PathCmd[] {
  const t = (x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  return cmds.map((c) => {
    if (c.op === 'Z') return c;
    const p = t(c.x, c.y);
    if (c.op === 'M' || c.op === 'L') return { op: c.op, x: p.x, y: p.y };
    const a = t(c.x1, c.y1);
    if (c.op === 'Q') return { op: 'Q', x1: a.x, y1: a.y, x: p.x, y: p.y };
    const b = t(c.x2, c.y2);
    return { op: 'C', x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: p.x, y: p.y };
  });
}

// ---- styles ---------------------------------------------------------------------------------

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  navy: [0, 0, 128],
  teal: [0, 128, 128],
  olive: [128, 128, 0],
  maroon: [128, 0, 0],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  gold: [255, 215, 0],
};

/** A paint value: a colour, 'none', or null when it can't be read (inherit / leave as is). */
export function parseColor(v: string | undefined): RGBA | 'none' | null {
  if (v === undefined) return null;
  const s = v.trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return 'none';
  if (s === 'currentcolor') return { r: 0, g: 0, b: 0, a: 255 };
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    const e = (k: number) => parseInt(h[k] + h[k], 16);
    if (h.length === 3 || h.length === 4) return { r: e(0), g: e(1), b: e(2), a: h.length === 4 ? e(3) : 255 };
    if (h.length === 6 || h.length === 8) {
      const p = (k: number) => parseInt(h.slice(k, k + 2), 16);
      return { r: p(0), g: p(2), b: p(4), a: h.length === 8 ? p(6) : 255 };
    }
    return null;
  }
  m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const ch = (p: string | undefined, max: number) => {
      if (!p) return max;
      const n = parseFloat(p);
      if (!Number.isFinite(n)) return 0;
      return Math.round(Math.min(max, Math.max(0, p.endsWith('%') ? (n / 100) * max : n)));
    };
    const alpha = parts[3] === undefined ? 255 : Math.round(Math.min(1, Math.max(0, parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]))) * 255);
    return { r: ch(parts[0], 255), g: ch(parts[1], 255), b: ch(parts[2], 255), a: Number.isFinite(alpha) ? alpha : 255 };
  }
  const named = NAMED[s];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 255 };
  // Gradients and patterns (url(#…)) are not imported; such parts are filled grey.
  if (s.startsWith('url(')) return { r: 128, g: 128, b: 128, a: 255 };
  return null;
}

interface Paint {
  fill: RGBA | 'none';
  stroke: RGBA | 'none';
  width: number;
  fillRule: 'evenodd' | 'nonzero';
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
  cap: CapStyle;
  join: JoinStyle;
  hidden: boolean;
}

const INITIAL: Paint = { fill: { r: 0, g: 0, b: 0, a: 255 }, stroke: 'none', width: 1, fillRule: 'nonzero', fillOpacity: 1, strokeOpacity: 1, opacity: 1, cap: 'butt', join: 'miter', hidden: false };

function props(el: XmlElement): Record<string, string> {
  const out: Record<string, string> = { ...el.attrs };
  // The style attribute wins over presentation attributes.
  for (const decl of (el.attrs.style ?? '').split(';')) {
    const k = decl.indexOf(':');
    if (k > 0) out[decl.slice(0, k).trim()] = decl.slice(k + 1).replace(/!important/i, '').trim();
  }
  return out;
}

const unit = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

function inherit(parent: Paint, el: XmlElement): Paint {
  const p = props(el);
  const fill = parseColor(p.fill);
  const stroke = parseColor(p.stroke);
  const width = p['stroke-width'] !== undefined ? parseFloat(p['stroke-width']) : NaN;
  const cap = p['stroke-linecap'];
  const join = p['stroke-linejoin'];
  return {
    fill: fill ?? parent.fill,
    stroke: stroke ?? parent.stroke,
    width: Number.isFinite(width) && width >= 0 ? width : parent.width,
    fillRule: p['fill-rule'] === 'evenodd' ? 'evenodd' : p['fill-rule'] === 'nonzero' ? 'nonzero' : parent.fillRule,
    fillOpacity: unit(p['fill-opacity'], parent.fillOpacity),
    strokeOpacity: unit(p['stroke-opacity'], parent.strokeOpacity),
    // Group opacity is applied to each shape inside (close enough for shapes that don't overlap).
    opacity: parent.opacity * unit(p.opacity, 1),
    cap: cap === 'round' || cap === 'square' || cap === 'butt' ? cap : parent.cap,
    join: join === 'round' || join === 'bevel' ? join : join === 'miter' || join === 'miter-clip' || join === 'arcs' ? 'miter' : parent.join,
    hidden: parent.hidden || p.display === 'none' || p.visibility === 'hidden' || p.visibility === 'collapse',
  };
}

// ---- document -------------------------------------------------------------------------------

/** Elements whose content is never drawn directly (or isn't supported). */
const SKIPPED = new Set(['defs', 'symbol', 'clipPath', 'mask', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'style', 'script', 'foreignObject', 'text', 'image', 'use', 'metadata', 'title', 'desc', 'switch']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

export interface SvgDrawing {
  width: number;
  height: number;
  shapes: VectorShape[];
}

/** The drawing's shapes as editable paths, in its own pixel coordinates (viewBox applied). */
export function importSvg(text: string): SvgDrawing {
  const doc = parseXml(text);
  const svg = doc.children.find((c) => c.name === 'svg');
  if (!svg) throw new SvgImportError('error.svgInvalid');
  const vb = nums(svg.attrs.viewBox ?? svg.attrs.viewbox ?? '');
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  let width = len(svg.attrs.width, hasVb ? vb[2] : 0);
  let height = len(svg.attrs.height, hasVb ? vb[3] : 0);
  if (/%$/.test(svg.attrs.width ?? '')) width = hasVb ? vb[2] : 0;
  if (/%$/.test(svg.attrs.height ?? '')) height = hasVb ? vb[3] : 0;
  let root: M = IDENTITY;
  if (hasVb) {
    if (!width) width = vb[2];
    if (!height) height = vb[3];
    // preserveAspectRatio's default: scale evenly and centre (xMidYMid meet).
    const k = (svg.attrs.preserveAspectRatio ?? '').trim() === 'none' ? null : Math.min(width / vb[2], height / vb[3]);
    root = k === null ? [width / vb[2], 0, 0, height / vb[3], -vb[0] * (width / vb[2]), -vb[1] * (height / vb[3])] : [k, 0, 0, k, (width - vb[2] * k) / 2 - vb[0] * k, (height - vb[3] * k) / 2 - vb[1] * k];
  }
  const shapes: VectorShape[] = [];
  let points = 0;
  const walk = (el: XmlElement, m: M, paint: Paint, depth: number) => {
    if (depth > MAX_DEPTH || SKIPPED.has(el.name)) return;
    const own = inherit(paint, el);
    const ctm = mul(m, parseTransform(el.attrs.transform));
    if (SHAPES.has(el.name)) {
      if (own.hidden) return;
      const cmds = transformCmds(shapeCmds(el), ctm);
      points += cmds.length;
      if (points > MAX_SVG_POINTS) throw new SvgImportError('error.svgTooComplex');
      const node = toShape(cmds, own, ctm, el.name === 'line');
      if (node) shapes.push(node);
      return;
    }
    if (el.name === 'svg' || el.name === 'g' || el.name === 'a') for (const c of el.children) walk(c, ctm, own, depth + 1);
  };
  walk(svg, root, INITIAL, 0);
  if (!shapes.length) throw new SvgImportError('error.svgEmpty');
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), shapes };
}

function withAlpha(c: RGBA, k: number): RGBA {
  return { ...c, a: Math.round(c.a * k) };
}

function toShape(cmds: PathCmd[], p: Paint, ctm: M, lineOnly: boolean): VectorShape | null {
  const subpaths = fromCmds(cmds);
  if (!subpaths.length) return null;
  const fill = !lineOnly && p.fill !== 'none' && p.fillOpacity * p.opacity > 0 ? withAlpha(p.fill, p.fillOpacity * p.opacity) : null;
  const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
  const width = p.width * scale;
  const stroke = p.stroke !== 'none' && width > 0 && p.strokeOpacity * p.opacity > 0 ? withAlpha(p.stroke, p.strokeOpacity * p.opacity) : null;
  if (!fill && !stroke) return null;
  const style: ShapeStyle = {
    mode: fill && stroke ? 'both' : fill ? 'fill' : 'outline',
    width: stroke ? Math.min(1000, Math.round(width * 100) / 100) : 1,
    outline: stroke ?? fill!,
    fill: fill ?? stroke!,
    radius: 0,
    antialias: true,
    ...(stroke ? { cap: p.cap, join: p.join } : {}),
  };
  return { type: 'shape', id: vectorId(), shape: 'path', box: null, points: [], style, subpaths, fillRule: p.fillRule };
}
