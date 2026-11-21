import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PaintDocument, type RasterLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { celRepeats, celShownIndex, defaultLoopEnd, loopedFrame, type CelLoop } from '@engine/anim/cels';
import { frameExtras } from '@engine/anim/pieceRaster';
import { loadProject, saveProject, versionFor, type PngCodec } from '@engine/io/project';

const starts = (...s: number[]) => s.map((start) => ({ start }));
const shown = (cels: { start: number }[], loop: CelLoop | null, n: number) => Array.from({ length: n }, (_, f) => celShownIndex(cels, loop, f));

describe('looping drawings', () => {
  it('cycle: the first cycle again and again', () => {
    const cels = starts(0, 3);
    const loop: CelLoop = { mode: 'cycle', end: 6 };
    expect(shown(cels, loop, 14)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0]);
    expect(loopedFrame(cels, loop, 7)).toBe(1);
    // Without a loop, the last drawing holds.
    expect(shown(cels, null, 8)).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
  });

  it('back and forth: A B C B A B C…, the ends not doubled, each drawing as long as it is', () => {
    const cels = starts(0, 2, 3);
    const loop: CelLoop = { mode: 'pingpong', end: 5 };
    // Holds: A 2, B 1, C 2; then back through B (1), and round again.
    expect(shown(cels, loop, 14)).toEqual([0, 0, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1, 0, 0]);
    // With two drawings it's a cycle.
    expect(shown(starts(0, 2), { mode: 'pingpong', end: 4 }, 8)).toEqual(shown(starts(0, 2), { mode: 'cycle', end: 4 }, 8));
  });

  it('show their repeats as blocks after the cycle, and start with the last drawing as long as the one before', () => {
    expect(defaultLoopEnd(starts(0, 3))).toBe(6);
    expect(defaultLoopEnd(starts(0, 2, 7))).toBe(12);
    expect(celRepeats(starts(0, 3), { mode: 'cycle', end: 6 }, 14)).toEqual([
      { index: 0, from: 6, to: 8 },
      { index: 1, from: 9, to: 11 },
      { index: 0, from: 12, to: 13 },
    ]);
    expect(celRepeats(starts(0, 3), null, 14)).toEqual([]);
  });
});

describe('looping a layer', () => {
  let doc: PaintDocument;
  let history: History;
  let notices: string[];
  let anim: AnimationController;
  let layer: RasterLayer;

  beforeEach(() => {
    doc = new PaintDocument({ width: 20, height: 20 });
    history = new History();
    notices = [];
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: (_kind, key) => notices.push(key),
      animationChanged: () => undefined,
    };
    anim = new AnimationController(host);
    layer = doc.rasterLayers()[0];
    // Drawing A at frame 0, B at frame 3.
    layer.surface.fillRect({ x: 0, y: 0, w: 20, h: 20 }, { r: 255, g: 0, b: 0, a: 255 });
    anim.setFrame(3);
    anim.newDrawing(layer.id, false);
    layer.surface.fillRect({ x: 0, y: 0, w: 20, h: 20 }, { r: 0, g: 0, b: 255, a: 255 });
  });

  it('needs two drawings, and is one undo step', () => {
    const still = doc.layers.length;
    expect(still).toBe(1);
    const steps = history.length;
    expect(anim.setDrawingLoop(layer.id, 'cycle')).toBe(true);
    expect(history.length).toBe(steps + 1);
    expect(layer.celLoop).toEqual({ mode: 'cycle', end: 6 });
    expect(anim.info().celLoops).toEqual({ [layer.id]: { mode: 'cycle', end: 6 } });
    // Painting on a repeat paints that drawing: frame 7 shows drawing A itself.
    anim.setFrame(7);
    expect(layer.surface).toBe(layer.cels![0].surface);
    expect(layer.surface.getPixel(5, 5)).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    history.undo();
    expect(layer.celLoop).toBeNull();
    expect(layer.surface).toBe(layer.cels![1].surface);
  });

  it('keeps new drawings to the first cycle, and edits the drawing a repeat shows', () => {
    anim.setDrawingLoop(layer.id, 'cycle');
    anim.setFrame(8);
    expect(anim.newDrawing(layer.id, false)).toBe(false);
    expect(notices).toContain('notice.drawingInRepeat');
    // Frame 10 repeats drawing B: clearing there clears B.
    anim.setFrame(10);
    expect(anim.clearDrawing(layer.id)).toBe(true);
    expect(layer.cels![1].surface.getPixel(5, 5).a).toBe(0);
    expect(layer.cels![0].surface.getPixel(5, 5).a).toBe(255);
  });

  it('has an end that stays after the last drawing, and stops looping at one drawing', () => {
    anim.setDrawingLoop(layer.id, 'pingpong');
    expect(anim.setLoopEnd(layer.id, 9)).toBe(true);
    expect(layer.celLoop!.end).toBe(9);
    expect(anim.setLoopEnd(layer.id, 1)).toBe(true);
    expect(layer.celLoop!.end).toBe(4);
    // The last drawing can't start at or after the end.
    expect(anim.moveDrawing(layer.id, 1, 5)).toBe(false);
    anim.setFrame(3);
    expect(anim.deleteDrawing(layer.id)).toBe(true);
    expect(layer.cels).toBeNull();
    expect(layer.celLoop).toBeNull();
    expect(anim.setDrawingLoop(layer.id, 'cycle')).toBe(false);
    expect(notices).toContain('notice.loopNeedsDrawings');
  });

  it('is what the picture shows at a frame (flattening, exports), and is saved', async () => {
    anim.setDrawingLoop(layer.id, 'cycle');
    const extras = frameExtras(doc, 10)!;
    expect(extras.surfaceOf!(layer)).toBe(layer.cels![1].surface);
    expect(frameExtras(doc, 12)!.surfaceOf!(layer)).toBe(layer.cels![0].surface);
    expect(versionFor(doc)).toBe(4);
    const codec: PngCodec = {
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
    const bytes = await saveProject(doc, codec);
    expect((JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { version: number }).version).toBe(4);
    const back = await loadProject(bytes, codec);
    expect(back.rasterLayers()[0].celLoop).toEqual({ mode: 'cycle', end: 6 });
    anim.setDrawingLoop(layer.id, null);
    expect(versionFor(doc)).toBe(2);
  });
});
