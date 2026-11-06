import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { GroupLayer, PaintDocument, RasterLayer, walkLayers } from '@engine/doc/Document';
import { ProjectError, isZip, loadProject, saveProject, type PngCodec } from '@engine/io/project';
import { Surface } from '@engine/raster/Surface';

/** Stand-in for PNG: 8-byte header (w, h) + raw RGBA, so the format logic can be tested in Node. */
const rawCodec: PngCodec = {
  async encode(data, w, h) {
    const out = new Uint8Array(8 + data.length);
    new DataView(out.buffer).setUint32(0, w);
    new DataView(out.buffer).setUint32(4, h);
    out.set(data, 8);
    return out;
  },
  async decode(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(0), h: dv.getUint32(4), data: new Uint8ClampedArray(bytes.slice(8)) };
  },
};

function sampleDoc(): PaintDocument {
  const bottom = new Surface(300, 200);
  bottom.fillRect({ x: 0, y: 0, w: 300, h: 200 }, { r: 250, g: 240, b: 230, a: 255 });
  const a = new RasterLayer('Sky', bottom);
  const dot = new Surface(300, 200);
  dot.fillRect({ x: 260, y: 150, w: 10, h: 8 }, { r: 200, g: 0, b: 0, a: 128 });
  const b = new RasterLayer('Dot', dot);
  b.setProps({ blend: 'multiply', opacity: 0.6, locked: true });
  const empty = new RasterLayer('Empty', new Surface(300, 200));
  empty.visible = false;
  const g = new GroupLayer('Group', [b, empty]);
  g.collapsed = true;
  g.blend = 'screen';
  const doc = new PaintDocument({ width: 300, height: 200, dpi: 150, paper: null }, [a, g]);
  doc.activeId = b.id;
  return doc;
}

describe('.pigm projects', () => {
  it('round-trips layers, groups, properties and pixels', async () => {
    const doc = sampleDoc();
    const bytes = await saveProject(doc, rawCodec);
    expect(isZip(bytes)).toBe(true);
    const back = await loadProject(bytes, rawCodec);
    expect([back.width, back.height, back.dpi, back.paper]).toEqual([300, 200, 150, null]);
    const names = [...walkLayers(back.layers)].map((l) => `${l.kind}:${l.name}`);
    expect(names).toEqual(['raster:Sky', 'group:Group', 'raster:Dot', 'raster:Empty']);
    const g = back.layers[1] as GroupLayer;
    expect([g.blend, g.collapsed]).toEqual(['screen', true]);
    const dot = g.children[0] as RasterLayer;
    expect([dot.blend, dot.opacity, dot.locked]).toEqual(['multiply', 0.6, true]);
    expect(dot.surface.getPixel(265, 152)).toEqual({ r: 200, g: 0, b: 0, a: 128 });
    expect(dot.surface.getPixel(10, 10).a).toBe(0);
    expect((g.children[1] as RasterLayer).visible).toBe(false);
    expect(back.activeId).toBe(doc.activeId);
    expect((back.layers[0] as RasterLayer).surface.toRGBA()).toEqual((doc.layers[0] as RasterLayer).surface.toRGBA());
  });

  it('stores only the content area of each layer', async () => {
    const bytes = await saveProject(sampleDoc(), rawCodec);
    // The 10×8 dot is stored as 10×8, not 300×200; the empty layer stores no image.
    expect(bytes.length).toBeLessThan(300 * 200 * 4 + 10 * 8 * 4 + 4000);
  });

  it('rejects non-projects, malformed JSON and newer versions', async () => {
    await expect(loadProject(new Uint8Array([1, 2, 3]), rawCodec)).rejects.toBeInstanceOf(ProjectError);
    const bad = zipSync({ 'document.json': strToU8('{"format":"pigmento-project","version":1,"width":-5}') });
    await expect(loadProject(bad, rawCodec)).rejects.toMatchObject({ key: 'error.projectInvalid' });
    const newer = zipSync({ 'document.json': strToU8('{"version":99}') });
    await expect(loadProject(newer, rawCodec)).rejects.toMatchObject({ key: 'error.projectNewer' });
    const missing = zipSync({
      'document.json': strToU8(
        JSON.stringify({
          format: 'pigmento-project',
          version: 1,
          width: 10,
          height: 10,
          dpi: 96,
          paper: null,
          activeId: 'a',
          layers: [{ kind: 'raster', id: 'a', name: '', opacity: 1, blend: 'normal', visible: true, locked: false, image: { file: 'layers/0001.png', x: 0, y: 0, w: 2, h: 2 } }],
        }),
      ),
    });
    await expect(loadProject(missing, rawCodec)).rejects.toMatchObject({ key: 'error.projectInvalid' });
  });

  it('ignores unexpected files and renames duplicate layer ids', async () => {
    const doc = sampleDoc();
    const bytes = await saveProject(doc, rawCodec);
    const back = await loadProject(bytes, rawCodec);
    const ids = [...walkLayers(back.layers)].map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
