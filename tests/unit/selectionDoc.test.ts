import { describe, expect, it } from 'vitest';
import { PaintDocument } from '@engine/doc/Document';
import { Selection } from '@engine/doc/Selection';
import { transformSaved } from '@engine/doc/savedSelections';
import { History, type Command } from '@engine/history/History';
import { SelectionCommand, type CommandHost } from '@engine/history/commands';
import { loadProject, saveProject, type PngCodec } from '@engine/io/project';
import { flipH, placeImage, rotate90 } from '@engine/raster/transform';

/** Raw RGBA behind an 8-byte size header, standing in for PNG in Node. */
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

const at = (s: Selection | null, x: number, y: number) => {
  if (!s) return 0;
  const lx = x - s.bounds.x;
  const ly = y - s.bounds.y;
  return lx < 0 || ly < 0 || lx >= s.bounds.w || ly >= s.bounds.h ? 0 : s.mask[ly * s.bounds.w + lx];
};

describe('selection modes and modifiers', () => {
  const a = Selection.fromRect({ x: 0, y: 0, w: 20, h: 20 }, 100, 100)!;
  const b = Selection.fromRect({ x: 10, y: 10, w: 20, h: 20 }, 100, 100)!;

  it('adds, subtracts and intersects with traced outlines', () => {
    const add = a.combine(b, 'add')!;
    expect(add.area()).toBe(400 + 400 - 100);
    expect(add.kind).toBe('mask');
    // The union is one region: an 8-cornered outline.
    expect(add.outlines).toHaveLength(1);
    expect(add.outlines[0]).toHaveLength(8);

    const sub = a.combine(b, 'subtract')!;
    expect(sub.area()).toBe(300);
    expect(sub.contains(15, 15)).toBe(false);
    expect(sub.outlines[0]).toHaveLength(6);

    const both = a.combine(b, 'intersect')!;
    expect(both.isRect).toBe(true);
    expect(both.bounds).toEqual({ x: 10, y: 10, w: 10, h: 10 });
    expect(a.combine(null, 'intersect')).toBeNull();
    expect(a.combine(b, 'replace')).toBe(b);
  });

  it('subtracting a hole leaves an inner outline', () => {
    const hole = Selection.fromRect({ x: 5, y: 5, w: 5, h: 5 }, 100, 100)!;
    const ring = a.combine(hole, 'subtract')!;
    expect(ring.outlines).toHaveLength(2);
    expect(ring.contains(7, 7)).toBe(false);
    expect(ring.contains(2, 2)).toBe(true);
  });

  it('feathers, grows, shrinks and borders', () => {
    const big = Selection.fromRect({ x: 30, y: 30, w: 40, h: 40 }, 100, 100)!;
    const f = big.modified('feather', 6, 100, 100)!;
    expect(at(f, 50, 50)).toBe(255);
    expect(at(f, 30, 50)).toBeGreaterThan(60);
    expect(at(f, 30, 50)).toBeLessThan(200);
    expect(big.modified('grow', 5, 100, 100)!.bounds).toEqual({ x: 25, y: 25, w: 50, h: 50 });
    expect(big.modified('shrink', 5, 100, 100)!.bounds).toEqual({ x: 35, y: 35, w: 30, h: 30 });
    expect(big.modified('shrink', 25, 100, 100)).toBeNull();
    const border = big.modified('border', 4, 100, 100)!;
    expect(border.contains(50, 50)).toBe(false);
    expect(border.contains(30, 50)).toBe(true);
  });

  it('makes ellipse selections with a smooth outline inside the canvas', () => {
    const e = Selection.fromEllipse({ x: 10, y: 10, w: 40, h: 20 }, 100, 100)!;
    expect(e.contains(30, 20)).toBe(true);
    expect(e.contains(11, 11)).toBe(false);
    expect(e.outlines[0].length).toBeGreaterThan(24);
    // Clipped by the canvas: the outline is traced from the mask instead.
    const clipped = Selection.fromEllipse({ x: -20, y: 10, w: 40, h: 20 }, 100, 100)!;
    expect(clipped.bounds.x).toBe(0);
    expect(Math.min(...clipped.outlines.flat().map((p) => p.x))).toBe(0);
  });
});

