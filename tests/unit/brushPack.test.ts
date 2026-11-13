import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { BrushPackError, readBrushPack, writeBrushPack, type PackedBrush } from '@engine/io/brushPack';
import type { PngCodec } from '@engine/io/project';
import { brushRegistry } from '@engine/brush/BrushRegistry';
import '@engine/brush/library';
import { BRUSH_FORMAT_VERSION, BRUSH_PACK_FORMAT, BrushPackSchema } from '@shared/brushFormat';

/** Stand-in for PNG: 8-byte header (w, h) + raw RGBA, so packs can be tested in Node. */
const rawCodec: PngCodec = {
  async encode(data, w, h) {
    const out = new Uint8Array(8 + data.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(data, 8);
    return out;
  },
  async decode(bytes) {
    if (bytes.length < 8) throw new Error('not an image');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(0), h: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

const round = brushRegistry.get('round')!.settings;
const chalk = brushRegistry.get('chalk')!.settings;

function ownBrush(): PackedBrush {
  const tip = { w: 3, h: 3, data: new Uint8Array([0, 128, 0, 128, 255, 128, 0, 128, 0]) };
  const texture = { w: 2, h: 2, data: new Uint8Array([10, 200, 200, 10]) };
  return {
    name: 'Dotty',
    category: 'artistic',
    settings: { ...round, tip: { kind: 'image', id: 'own' }, texture: { id: 'own', scale: 2, depth: 0.5, mode: 'subtract' } },
    tip,
    texture,
  };
}

const packOf = (json: unknown, extra: Record<string, Uint8Array> = {}) => zipSync({ 'pack.json': strToU8(JSON.stringify(json)), ...extra });

describe('brush packs', () => {
  it('round-trips brushes with their own tips and textures, and built-in ones by id', async () => {
    const own = ownBrush();
    const builtin: PackedBrush = { name: 'Chalky', category: 'dry', settings: chalk, tip: null, texture: null };
    const bytes = await writeBrushPack('Mine', [own, builtin], rawCodec);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['pack.json', 'textures/1.png', 'tips/1.png']);
    const back = await readBrushPack(bytes, rawCodec);
    expect(back.name).toBe('Mine');
    expect(back.brushes).toHaveLength(2);
    expect(back.brushes[0]).toMatchObject({ name: 'Dotty', category: 'artistic', tip: own.tip, texture: own.texture });
    expect(back.brushes[0].settings.texture).toEqual({ id: 'own', scale: 2, depth: 0.5, mode: 'subtract' });
    expect(back.brushes[1].settings.tip).toEqual(chalk.tip);
    expect(back.brushes[1].tip).toBeNull();
  });

  it('reads a tip PNG without transparency by its dark parts', async () => {
    const pack = { format: BRUSH_PACK_FORMAT, version: BRUSH_FORMAT_VERSION, name: 'P', brushes: [{ name: 'B', category: 'custom', settings: { ...round, tip: { kind: 'image', id: 'own' } }, tip: 'tips/1.png', texture: null }] };
    // Opaque: black, then white.
    const png = await rawCodec.encode(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1);
    const back = await readBrushPack(packOf(pack, { 'tips/1.png': png }), rawCodec);
    expect([...back.brushes[0].tip!.data]).toEqual([255, 0]);
  });

  it('refuses what isn’t a valid pack', async () => {
    const good = { format: BRUSH_PACK_FORMAT, version: BRUSH_FORMAT_VERSION, name: 'P', brushes: [{ name: 'B', category: 'custom', settings: round, tip: null, texture: null }] };
    await expect(readBrushPack(strToU8('hello'), rawCodec)).rejects.toBeInstanceOf(BrushPackError);
    await expect(readBrushPack(zipSync({ 'other.json': strToU8('{}') }), rawCodec)).rejects.toThrow('pack.json is missing');
    await expect(readBrushPack(zipSync({ 'pack.json': strToU8('{oops') }), rawCodec)).rejects.toThrow('not JSON');
    await expect(readBrushPack(packOf({ ...good, format: 'pigmento-shape-pack' }), rawCodec)).rejects.toThrow('format');
    await expect(readBrushPack(packOf({ ...good, brushes: [] }), rawCodec)).rejects.toThrow('format');
    // A brush that uses its own tip must point at one, inside tips/.
    const ownTip = { ...good.brushes[0], settings: { ...round, tip: { kind: 'image', id: 'own' } } };
    await expect(readBrushPack(packOf({ ...good, brushes: [ownTip] }), rawCodec)).rejects.toThrow('format');
    await expect(readBrushPack(packOf({ ...good, brushes: [{ ...ownTip, tip: '../evil.png' }] }), rawCodec)).rejects.toThrow('format');
    await expect(readBrushPack(packOf({ ...good, brushes: [{ ...ownTip, tip: 'tips/1.png' }] }), rawCodec)).rejects.toThrow('tips/1.png is missing');
    await expect(readBrushPack(packOf({ ...good, brushes: [{ ...ownTip, tip: 'tips/1.png' }] }, { 'tips/1.png': new Uint8Array(3) }), rawCodec)).rejects.toThrow('isn’t a PNG');
    // Too big to unpack.
    await expect(readBrushPack(packOf(good, { 'tips/2.png': new Uint8Array(9 * 1024 * 1024) }), rawCodec)).rejects.toThrow('too large');
  });

  it('ignores files a pack doesn’t use', async () => {
    const good = { format: BRUSH_PACK_FORMAT, version: BRUSH_FORMAT_VERSION, name: 'P', brushes: [{ name: 'B', category: 'custom', settings: round, tip: null, texture: null }] };
    const back = await readBrushPack(packOf(good, { 'run.exe': new Uint8Array([77, 90]), '../up.png': new Uint8Array(4) }), rawCodec);
    expect(back.brushes.map((b) => b.name)).toEqual(['B']);
  });

  it('documents the format the schema checks', () => {
    // The example in docs/brush-format.md, kept in step with the schema.
    const example = {
      format: 'pigmento-brush-pack',
      version: 1,
      name: 'My brushes',
      brushes: [
        {
          name: 'Dotty',
          category: 'artistic',
          settings: { ...round, tip: { kind: 'image', id: 'own' }, texture: { id: 'paper', scale: 1, depth: 0.6, mode: 'multiply' } },
          tip: 'tips/1.png',
          texture: null,
        },
      ],
    };
    expect(BrushPackSchema.safeParse(example).success).toBe(true);
  });
});
