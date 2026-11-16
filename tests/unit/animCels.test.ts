import { describe, expect, it } from 'vitest';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { LayerController, type LayerHost } from '@engine/doc/LayerController';
import { History } from '@engine/history/History';
import { applyDocState, captureDocState, PixelCommand, type CommandHost } from '@engine/history/commands';
import { Surface } from '@engine/raster/Surface';
import { compositeLayers } from '@engine/raster/blend';
import { frameExtras } from '@engine/anim/pieceRaster';
import { celAt, celEnd, celIndexAt, insertCel, moveCelStart, removeCelAt, type Cel } from '@engine/anim/cels';

const W = 8;
const H = 8;

function painted(r: number): Surface {
  const s = new Surface(W, H);
  s.fillRect({ x: 0, y: 0, w: W, h: H }, { r, g: 0, b: 0, a: 255 });
  return s;
}

/** A layer with drawings at frames 0, 3 and 6 (red 10, 30 and 60). */
function animatedLayer(): RasterLayer {
  const l = new RasterLayer('Ink', painted(10));
  l.cels = [
    { start: 0, surface: l.surface },
    { start: 3, surface: painted(30) },
    { start: 6, surface: painted(60) },
  ];
  return l;
}

const red = (s: Surface) => s.readRect({ x: 0, y: 0, w: 1, h: 1 })[0];

