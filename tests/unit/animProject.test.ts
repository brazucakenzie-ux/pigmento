import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { loadProject, PROJECT_VERSION, saveProject, type PngCodec } from '@engine/io/project';
import { Surface } from '@engine/raster/Surface';
import { makePiece, setKey } from '@engine/anim/piece';

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

function animatedDoc(): PaintDocument {
  const layer = new RasterLayer('Stage', new Surface(120, 80));
  const doc = new PaintDocument({ width: 120, height: 80 }, [layer]);
  const src = { w: 4, h: 3, data: new Uint8ClampedArray(48).map((_, i) => (i * 7) % 256) };
  const p = makePiece('piece-a', 'Ball', layer.id, src, { x: 10, y: 20, w: 4, h: 3 }, 0);
  p.pivot = { x: 0, y: 1.5 };
  p.keyframes = setKey(p.keyframes, 12, { x: 90, angle: 3 * Math.PI, sx: 2, opacity: 0.25, easing: 'easeOut', in: { x: -10, y: 20 } });
  p.keyframes = setKey(p.keyframes, 0, { easing: 'hold', out: { x: 5, y: -5 } });
  doc.pieces = [p];
  doc.timeline = { fps: 24, length: 30, loop: 'pingpong', frame: 7 };
  return doc;
}

async function rewrite(bytes: Uint8Array, edit: (json: Record<string, unknown>) => void): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const json = JSON.parse(strFromU8(files['document.json'])) as Record<string, unknown>;
  edit(json);
  files['document.json'] = strToU8(JSON.stringify(json));
  return zipSync(files);
}

describe('projects with animation (version 2)', () => {
  it('keeps the timeline and every piece’s pixels, pivot and keyframes', async () => {
    const doc = animatedDoc();
    const bytes = await saveProject(doc, rawCodec);
    const json = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { version: number };
    expect(json.version).toBe(PROJECT_VERSION);
    const back = await loadProject(bytes, rawCodec);
    expect(back.timeline).toEqual({ fps: 24, length: 30, loop: 'pingpong', frame: 7 });
    expect(back.pieces).toHaveLength(1);
    const [p] = back.pieces;
    const [q] = doc.pieces;
    expect(p).toMatchObject({ id: q.id, name: 'Ball', layerId: back.layers[0].id, pivot: { x: 0, y: 1.5 }, home: q.home });
    expect(p.keyframes).toEqual(q.keyframes);
    expect(Array.from(p.src.data)).toEqual(Array.from(q.src.data));
  });

  it('writes a picture without animation as version 1, which Pigmento 1.0 opens', async () => {
    const doc = new PaintDocument({ width: 10, height: 10 });
    const json = JSON.parse(strFromU8(unzipSync(await saveProject(doc, rawCodec))['document.json'])) as Record<string, unknown>;
    expect(json.version).toBe(1);
    expect(json.animation).toBeUndefined();
  });

  it('opens version 1 files with a default timeline and no pieces', async () => {
    const v1 = await rewrite(await saveProject(new PaintDocument({ width: 10, height: 10 }), rawCodec), (j) => (j.version = 1));
    const doc = await loadProject(v1, rawCodec);
    expect(doc.pieces).toEqual([]);
    expect(doc.timeline).toMatchObject({ fps: 12, length: 24, loop: 'loop' });
  });

  it('leaves out pieces of missing layers, merges repeated frames and keeps frames inside the timeline', async () => {
    const bytes = await rewrite(await saveProject(animatedDoc(), rawCodec), (j) => {
      const a = j.animation as { length: number; pieces: { layerId: string; id: string; keyframes: { frame: number; x: number }[] }[] };
      const piece = a.pieces[0];
      a.pieces.push({ ...piece, layerId: 'no-such-layer' });
      a.pieces.push({ ...piece });
      piece.keyframes.push({ ...piece.keyframes[0], frame: 0, x: 77 });
      piece.keyframes[1].frame = 500;
      a.length = 30;
    });
    const doc = await loadProject(bytes, rawCodec);
    // The copy on a missing layer is gone; the repeated id gets a new one.
    expect(doc.pieces).toHaveLength(2);
    expect(doc.pieces[0].id).not.toBe(doc.pieces[1].id);
    const keys = doc.pieces[0].keyframes;
    expect(keys.map((k) => k.frame)).toEqual([0, 29]);
    expect(keys[0].x).toBe(77);
  });

  it('refuses animation data that breaks the rules', async () => {
    const base = await saveProject(animatedDoc(), rawCodec);
    for (const edit of [
      (a: { fps: number; pieces: { keyframes: { opacity: number; easing: string }[]; image: { file: string } }[] }) => (a.fps = 500),
      (a: { pieces: { keyframes: { opacity: number }[] }[] }) => (a.pieces[0].keyframes[0].opacity = 3),
      (a: { pieces: { keyframes: { easing: string }[] }[] }) => (a.pieces[0].keyframes[0].easing = 'bounce'),
      (a: { pieces: { image: { file: string } }[] }) => (a.pieces[0].image.file = '../evil.png'),
      (a: { pieces: { keyframes: unknown[] }[] }) => (a.pieces[0].keyframes = []),
    ]) {
      const bytes = await rewrite(base, (j) => edit(j.animation as never));
      await expect(loadProject(bytes, rawCodec)).rejects.toMatchObject({ key: 'error.projectInvalid' });
    }
  });
});

