import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PaintDocument } from '@engine/doc/Document';
import { makePiece } from '@engine/anim/piece';
import { Surface } from '@engine/raster/Surface';
import { loadProject, PROJECT_VERSION, saveProject, versionFor, type PngCodec } from '@engine/io/project';

/** Version 5: pieces drawn frame by frame, saved and opened again. */

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

const RED = { r: 220, g: 30, b: 30, a: 255 };
const BLUE = { r: 30, g: 60, b: 220, a: 255 };

/** A red 8 × 6 square drawn twice: plain, then with a blue line across; plain again at frame 6, cycling. */
function picture(): PaintDocument {
  const doc = new PaintDocument({ width: 100, height: 80 });
  doc.timeline.length = 24;
  const plain = new Surface(8, 6);
  plain.fillRect({ x: 0, y: 0, w: 8, h: 6 }, RED);
  const lined = plain.clone();
  lined.fillRect({ x: 0, y: 2, w: 8, h: 2 }, BLUE);
  const p = makePiece('sq', 'Square', doc.layers[0].id, plain, { x: 10, y: 10, w: 8, h: 6 }, 0);
  p.drawings = [
    { start: 0, surface: plain },
    { start: 3, surface: lined },
    { start: 6, surface: plain },
  ];
  p.drawingLoop = { mode: 'cycle', end: 9 };
  doc.pieces = [p];
  return doc;
}

async function reopen(doc: PaintDocument): Promise<{ doc: PaintDocument; json: { version: number; animation: { pieces: Record<string, unknown>[] } }; files: string[] }> {
  const bytes = await saveProject(doc, codec);
  const zip = unzipSync(bytes);
  const json = JSON.parse(strFromU8(zip['document.json'])) as { version: number; animation: { pieces: Record<string, unknown>[] } };
  return { doc: await loadProject(bytes, codec), json, files: Object.keys(zip).filter((f) => f.startsWith('pieces/')).sort() };
}

/** Save, change the first piece in document.json, and open it again. */
async function edited(change: (p: Record<string, unknown>) => void, drop?: string): Promise<PaintDocument> {
  const files = unzipSync(await saveProject(picture(), codec));
  const json = JSON.parse(strFromU8(files['document.json'])) as { animation: { pieces: Record<string, unknown>[] } };
  change(json.animation.pieces[0]);
  files['document.json'] = strToU8(JSON.stringify(json));
  if (drop) delete files[drop];
  return loadProject(zipSync(files), codec);
}

describe('projects, version 5', () => {
  it('keep a piece’s drawings, their pixels and their loop, writing each drawing once', async () => {
    const doc = picture();
    expect(PROJECT_VERSION).toBe(5);
    expect(versionFor(doc)).toBe(5);
    const { doc: back, json, files } = await reopen(doc);
    expect(json.version).toBe(5);
    // The first drawing is the piece's picture; the lined one a file of its own; the repeat isn't written again.
    expect(files).toEqual(['pieces/0001-2.png', 'pieces/0001.png']);
    expect(json.animation.pieces[0].drawings).toEqual([
      { start: 0, file: 'pieces/0001.png' },
      { start: 3, file: 'pieces/0001-2.png' },
      { start: 6, file: 'pieces/0001.png' },
    ]);
    const p = back.pieces[0];
    expect(p.drawings!.map((c) => c.start)).toEqual([0, 3, 6]);
    expect(p.drawings![2].surface).toBe(p.drawings![0].surface);
    expect(p.drawings![0].surface.getPixel(4, 3)).toEqual(RED);
    expect(p.drawings![1].surface.getPixel(4, 3)).toEqual(BLUE);
    expect(p.drawings![1].surface.getPixel(4, 0)).toEqual(RED);
    expect(p.drawingLoop).toEqual({ mode: 'cycle', end: 9 });
    // The drawing on show is the one for the frame the picture was saved at.
    expect(p.src).toBe(p.drawings![0].surface);
  });

  it('are only written when a piece has drawings', async () => {
    const doc = picture();
    doc.pieces[0].drawings = null;
    doc.pieces[0].drawingLoop = null;
    expect(versionFor(doc)).toBeLessThan(5);
    const { json } = await reopen(doc);
    expect(json.version).toBeLessThan(5);
    expect(json.animation.pieces[0].drawings).toBeUndefined();
  });

  it('refuse drawings that are missing, the wrong size or out of range', async () => {
    const bad = [
      edited(() => undefined, 'pieces/0001-2.png'),
      edited((p) => (p.drawings = [{ start: 0, file: 'pieces/0001.png' }, { start: -1, file: 'pieces/0001-2.png' }])),
      edited((p) => (p.drawings = [{ start: 0, file: 'pieces/0001.png' }, { start: 2, file: 'layers/0001.png' }])),
      edited((p) => (p.drawings = [{ start: 0, file: 'pieces/0001.png' }])),
      edited((p) => (p.drawingLoop = { mode: 'wobble', end: 4 })),
      edited((p) => (p.drawingLoop = { mode: 'cycle', end: 0 })),
    ];
    for (const b of bad) await expect(b).rejects.toMatchObject({ key: 'error.projectInvalid' });
    // A drawing of another size.
    const files = unzipSync(await saveProject(picture(), codec));
    files['pieces/0001-2.png'] = new Uint8Array(await codec.encode(new Uint8ClampedArray(4 * 4 * 4), 4, 4));
    await expect(loadProject(zipSync(files), codec)).rejects.toMatchObject({ key: 'error.projectInvalid' });
  });

  it('tidy drawings: one a start (the last given wins), the first from frame 0, a loop ending after the last', async () => {
    const back = await edited((p) => {
      p.drawings = [
        { start: 2, file: 'pieces/0001.png' },
        { start: 5, file: 'pieces/0001.png' },
        { start: 5, file: 'pieces/0001-2.png' },
      ];
      p.drawingLoop = { mode: 'pingpong', end: 3 };
    });
    const p = back.pieces[0];
    expect(p.drawings!.map((c) => c.start)).toEqual([0, 5]);
    expect(p.drawings![1].surface.getPixel(4, 3)).toEqual(BLUE);
    expect(p.drawingLoop).toEqual({ mode: 'pingpong', end: 6 });
    // Two starts the same leave one drawing: a still piece.
    const still = await edited((p) => {
      p.drawings = [
        { start: 0, file: 'pieces/0001.png' },
        { start: 0, file: 'pieces/0001-2.png' },
      ];
    });
    expect(still.pieces[0].drawings).toBeNull();
    expect(still.pieces[0].drawingLoop).toBeNull();
    expect(still.pieces[0].src.getPixel(4, 3)).toEqual(BLUE);
  });
});