describe('selection history', () => {
  const host = (): CommandHost & { sel: Selection | null } => ({
    doc: new PaintDocument({ width: 10, height: 10 }),
    sel: null,
    layerChanged() {},
    structureChanged() {},
    layersChanged() {},
    savedSelectionsChanged() {},
    guidesChanged() {},
    setSelection(s) {
      this.sel = s;
    },
  });
  const edit = (): Command => ({ label: 'history.fill', bytes: 1, undo() {}, redo() {} });

  it('undoes selection changes without making the document unsaved', () => {
    const h = new History();
    const hs = host();
    const s1 = Selection.fromRect({ x: 0, y: 0, w: 4, h: 4 }, 10, 10);
    h.push(new SelectionCommand('history.selectRect', hs, null, s1));
    expect(h.isDirty).toBe(false);
    h.undo();
    expect(hs.sel).toBeNull();
    h.redo();
    expect(hs.sel).toBe(s1);

    h.push(edit());
    expect(h.isDirty).toBe(true);
    h.markSaved();
    h.push(new SelectionCommand('history.deselect', hs, s1, null));
    expect(h.isDirty).toBe(false);
    // Undoing past the save point through a pixel edit makes it unsaved again.
    h.undo();
    h.undo();
    expect(h.isDirty).toBe(true);
  });
});

describe('saved selections', () => {
  const docWith = () => {
    const doc = new PaintDocument({ width: 40, height: 30 });
    const soft = Selection.fromRect({ x: 2, y: 3, w: 10, h: 5 }, 40, 30)!.modified('feather', 2, 40, 30)!;
    doc.savedSelections = [
      { id: 'sel-a', name: 'Sky', selection: Selection.fromRect({ x: 5, y: 5, w: 10, h: 10 }, 40, 30)! },
      { id: 'sel-b', name: 'Soft', selection: soft },
    ];
    return doc;
  };

  it('round-trip through .pigm with names and soft coverage', async () => {
    const doc = docWith();
    const back = await loadProject(await saveProject(doc, rawCodec), rawCodec);
    expect(back.savedSelections.map((s) => [s.id, s.name])).toEqual([
      ['sel-a', 'Sky'],
      ['sel-b', 'Soft'],
    ]);
    expect(back.savedSelections[0].selection.bounds).toEqual({ x: 5, y: 5, w: 10, h: 10 });
    const before = doc.savedSelections[1].selection;
    const after = back.savedSelections[1].selection;
    expect(after.bounds).toEqual(before.bounds);
    expect([...after.mask]).toEqual([...before.mask]);
  });

  it('older projects without selections still open', async () => {
    const back = await loadProject(await saveProject(new PaintDocument({ width: 8, height: 8 }), rawCodec), rawCodec);
    expect(back.savedSelections).toEqual([]);
  });

  it('follow flips, quarter turns and canvas changes of the image', () => {
    const list = docWith().savedSelections;
    const flipped = transformSaved(list, 40, 30, flipH);
    expect(flipped[0].selection.bounds).toEqual({ x: 25, y: 5, w: 10, h: 10 });
    const turned = transformSaved(list, 40, 30, (img) => rotate90(img, 1));
    // 90° clockwise: x' = H - 1 - y, y' = x on a 30×40 canvas.
    expect(turned[0].selection.bounds).toEqual({ x: 15, y: 5, w: 10, h: 10 });
    const cropped = transformSaved(list, 40, 30, (img) => placeImage(img, 8, 8, -10, -10));
    expect(cropped[0].selection.bounds).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    // Cropped away completely: dropped.
    expect(transformSaved(list, 40, 30, (img) => placeImage(img, 3, 3, -30, -25))).toHaveLength(0);
  });
});
