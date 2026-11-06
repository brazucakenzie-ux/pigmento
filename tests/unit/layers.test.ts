import { describe, expect, it } from 'vitest';
import { blendPixel, compositeLayers } from '@engine/raster/blend';
import { BLEND_MODES, GroupLayer, PaintDocument, RasterLayer, walkLayers, type BlendMode } from '@engine/doc/Document';
import { LayerController, type LayerHost } from '@engine/doc/LayerController';
import { History } from '@engine/history/History';
import { Surface } from '@engine/raster/Surface';

/** Blend one opaque source colour over one backdrop colour; returns [r,g,b,a] 0–255. */
function blend(cb: number[], cs: number[], mode: BlendMode, alpha = 1): number[] {
  const d = new Uint8ClampedArray(cb);
  blendPixel(d, 0, cs[0], cs[1], cs[2], (cs[3] / 255) * alpha, mode);
  return [...d];
}

const g = (v: number) => [v, v, v, 255];
const close = (a: number[], b: number[], tol = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('blend modes (W3C compositing formulas)', () => {
  it('covers all 15 modes', () => {
    expect(BLEND_MODES).toHaveLength(15);
  });

  it('separable modes', () => {
    expect(blend([0, 0, 255, 255], [255, 0, 0, 255], 'multiply')).toEqual([0, 0, 0, 255]);
    expect(close(blend(g(255), g(128), 'multiply'), g(128))).toBe(true);
    expect(close(blend(g(128), g(128), 'screen'), g(192))).toBe(true);
    expect(blend(g(200), g(50), 'difference')).toEqual(g(150));
    expect(blend(g(200), g(50), 'darken')).toEqual(g(50));
    expect(blend(g(200), g(50), 'lighten')).toEqual(g(200));
    // overlay(cb=.25, cs=.5) = hard-light(cs, cb) → 2·cs·cb = .25
    expect(close(blend(g(64), g(128), 'overlay'), g(64), 2)).toBe(true);
    // hard-light(cb=.8, cs=.25) = 2·cs·cb = .4
    expect(close(blend(g(204), g(64), 'hard-light'), g(102), 2)).toBe(true);
    expect(blend(g(128), g(128), 'color-dodge')).toEqual(g(255));
    expect(close(blend(g(128), g(128), 'color-burn'), g(0), 2)).toBe(true);
    // soft-light with a 50% grey source leaves the backdrop unchanged
    expect(close(blend(g(77), g(128), 'soft-light'), g(77), 2)).toBe(true);
  });

  it('non-separable modes keep the right luminance', () => {
    const lum = (c: number[]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const red = [220, 40, 40, 255];
    const teal = [20, 160, 150, 255];
    // color / hue / saturation keep the backdrop's luminance; luminosity takes the source's.
    for (const mode of ['color', 'hue', 'saturation'] as const) {
      expect(Math.abs(lum(blend(red, teal, mode)) - lum(red))).toBeLessThan(2.5);
    }
    expect(Math.abs(lum(blend(red, teal, 'luminosity')) - lum(teal))).toBeLessThan(2.5);
    // Grey has no saturation, so saturation mode with a grey source makes the backdrop grey.
    const s = blend(red, g(128), 'saturation');
    expect(Math.max(...s.slice(0, 3)) - Math.min(...s.slice(0, 3))).toBeLessThanOrEqual(1);
  });

  it('respects source alpha and transparent backdrops', () => {
    // 50% multiply of black over white = mid grey
    expect(close(blend(g(255), [0, 0, 0, 255], 'multiply', 0.5), g(128))).toBe(true);
    // Over a transparent backdrop the source shows unblended
    expect(blend([0, 0, 0, 0], [10, 200, 30, 255], 'multiply')).toEqual([10, 200, 30, 255]);
    // Fully transparent source changes nothing
    expect(blend(g(90), [255, 0, 0, 0], 'screen')).toEqual(g(90));
  });
});

function solidLayer(w: number, h: number, c: [number, number, number, number], mode: BlendMode = 'normal'): RasterLayer {
  const s = new Surface(w, h);
  s.fillRect({ x: 0, y: 0, w, h }, { r: c[0], g: c[1], b: c[2], a: c[3] });
  const l = new RasterLayer('', s);
  l.blend = mode;
  return l;
}

function px(layers: (RasterLayer | GroupLayer)[]): number[] {
  const out = new Uint8ClampedArray(4);
  compositeLayers(layers, { x: 0, y: 0, w: 1, h: 1 }, { data: out, stride: 1, ox: 0, oy: 0 });
  return [...out];
}

describe('compositing the layer tree', () => {
  it('blends layers bottom to top and skips hidden ones', () => {
    const base = solidLayer(4, 4, [255, 255, 255, 255]);
    const red = solidLayer(4, 4, [255, 0, 0, 255], 'multiply');
    expect(px([base, red])).toEqual([255, 0, 0, 255]);
    red.visible = false;
    expect(px([base, red])).toEqual([255, 255, 255, 255]);
  });

  it('isolates groups: children blend inside the group first', () => {
    const base = solidLayer(4, 4, [0, 0, 255, 255]);
    // Multiply inside an otherwise empty group has nothing to multiply with, so the group
    // contains plain red, which then covers the blue base.
    const child = solidLayer(4, 4, [255, 0, 0, 255], 'multiply');
    const group = new GroupLayer('', [child]);
    expect(px([base, group])).toEqual([255, 0, 0, 255]);
    // The group's own blend mode applies to its combined result.
    group.blend = 'multiply';
    expect(px([base, group])).toEqual([0, 0, 0, 255]);
    group.opacity = 0;
    expect(px([base, group])).toEqual([0, 0, 255, 255]);
  });
});

/** A minimal engine stand-in for layer operations. */
function setup() {
  const doc = new PaintDocument({ width: 8, height: 8 }, [solidLayer(8, 8, [255, 255, 255, 255])]);
  let changes = 0;
  const host: LayerHost = {
    doc,
    history: new History(),
    commitLive() {},
    notify() {},
    layerChanged() {},
    structureChanged() {},
    layersChanged() {
      changes++;
    },
    setSelection() {},
  };
  const layers = new LayerController(host);
  layers.namer = (kind, arg) => `${kind} ${arg}`;
  return { doc, host, layers, changes: () => changes };
}

const ids = (doc: PaintDocument) => [...walkLayers(doc.layers)].map((l) => l.id);

describe('LayerController', () => {
  it('adds, duplicates and deletes with undo/redo', () => {
    const { doc, host, layers } = setup();
    const first = doc.layers[0].id;
    const a = layers.add();
    expect(doc.layers.map((l) => l.id)).toEqual([first, a]);
    expect(doc.activeId).toBe(a);
    expect(doc.layerById(a)!.name).toBe('layer 2');
    const copy = layers.duplicate(first)!;
    expect(doc.layers.map((l) => l.id)).toEqual([first, copy, a]);
    // The source is unnamed, so the copy is named after the default name.
    expect(doc.layerById(copy)!.name).toBe('copy layer 1');
    layers.remove(a);
    expect(doc.layers.map((l) => l.id)).toEqual([first, copy]);
    host.history.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([first, copy, a]);
    host.history.jumpTo(0);
    expect(doc.layers.map((l) => l.id)).toEqual([first]);
    host.history.jumpTo(3);
    expect(doc.layers.map((l) => l.id)).toEqual([first, copy]);
  });

  it('refuses to delete the last layer', () => {
    const { doc, layers } = setup();
    expect(layers.remove(doc.layers[0].id)).toBe(false);
    expect(doc.layers).toHaveLength(1);
  });

  it('reorders and moves into groups, never into itself', () => {
    const { doc, layers } = setup();
    const base = doc.layers[0].id;
    const a = layers.add();
    const b = layers.add();
    expect(layers.step(b, -1)).toBe(true);
    expect(doc.layers.map((l) => l.id)).toEqual([base, b, a]);
    const grp = layers.group([a])!;
    expect(doc.layers.map((l) => l.id)).toEqual([base, b, grp]);
    expect(layers.move(b, grp, 0)).toBe(true);
    const group = doc.layerById(grp) as GroupLayer;
    expect(group.children.map((l) => l.id)).toEqual([b, a]);
    expect(layers.move(grp, grp, 0)).toBe(false);
    expect(ids(doc)).toEqual([base, grp, b, a]);
    layers.ungroup(grp);
    expect(doc.layers.map((l) => l.id)).toEqual([base, b, a]);
  });

  it('records property changes and merges slider drags into one step', () => {
    const { doc, host, layers } = setup();
    const id = doc.layers[0].id;
    layers.setProps(id, { opacity: 0.9 });
    layers.setProps(id, { opacity: 0.7 });
    layers.setProps(id, { opacity: 0.5 });
    expect(host.history.length).toBe(1);
    layers.setProps(id, { blend: 'screen' });
    expect(host.history.length).toBe(2);
    host.history.undo();
    expect(doc.layers[0].blend).toBe('normal');
    host.history.undo();
    expect(doc.layers[0].opacity).toBe(1);
    // No-op changes don't create steps.
    layers.setProps(id, { opacity: 1 });
    expect(host.history.length).toBe(2);
  });

  it('merges down with the upper layer blend mode and flattens', () => {
    const { doc, host, layers } = setup();
    const top = solidLayer(8, 8, [0, 0, 0, 255], 'multiply');
    top.opacity = 0.5;
    doc.layers.push(top);
    doc.activeId = top.id;
    expect(layers.canMergeDown()).toBe(true);
    layers.mergeDown();
    expect(doc.layers).toHaveLength(1);
    const merged = doc.layers[0] as RasterLayer;
    const p = merged.surface.getPixel(3, 3);
    expect(Math.abs(p.r - 128)).toBeLessThanOrEqual(1);
    host.history.undo();
    expect(doc.layers).toHaveLength(2);
    expect((doc.layers[0] as RasterLayer).surface.getPixel(3, 3).r).toBe(255);

    const hidden = solidLayer(8, 8, [255, 0, 0, 255]);
    hidden.visible = false;
    doc.layers.push(hidden);
    layers.flatten();
    expect(doc.layers).toHaveLength(1);
    expect(Math.abs((doc.layers[0] as RasterLayer).surface.getPixel(0, 0).r - 128)).toBeLessThanOrEqual(1);
    host.history.undo();
    expect(doc.layers).toHaveLength(3);
  });

  it('cannot merge onto a group or from a hidden layer', () => {
    const { doc, layers } = setup();
    const a = layers.add();
    layers.group([a]);
    const b = layers.add();
    expect(layers.canMergeDown(b)).toBe(false);
    layers.setProps(b, { visible: false });
    expect(layers.canMergeDown(doc.layers[0].id)).toBe(false);
  });
});