describe('cels', () => {
  const cels: Cel[] = animatedLayer().cels!;

  it('finds the drawing shown at a frame, and where it stops', () => {
    expect([0, 2, 3, 5, 6, 99].map((f) => celIndexAt(cels, f))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(red(celAt(cels, 4).surface)).toBe(30);
    expect(celEnd(cels, 0, 24)).toBe(2);
    expect(celEnd(cels, 2, 24)).toBe(23);
  });

  it('inserts a drawing at a frame, but not where one already starts', () => {
    const next = insertCel(cels, 4, painted(40))!;
    expect(next.map((c) => c.start)).toEqual([0, 3, 4, 6]);
    expect(insertCel(cels, 3, painted(1))).toBeNull();
    // The originals don't change.
    expect(cels.map((c) => c.start)).toEqual([0, 3, 6]);
  });

  it('removes a drawing (the one before shows on; the first gives way to the next)', () => {
    expect(removeCelAt(cels, 4)!.map((c) => c.start)).toEqual([0, 6]);
    const noFirst = removeCelAt(cels, 1)!;
    expect(noFirst.map((c) => c.start)).toEqual([0, 6]);
    expect(red(noFirst[0].surface)).toBe(30);
    expect(removeCelAt([cels[0]], 0)).toBeNull();
  });

  it('holds a drawing longer or shorter between its neighbours', () => {
    expect(moveCelStart(cels, 1, 5)!.map((c) => c.start)).toEqual([0, 5, 6]);
    expect(moveCelStart(cels, 1, 1)!.map((c) => c.start)).toEqual([0, 1, 6]);
    expect(moveCelStart(cels, 1, 0)).toBeNull();
    expect(moveCelStart(cels, 1, 6)).toBeNull();
    expect(moveCelStart(cels, 0, 2)).toBeNull();
    expect(moveCelStart(cels, 2, 40)!.map((c) => c.start)).toEqual([0, 3, 40]);
  });
});

describe('frame-by-frame layers', () => {
  it('show the drawing for the frame, and map every drawing (shared ones stay shared)', () => {
    const l = animatedLayer();
    l.showFrame(4);
    expect(red(l.surface)).toBe(30);
    l.cels![2] = { start: 6, surface: l.cels![1].surface };
    l.mapSurfaces((s) => {
      const out = new Surface(4, 4);
      out.fillRect({ x: 0, y: 0, w: 4, h: 4 }, { r: red(s) + 1, g: 0, b: 0, a: 255 });
      return out;
    });
    expect(l.surface.width).toBe(4);
    expect(red(l.surface)).toBe(31);
    expect(l.cels![1].surface).toBe(l.cels![2].surface);
    expect(l.cels!.map((c) => red(c.surface))).toEqual([11, 31, 31]);
    expect(l.allSurfaces()).toHaveLength(2);
  });

  it('export and sampling read each layer’s drawing for the frame asked for', () => {
    const l = animatedLayer();
    const doc = new PaintDocument({ width: W, height: H, paper: null }, [l]);
    doc.showFrame(0);
    const at = (frame: number) => {
      const data = new Uint8ClampedArray(W * H * 4);
      compositeLayers(doc.layers, { x: 0, y: 0, w: W, h: H }, { data, stride: W, ox: 0, oy: 0 }, undefined, frameExtras(doc, frame));
      return data[0];
    };
    expect([at(0), at(4), at(7)]).toEqual([10, 30, 60]);
    // The frame on screen didn't change.
    expect(red(l.surface)).toBe(10);
  });

  it('keep every drawing through a whole-picture change and its undo', () => {
    const l = animatedLayer();
    const doc = new PaintDocument({ width: W, height: H }, [l]);
    doc.showFrame(4);
    const before = captureDocState(doc);
    l.mapSurfaces(() => new Surface(2, 2));
    expect(l.cels!.every((c) => c.surface.width === 2)).toBe(true);
    applyDocState(doc, before);
    expect(l.cels!.map((c) => red(c.surface))).toEqual([10, 30, 60]);
    expect(red(l.surface)).toBe(30);
  });

  it('undoing a stroke on another frame goes to that frame first', () => {
    const l = animatedLayer();
    const doc = new PaintDocument({ width: W, height: H }, [l]);
    doc.showFrame(3);
    const frames: number[] = [];
    const host: CommandHost = {
      doc,
      layerChanged() {},
      structureChanged() {},
      layersChanged() {},
      setSelection() {},
      savedSelectionsChanged() {},
      guidesChanged() {},
      vectorChanged() {},
      showFrame(f) {
        frames.push(f);
        doc.timeline.frame = f;
        doc.showFrame(f);
      },
    };
    const s = l.surface;
    s.beginEdit();
    s.fillRect({ x: 0, y: 0, w: W, h: H }, { r: 200, g: 0, b: 0, a: 255 });
    const cmd = new PixelCommand('history.fill', host, l, s.endEdit()!, null, null, 3);
    // Elsewhere in the timeline, then undo: back at frame 3, its drawing restored.
    doc.timeline.frame = 7;
    doc.showFrame(7);
    cmd.undo();
    expect(frames).toEqual([3]);
    expect(red(l.cels![1].surface)).toBe(30);
    expect(red(l.cels![2].surface)).toBe(60);
  });
});

describe('layer operations with frame-by-frame layers', () => {
  function setup(layers: RasterLayer[]) {
    const doc = new PaintDocument({ width: W, height: H }, layers);
    const notices: string[] = [];
    const host: LayerHost = {
      doc,
      history: new History(),
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
    return { doc, ctl, notices };
  }

  it('duplicates every drawing (copies, not the same pixels)', () => {
    const l = animatedLayer();
    const { doc, ctl } = setup([l]);
    const copy = doc.layerById(ctl.duplicate(l.id)!) as RasterLayer;
    expect(copy.cels!.map((c) => c.start)).toEqual([0, 3, 6]);
    expect(copy.cels!.map((c) => red(c.surface))).toEqual([10, 30, 60]);
    expect(copy.cels![1].surface).not.toBe(l.cels![1].surface);
    expect(copy.surface).toBe(copy.cels![0].surface);
  });

  it('won’t merge or flatten them', () => {
    const below = new RasterLayer('Below', painted(5));
    const l = animatedLayer();
    const { ctl, notices } = setup([below, l]);
    expect(ctl.mergeDown(l.id)).toBe(false);
    expect(ctl.flatten()).toBe(false);
    expect(notices).toEqual(['notice.mergeCels', 'notice.flattenCels']);
  });
});
