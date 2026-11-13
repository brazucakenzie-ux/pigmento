import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  BRUSH_FORMAT_VERSION,
  BRUSH_PACK_FORMAT,
  BrushPackSchema,
  MAX_MASK_SIZE,
  MAX_PACK_BRUSHES,
  MAX_PACK_ENTRY_BYTES,
  MAX_PACK_TOTAL_BYTES,
  PACK_TEXTURE_PATH,
  PACK_TIP_PATH,
  type BrushFileCategory,
  type BrushPack,
} from '@shared/brushFormat';
import { fitMask } from '../brush/masks';
import type { Mask } from '../brush/tips';
import type { BrushSettings } from '../brush/types';
import type { PngCodec } from './project';

/**
 * Brush packs (`.pigmbrush`): a zip of `pack.json` plus each brush's own tip and texture as
 * PNG. Everything is validated before use; nothing in a pack is ever run. See
 * docs/brush-format.md.
 */
export interface PackedBrush {
  name: string;
  category: BrushFileCategory;
  /** Tip and texture id `own` stand for `tip` and `texture`. */
  settings: BrushSettings;
  tip: Mask | null;
  texture: Mask | null;
}

export class BrushPackError extends Error {}

/** Tips are stored in the alpha channel (black paint), textures as opaque grey. */
function maskToRgba(m: Mask, kind: 'tip' | 'texture'): Uint8ClampedArray {
  const out = new Uint8ClampedArray(m.w * m.h * 4);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i];
    if (kind === 'tip') out[i * 4 + 3] = v;
    else {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/**
 * A mask back from a pack's PNG: a tip is its alpha (or, if the PNG has no transparency, its
 * dark parts); a texture is its lightness. Oversized images are scaled down.
 */
function rgbaToMask(img: { w: number; h: number; data: Uint8ClampedArray }, kind: 'tip' | 'texture'): Mask {
  const n = img.w * img.h;
  let transparent = false;
  for (let i = 0; i < n && !transparent; i++) transparent = img.data[i * 4 + 3] < 255;
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = img.data[i * 4 + 3];
    const lum = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    // Over white, so transparent parts read as light.
    const grey = (lum * a + 255 * (255 - a)) / 255;
    data[i] = Math.round(kind === 'texture' ? grey : transparent ? a : 255 - grey);
  }
  return fitMask({ w: img.w, h: img.h, data }, MAX_MASK_SIZE);
}

/** Pack brushes into `.pigmbrush` bytes. */
export async function writeBrushPack(name: string, brushes: readonly PackedBrush[], codec: PngCodec): Promise<Uint8Array> {
  if (!brushes.length || brushes.length > MAX_PACK_BRUSHES) throw new BrushPackError('A pack holds 1–500 brushes');
  const files: Zippable = {};
  const entries: BrushPack['brushes'] = [];
  let tips = 0;
  let textures = 0;
  for (const b of brushes) {
    let tip: string | null = null;
    let texture: string | null = null;
    if (b.tip && b.settings.tip.kind === 'image' && b.settings.tip.id === 'own') {
      tip = `tips/${++tips}.png`;
      files[tip] = [await codec.encode(maskToRgba(b.tip, 'tip'), b.tip.w, b.tip.h), { level: 0 }];
    }
    if (b.texture && b.settings.texture?.id === 'own') {
      texture = `textures/${++textures}.png`;
      files[texture] = [await codec.encode(maskToRgba(b.texture, 'texture'), b.texture.w, b.texture.h), { level: 0 }];
    }
    entries.push({ name: b.name, category: b.category, settings: b.settings, tip, texture });
  }
  const pack: BrushPack = { format: BRUSH_PACK_FORMAT, version: BRUSH_FORMAT_VERSION, name: name.trim().slice(0, 80) || 'Brushes', brushes: entries };
  const ok = BrushPackSchema.safeParse(pack);
  if (!ok.success) throw new BrushPackError('The brushes don’t make a valid pack');
  files['pack.json'] = strToU8(JSON.stringify(ok.data, null, 1));
  return zipSync(files);
}

function unzipPack(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let entries = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        entries++;
        total += f.originalSize;
        if (entries > 2 * MAX_PACK_BRUSHES + 8 || f.originalSize > MAX_PACK_ENTRY_BYTES || total > MAX_PACK_TOTAL_BYTES) throw new BrushPackError('The pack is too large');
        return f.name === 'pack.json' || PACK_TIP_PATH.test(f.name) || PACK_TEXTURE_PATH.test(f.name);
      },
    });
  } catch (err) {
    if (err instanceof BrushPackError) throw err;
    throw new BrushPackError('Not a zip file');
  }
}

/** Read and validate `.pigmbrush` bytes. */
export async function readBrushPack(bytes: Uint8Array, codec: PngCodec): Promise<{ name: string; brushes: PackedBrush[] }> {
  const files = unzipPack(bytes);
  const raw = files['pack.json'];
  if (!raw) throw new BrushPackError('pack.json is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch {
    throw new BrushPackError('pack.json is not JSON');
  }
  const r = BrushPackSchema.safeParse(parsed);
  if (!r.success) throw new BrushPackError('pack.json doesn’t match the brush pack format');
  const masks = new Map<string, Mask>();
  const load = async (p: string | null, kind: 'tip' | 'texture'): Promise<Mask | null> => {
    if (!p) return null;
    const cached = masks.get(p);
    if (cached) return cached;
    const png = files[p];
    if (!png) throw new BrushPackError(`${p} is missing`);
    let img: { w: number; h: number; data: Uint8ClampedArray };
    try {
      img = await codec.decode(png);
    } catch {
      throw new BrushPackError(`${p} isn’t a PNG`);
    }
    const m = rgbaToMask(img, kind);
    masks.set(p, m);
    return m;
  };
  const brushes: PackedBrush[] = [];
  for (const b of r.data.brushes) {
    const tip = await load(b.tip, 'tip');
    const texture = await load(b.texture, 'texture');
    brushes.push({ name: b.name, category: b.category, settings: b.settings, tip, texture });
  }
  return { name: r.data.name, brushes };
}
