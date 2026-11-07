import { z } from 'zod';
import type { RGBA } from '../core/color';

/**
 * Palette files: Pigmento's own JSON (import and export), GIMP palettes (.gpl) and Adobe
 * Swatch Exchange (.ase) for import. Only colours are read; names, groups and spot/process
 * flags are ignored. At most MAX_PALETTE_COLORS are kept.
 */
export const PALETTE_FORMAT = 'pigmento-palette';
export const MAX_PALETTE_COLORS = 256;

export class PaletteError extends Error {}

const Hex6 = z.string().regex(/^#[0-9a-f]{6}$/i);
export const PaletteFileSchema = z.object({
  format: z.literal(PALETTE_FORMAT),
  version: z.literal(1),
  name: z.string().max(80),
  colors: z.array(Hex6).min(1).max(MAX_PALETTE_COLORS),
});
export type PaletteFile = z.infer<typeof PaletteFileSchema>;

export interface Palette {
  name: string;
  colors: RGBA[];
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const rgb = (r: number, g: number, b: number): RGBA => ({ r: clamp(r), g: clamp(g), b: clamp(b), a: 255 });
const hex6 = (c: RGBA) => `#${[c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Colours in order, without repeats (opaque: palettes don't carry transparency). */
function unique(colors: RGBA[]): RGBA[] {
  const seen = new Set<string>();
  const out: RGBA[] = [];
  for (const c of colors) {
    const k = hex6(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...c, a: 255 });
    if (out.length >= MAX_PALETTE_COLORS) break;
  }
  return out;
}

export function paletteToJson(p: Palette): string {
  const file: PaletteFile = { format: PALETTE_FORMAT, version: 1, name: p.name.slice(0, 80), colors: unique(p.colors).map(hex6) };
  return JSON.stringify(file, null, 1);
}

function parseJson(text: string): Palette {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PaletteError('Not JSON');
  }
  // A plain list of "#rrggbb" strings is accepted too.
  if (Array.isArray(raw)) raw = { format: PALETTE_FORMAT, version: 1, name: '', colors: raw };
  const r = PaletteFileSchema.safeParse(raw);
  if (!r.success) throw new PaletteError('Not a palette');
  return { name: r.data.name, colors: unique(r.data.colors.map((h) => rgb(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)))) };
}

/** GIMP palette: a "GIMP Palette" header, optional Name/Columns lines, then "R G B name" rows. */
export function parseGpl(text: string): Palette {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!/^GIMP Palette\s*$/.test(lines[0] ?? '')) throw new PaletteError('Not a GIMP palette');
  let name = '';
  const colors: RGBA[] = [];
  for (const line of lines.slice(1)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = /^Name:\s*(.*)$/i.exec(l);
    if (m) {
      name = m[1].slice(0, 80);
      continue;
    }
    if (/^Columns:/i.test(l)) continue;
    const v = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/.exec(l);
    if (v) colors.push(rgb(+v[1], +v[2], +v[3]));
  }
  if (!colors.length) throw new PaletteError('No colours');
  return { name, colors: unique(colors) };
}

/** CIE Lab (D50, as ASE stores it) to sRGB. */
function labToRgb(L: number, a: number, b: number): RGBA {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  // D50 white, then Bradford-adapted D50 → D65 XYZ → linear sRGB.
  const X = 0.96422 * f(fx);
  const Y = 1.0 * f(fy);
  const Z = 0.82521 * f(fz);
  const lr = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z;
  const lg = -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z;
  const lb = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z;
  const gamma = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
  return rgb(gamma(lr), gamma(lg), gamma(lb));
}

/** Adobe Swatch Exchange: "ASEF", a version, then colour, group-start and group-end blocks. */
export function parseAse(bytes: Uint8Array): Palette {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'ASEF') throw new PaletteError('Not an ASE file');
  const blocks = dv.getUint32(8);
  if (blocks > 100000) throw new PaletteError('Too many blocks');
  const colors: RGBA[] = [];
  let p = 12;
  for (let i = 0; i < blocks && p + 6 <= bytes.length; i++) {
    const type = dv.getUint16(p);
    const length = dv.getUint32(p + 2);
    const start = p + 6;
    const end = start + length;
    if (end > bytes.length) throw new PaletteError('Truncated ASE file');
    if (type === 0x0001 && length >= 2) {
      const nameLen = dv.getUint16(start);
      let q = start + 2 + nameLen * 2;
      if (q + 4 > end) throw new PaletteError('Bad colour block');
      const model = String.fromCharCode(...bytes.subarray(q, q + 4));
      q += 4;
      const f = (k: number) => {
        if (q + (k + 1) * 4 > end) throw new PaletteError('Bad colour block');
        return dv.getFloat32(q + k * 4);
      };
      if (model === 'RGB ') colors.push(rgb(f(0) * 255, f(1) * 255, f(2) * 255));
      else if (model === 'CMYK') {
        const [c, m, y, k] = [f(0), f(1), f(2), f(3)];
        colors.push(rgb(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)));
      } else if (model === 'Gray') colors.push(rgb(f(0) * 255, f(0) * 255, f(0) * 255));
      else if (model === 'LAB ') colors.push(labToRgb(f(0) * 100, f(1), f(2)));
    }
    p = end;
  }
  if (!colors.length) throw new PaletteError('No colours');
  return { name: '', colors: unique(colors) };
}

/** Read a palette file by its extension. */
export function parsePalette(fileName: string, bytes: Uint8Array): Palette {
  const ext = /\.([a-z]+)$/i.exec(fileName)?.[1].toLowerCase();
  if (ext === 'ase') return parseAse(bytes);
  const text = new TextDecoder('utf-8').decode(bytes);
  if (ext === 'gpl') return parseGpl(text);
  if (ext === 'json') return parseJson(text);
  throw new PaletteError('Unknown palette type');
}
