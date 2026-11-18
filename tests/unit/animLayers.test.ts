import { describe, expect, it } from 'vitest';
import { GroupLayer, PaintDocument, RasterLayer } from '@engine/doc/Document';
import { LayerController, type LayerHost } from '@engine/doc/LayerController';
import { History } from '@engine/history/History';
import { Surface } from '@engine/raster/Surface';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';

function layer(name: string): RasterLayer {
  const s = new Surface(16, 16);
  s.fillRect({ x: 0, y: 0, w: 4, h: 4 }, { r: 255, g: 0, b: 0, a: 255 });
  return new RasterLayer(name, s);
}

function piece(layerId: string, id = 'p'): Piece {
  const p = makePiece(id, id, layerId, { w: 2, h: 2, data: new Uint8ClampedArray(16).fill(255) }, { x: 0, y: 0, w: 2, h: 2 }, 0);
  p.keyframes = setKey(p.keyframes, 5, { x: 10, opacity: 0.8 });
  return p;
}

function setup(layers: (RasterLayer | GroupLayer)[]) {
  const doc = new PaintDocument({ width: 16, height: 16 }, layers);
  const notices: string[] = [];
  const history = new History();
  const host: LayerHost = {
    doc,
    history,
    commitLive() {},
    notify: (_k, key) => notices.push(key),
    layerChanged() {},
    structureChanged() {},
    savedSelectionsChanged() {},
    guidesChanged() {},
    vectorChanged() {},
    layersChanged() {},
    setSelection() {},
  };
  const ctl = new LayerController(host);
  ctl.namer = (kind, arg) => `${kind} ${arg}`;
  return { doc, history, ctl, notices };
}

describe('layer operations keep pieces right', () => {
  it('deleting a layer takes its pieces; undo brings them back', () => {
    const a = layer('A');
    const b = layer('B');
    const { doc, history, ctl } = setup([a, b]);
    doc.pieces = [piece(a.id, 'pa'), piece(b.id, 'pb')];
    ctl.remove(b.id);
    expect(doc.pieces.map((p) => p.id)).toEqual(['pa']);
    history.undo();
    expect(doc.pieces.map((p) => p.id)).toEqual(['pa', 'pb']);
  });

  it('deleting a group takes the pieces of the layers inside it', () => {
    const a = layer('A');
    const inner = layer('In');
    const g = new GroupLayer('G', [inner]);
    const { doc, ctl } = setup([a, g]);
    doc.pieces = [piece(inner.id, 'pi'), piece(a.id, 'pa')];
    ctl.remove(g.id);
    expect(doc.pieces.map((p) => p.id)).toEqual(['pa']);
  });

  it('duplicating a layer (or group) copies its pieces onto the copy', () => {
    const inner = layer('In');
    const g = new GroupLayer('G', [inner]);
    const { doc, history, ctl } = setup([layer('A'), g]);
    doc.pieces = [piece(inner.id)];
    const copyId = ctl.duplicate(g.id)!;
    const copy = doc.layerById(copyId) as GroupLayer;
    expect(doc.pieces).toHaveLength(2);
    const [orig, dup] = doc.pieces;
    expect(dup.layerId).toBe(copy.children[0].id);
    expect(dup.id).not.toBe(orig.id);
    // Its own pixels (painting one mustn't change the other), sharing tiles until then.
    expect(dup.src).not.toBe(orig.src);
    expect(dup.src.tiles[0]).toBe(orig.src.tiles[0]);
    expect(dup.keyframes).toEqual(orig.keyframes);
    history.undo();
    expect(doc.pieces).toHaveLength(1);
  });

  it('merging down carries the upper layer’s pieces, faded by its opacity', () => {
    const lower = layer('Low');
    const upper = layer('Up');
    upper.opacity = 0.5;
    const { doc, history, ctl } = setup([lower, upper]);
    doc.pieces = [piece(upper.id)];
    expect(ctl.mergeDown(upper.id)).toBe(true);
    const merged = doc.layers[0];
    expect(doc.pieces[0].layerId).toBe(merged.id);
    expect(doc.pieces[0].keyframes.map((k) => k.opacity)).toEqual([0.5, 0.4]);
    history.undo();
    expect(doc.pieces[0].layerId).toBe(upper.id);
    expect(doc.pieces[0].keyframes.map((k) => k.opacity)).toEqual([1, 0.8]);
  });

  it('refuses to merge onto a layer with pieces, and to flatten visible pieces', () => {
    const lower = layer('Low');
    const upper = layer('Up');
    const { doc, ctl, notices } = setup([lower, upper]);
    doc.pieces = [piece(lower.id)];
    expect(ctl.mergeDown(upper.id)).toBe(false);
    expect(notices).toContain('notice.mergePiecesBelow');
    expect(ctl.flatten()).toBe(false);
    expect(notices).toContain('notice.flattenPieces');
    // With the layer hidden, flattening drops it and its pieces as usual.
    lower.visible = false;
    expect(ctl.flatten()).toBe(true);
    expect(doc.pieces).toHaveLength(0);
  });
});