describe('projects with frame-by-frame drawings', () => {
  function celDoc(): PaintDocument {
    const fill = (r: number) => {
      const s = new Surface(120, 80);
      if (r) s.fillRect({ x: 10, y: 10, w: 20, h: 20 }, { r, g: 0, b: 0, a: 255 });
      return s;
    };
    const layer = new RasterLayer('Ink', fill(10));
    layer.cels = [
      { start: 0, surface: layer.surface },
      { start: 4, surface: fill(0) },
      { start: 9, surface: fill(90) },
    ];
    const doc = new PaintDocument({ width: 120, height: 80 }, [layer]);
    doc.timeline = { fps: 8, length: 16, loop: 'loop', frame: 10 };
    doc.showFrame(10);
    return doc;
  }

  it('keeps every drawing and where it starts, and shows the saved frame’s drawing', async () => {
    const bytes = await saveProject(celDoc(), rawCodec);
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['document.json'])) as { version: number; layers: { cels: { start: number; image: unknown }[] }[] };
    expect(json.version).toBe(PROJECT_VERSION);
    // The blank drawing stores no picture.
    expect(json.layers[0].cels.map((c) => [c.start, c.image === null])).toEqual([
      [0, false],
      [4, true],
      [9, false],
    ]);
    expect(Object.keys(files).filter((n) => n.startsWith('cels/'))).toHaveLength(2);
    const back = await loadProject(bytes, rawCodec);
    const l = back.layers[0] as RasterLayer;
    expect(l.cels!.map((c) => c.start)).toEqual([0, 4, 9]);
    expect(l.cels!.map((c) => c.surface.readRect({ x: 15, y: 15, w: 1, h: 1 })[0])).toEqual([10, 0, 90]);
    expect(l.cels![1].surface.contentBounds()).toBeNull();
    // Saved at frame 11: that's the third drawing.
    expect(l.surface).toBe(l.cels![2].surface);
  });

  it('tidies up drawings that start on the same frame or not at 0, and refuses a lone one', async () => {
    const base = await saveProject(celDoc(), rawCodec);
    const tidy = await rewrite(base, (j) => {
      const cels = (j.layers as { cels: { start: number }[] }[])[0].cels;
      cels[0].start = 2;
      cels[2].start = 4;
    });
    const l = (await loadProject(tidy, rawCodec)).layers[0] as RasterLayer;
    expect(l.cels!.map((c) => c.start)).toEqual([0, 4]);
    const lone = await rewrite(base, (j) => {
      const layer = (j.layers as { cels: unknown[] }[])[0];
      layer.cels = layer.cels.slice(0, 1);
    });
    await expect(loadProject(lone, rawCodec)).rejects.toMatchObject({ key: 'error.projectInvalid' });
  });
});
