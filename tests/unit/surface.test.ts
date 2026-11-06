import { describe, expect, it } from 'vitest';
import { Surface, TILE_SIZE } from '@engine/raster/Surface';
import { History } from '@engine/history/History';
import { PixelCommand, type CommandHost } from '@engine/history/commands';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { solid } from './helpers';

function host(doc: PaintDocument): CommandHost & { changes: number } {
  return {
    doc,
    changes: 0,
    layerChanged() {
      this.changes++;
    },
    structureChanged() {},
    savedSelectionsChanged() {},
    guidesChanged() {},
    layersChanged() {},
    setSelection(sel) {
      doc.selection = sel;
    },
  };
}

describe('Surface tiles', () => {
  it('starts empty and allocates tiles only when written', () => {
    const s = new Surface(600, 300);
    expect(s.cols).toBe(3);
    expect(s.rows).toBe(2);
    expect(s.tiles.every((t) => t === null)).toBe(true);
    s.fillRect({ x: 10, y: 10, w: 5, h: 5 }, { r: 255, g: 0, b: 0, a: 255 });
    expect(s.tiles.filter((t) => t !== null).length).toBe(1);
    expect(s.getPixel(12, 12)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(s.getPixel(20, 20)).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('reads and writes rects across tile boundaries', () => {
    const s = new Surface(512, 512);
    const r = { x: TILE_SIZE - 3, y: TILE_SIZE - 2, w: 6, h: 4 };
    const data = solid(r.w, r.h, [1, 2, 3, 255]);
    s.writeRect(r, { data, stride: r.w, ox: r.x, oy: r.y });
    expect(s.tiles.filter((t) => t !== null).length).toBe(4);
    expect([...s.readRect(r)]).toEqual([...data]);
    // A read that extends past the surface returns transparent outside.
    const outside = s.readRect({ x: 510, y: 0, w: 4, h: 1 });
    expect(outside.length).toBe(16);
    expect(outside[12 + 3]).toBe(0);
  });

  it('round-trips through fromRGBA/toRGBA', () => {
    const w = 300;
    const h = 260;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i++) d[i] = (i * 7) % 256;
    const s = Surface.fromRGBA(w, h, d);
    expect(s.toRGBA()).toEqual(d);
  });

  it('records only changed tiles in an edit and undoes/redoes by swapping', () => {
    const s = new Surface(1024, 1024);
    s.fillRect({ x: 0, y: 0, w: 1024, h: 1024 }, { r: 255, g: 255, b: 255, a: 255 });
    const before = s.toRGBA();
    s.beginEdit();
    s.fillRect({ x: 300, y: 300, w: 10, h: 10 }, { r: 0, g: 0, b: 0, a: 255 });
    // Writing identical pixels to another tile records nothing for it.
    s.fillRect({ x: 800, y: 800, w: 10, h: 10 }, { r: 255, g: 255, b: 255, a: 255 });
    const delta = s.endEdit()!;
    expect(delta.size).toBe(1);
    expect(delta.bytes).toBeLessThan(TILE_SIZE * TILE_SIZE * 4 + 100);
    const after = s.toRGBA();
    delta.swap();
    expect(s.toRGBA()).toEqual(before);
    delta.swap();
    expect(s.toRGBA()).toEqual(after);
  });

  it('abortEdit restores the original tiles', () => {
    const s = new Surface(100, 100);
    s.fillRect({ x: 0, y: 0, w: 100, h: 100 }, { r: 9, g: 9, b: 9, a: 255 });
    const before = s.toRGBA();
    s.beginEdit();
    s.clearRect({ x: 0, y: 0, w: 50, h: 50 });
    s.abortEdit();
    expect(s.toRGBA()).toEqual(before);
  });

  it('frees tiles that become fully transparent', () => {
    const s = new Surface(256, 256);
    s.fillRect({ x: 0, y: 0, w: 10, h: 10 }, { r: 1, g: 1, b: 1, a: 255 });
    s.beginEdit();
    s.clearRect({ x: 0, y: 0, w: 10, h: 10 });
    const d = s.endEdit()!;
    expect(s.tiles[0]).toBeNull();
    d.swap();
    expect(s.getPixel(5, 5).a).toBe(255);
  });

  it('finds content bounds', () => {
    const s = new Surface(400, 400);
    expect(s.contentBounds()).toBeNull();
    s.fillRect({ x: 30, y: 270, w: 5, h: 40 }, { r: 1, g: 1, b: 1, a: 10 });
    expect(s.contentBounds()).toEqual({ x: 30, y: 270, w: 5, h: 40 });
  });
});

describe('History with tile-delta commands', () => {
  it('undoes and redoes pixel commands and tracks the saved state', () => {
    const doc = new PaintDocument({ width: 300, height: 300 }, [new RasterLayer('', new Surface(300, 300))]);
    const h = new History();
    const hh = host(doc);
    const layer = doc.rasterLayers()[0];
    const s = layer.surface;
    const step = (color: number) => {
      s.beginEdit();
      s.fillRect({ x: color, y: 0, w: 1, h: 1 }, { r: color, g: 0, b: 0, a: 255 });
      h.push(new PixelCommand('history.pencil', hh, layer, s.endEdit()!));
    };
    step(10);
    step(20);
    step(30);
    h.markSaved();
    expect(h.isDirty).toBe(false);
    expect(s.getPixel(30, 0).r).toBe(30);
    h.undo();
    expect(h.isDirty).toBe(true);
    expect(s.getPixel(30, 0).a).toBe(0);
    expect(s.getPixel(20, 0).r).toBe(20);
    h.jumpTo(0);
    expect(s.getPixel(10, 0).a).toBe(0);
    h.jumpTo(3);
    expect(s.getPixel(30, 0).r).toBe(30);
    expect(h.isDirty).toBe(false);
    // A new command after undo drops the redo branch.
    h.undo();
    step(40);
    expect(h.length).toBe(3);
    expect(h.canRedo).toBe(false);
    expect(hh.changes).toBeGreaterThan(0);
  });

  it('evicts the oldest entries beyond the memory budget', () => {
    const doc = new PaintDocument({ width: 600, height: 600 });
    const layer = doc.rasterLayers()[0];
    const h = new History({ maxBytes: TILE_SIZE * TILE_SIZE * 4 * 3 + 1000, maxEntries: 1000 });
    const hh = host(doc);
    for (let i = 0; i < 6; i++) {
      layer.surface.beginEdit();
      layer.surface.fillRect({ x: 0, y: 0, w: 600, h: 1 }, { r: i + 1, g: 0, b: 0, a: 255 });
      h.push(new PixelCommand('history.pencil', hh, layer, layer.surface.endEdit()!));
    }
    // Each edit touches 3 tiles → only one command fits.
    expect(h.length).toBeLessThanOrEqual(2);
    expect(h.index).toBe(h.length);
  });

  it('survives 500 undo/redo cycles without growing', () => {
    const doc = new PaintDocument({ width: 512, height: 512 });
    const layer = doc.rasterLayers()[0];
    const h = new History();
    const hh = host(doc);
    for (let i = 0; i < 20; i++) {
      layer.surface.beginEdit();
      layer.surface.fillRect({ x: i * 10, y: i * 10, w: 30, h: 30 }, { r: i, g: 1, b: 2, a: 255 });
      h.push(new PixelCommand('history.brush', hh, layer, layer.surface.endEdit()!));
    }
    const bytes = h.bytes;
    const final = layer.surface.toRGBA();
    for (let c = 0; c < 500; c++) {
      h.jumpTo(0);
      h.jumpTo(h.length);
    }
    expect(h.bytes).toBe(bytes);
    expect(layer.surface.toRGBA()).toEqual(final);
  });
});
