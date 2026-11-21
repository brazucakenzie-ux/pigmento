import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { makePiece, setKey } from '@engine/anim/piece';
import { applyPreset, makeTrail } from '@engine/anim/trail';
import { loadProject, PROJECT_VERSION, saveProject, versionFor, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import type { VectorShape } from '@engine/vector/model';
import { corner } from '@engine/vector/pathData';

/**
 * Version 4 (1.3.0) round trip: everything 1.3 adds to a picture, saved and opened again. Grows
 * with Stops 7C and 7D.
 */

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

const style: ShapeStyle = { mode: 'outline', width: 3, outline: { r: 0, g: 0, b: 0, a: 255 }, fill: { r: 255, g: 255, b: 255, a: 255 }, radius: 0, antialias: true, dash: 'dot' };
const img = { w: 8, h: 4, data: new Uint8ClampedArray(8 * 4 * 4).fill(200) };

/** A picture using everything version 4 holds. */
function picture(): PaintDocument {
  const doc = new PaintDocument({ width: 400, height: 300 });
  const route: VectorShape = { type: 'shape', id: 'route', shape: 'path', box: null, points: [], style, subpaths: [{ closed: false, anchors: [corner(10, 10), corner(390, 10), corner(390, 290)] }], trimTie: { piece: 'rocket', end: 'start', gap: 12.5 } };
  const set: VectorShape = { type: 'shape', id: 'set', shape: 'ellipse', box: { cx: 200, cy: 150, w: 100, h: 60, angle: 0.3 }, points: [], style, trim: { start: 0.1, end: 0.6, offset: -2.25 } };
  const keyed: VectorShape = {
    type: 'shape',
    id: 'keyed',
    shape: 'line',
    box: null,
    points: [
      { x: 0, y: 200 },
      { x: 300, y: 200 },
    ],
    style: { ...style, arrowEnd: 'triangle' },
    trimKeys: [
      { frame: 2, start: 0, end: 0, offset: 0, easing: 'easeOut' },
      { frame: 20, start: 0, end: 1, offset: 0.5, easing: 'linear' },
    ],
  };
  const shapes = new VectorLayer('Route', 400, 300, [route, { type: 'group', id: 'g', children: [set, keyed] }]);
  doc.layers.push(shapes);
  const p = makePiece('rocket', 'Rocket', doc.layers[0].id, img, { x: 0, y: 0, w: 8, h: 4 }, 0);
  p.keyframes = setKey(setKey(p.keyframes, 0, { progress: 0, easing: 'easeInOut' }), 23, { progress: 1 });
  p.follow = { layerId: shapes.id, objectId: 'route', sub: 0 };
  p.face = { on: true, angle: -Math.PI / 2 };
  // Smoke that lights at frame 4, and an echo.
  p.trails = [
    { ...applyPreset(makeTrail('smoke', 'puffs', { x: 0, y: 2 }, 12345), 'rocketSmoke'), keys: [{ frame: 0, amount: 0, easing: 'hold' }, { frame: 4, amount: 1, easing: 'linear' }] },
    applyPreset(makeTrail('ghost', 'echo', { x: 4, y: 2 }, 7), 'echo'),
  ];
  doc.pieces = [p];
  return doc;
}

async function reopen(doc: PaintDocument): Promise<{ doc: PaintDocument; json: Record<string, unknown> }> {
  const bytes = await saveProject(doc, codec);
  const json = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as Record<string, unknown>;
  return { doc: await loadProject(bytes, codec), json };
}

/** Save, change document.json, and pack it again. */
async function edited(doc: PaintDocument, change: (json: { layers: { kind: string; objects?: Record<string, unknown>[] }[]; animation?: { length: number } }) => void): Promise<Uint8Array> {
  const files = unzipSync(await saveProject(doc, codec));
  const json = JSON.parse(strFromU8(files['document.json'])) as Parameters<typeof change>[0];
  change(json);
  files['document.json'] = strToU8(JSON.stringify(json));
  return zipSync(files);
}

const shapesOf = (doc: PaintDocument) => {
  const l = doc.vectorLayers()[0];
  return l.objects;
};

describe('projects, version 4', () => {
  it('keep paths followed, facing, progress, and trims set, keyed and tied', async () => {
    const doc = picture();
    expect(PROJECT_VERSION).toBe(4);
    expect(versionFor(doc)).toBe(4);
    const { doc: back, json } = await reopen(doc);
    expect(json.version).toBe(4);
    const p = back.pieces[0];
    expect(p.follow).toEqual({ layerId: doc.vectorLayers()[0].id, objectId: 'route', sub: 0 });
    expect(p.face).toEqual({ on: true, angle: -Math.PI / 2 });
    expect(p.trails).toEqual(doc.pieces[0].trails);
    expect(p.keyframes.map((k) => [k.frame, k.progress, k.easing])).toEqual([
      [0, 0, 'easeInOut'],
      [23, 1, 'easeInOut'],
    ]);
    expect(shapesOf(back)).toEqual(shapesOf(doc));
    // The shape layer still changes from frame to frame (keyed and tied).
    expect(back.vectorLayers()[0].keyed).toBe(true);
    expect(back.vectorLayers()[0].tied).toBe(true);
  });

  it('keep the timeline of a picture whose only animation is a keyed trim', async () => {
    const doc = new PaintDocument({ width: 100, height: 100 });
    doc.timeline.length = 48;
    doc.timeline.fps = 24;
    doc.layers.push(new VectorLayer('S', 100, 100, [{ type: 'shape', id: 'a', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }], style, trimKeys: [{ frame: 40, start: 0, end: 0.5, offset: 0, easing: 'linear' }] }]));
    const { doc: back } = await reopen(doc);
    expect(back.timeline).toMatchObject({ length: 48, fps: 24 });
    expect(back.hasTrimKeys).toBe(true);
  });

  it('are only written when the picture uses something new', async () => {
    const doc = picture();
    doc.pieces = [];
    doc.vectorLayers()[0].setObjects([{ type: 'shape', id: 'plain', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], style }]);
    expect(versionFor(doc)).toBe(1);
    const { json } = await reopen(doc);
    expect(json.version).toBe(1);
  });

  it('fit trim keys into the timeline (one a frame, the last one given wins)', async () => {
    const bytes = await edited(picture(), (json) => {
      const shapes = json.layers.find((l) => l.kind === 'vector')!.objects!;
      const g = shapes[1] as { children: Record<string, unknown>[] };
      g.children[1].trimKeys = [
        { frame: 500, start: 0, end: 1, offset: 0, easing: 'linear' },
        { frame: 3, start: 0, end: 0.2, offset: 0, easing: 'hold' },
        { frame: 23, start: 0, end: 0.7, offset: 0, easing: 'linear' },
      ];
    });
    const back = await loadProject(bytes, codec);
    const keyed = (shapesOf(back)[1] as { children: readonly VectorShape[] }).children[1];
    expect(keyed.trimKeys!.map((k) => [k.frame, k.end])).toEqual([
      [3, 0.2],
      [23, 0.7],
    ]);
  });

  it('refuse trails out of range, and fit their keys into the timeline', async () => {
    const withTrail = async (change: (t: Record<string, unknown>) => void) => {
      const files = unzipSync(await saveProject(picture(), codec));
      const json = JSON.parse(strFromU8(files['document.json'])) as { animation: { pieces: { trails: Record<string, unknown>[] }[] } };
      change(json.animation.pieces[0].trails[0]);
      files['document.json'] = strToU8(JSON.stringify(json));
      return loadProject(zipSync(files), codec);
    };
    for (const bad of [
      (t: Record<string, unknown>) => (t.rate = 1e9),
      (t: Record<string, unknown>) => (t.kind = 'smoke'),
      (t: Record<string, unknown>) => (t.colors = [{ pos: 0, color: '#ffffffff' }]),
      (t: Record<string, unknown>) => (t.lifetime = 0),
      (t: Record<string, unknown>) => (t.seed = -1),
      (t: Record<string, unknown>) => (t.keys = [{ frame: 0, amount: 2, easing: 'linear' }]),
    ]) {
      await expect(withTrail(bad)).rejects.toMatchObject({ key: 'error.projectInvalid' });
    }
    // Keys past the end of the timeline move to its last frame.
    const back = await withTrail((t) => (t.keys = [{ frame: 1500, amount: 1, easing: 'linear' }, { frame: 3, amount: 0, easing: 'hold' }]));
    expect(back.pieces[0].trails[0].keys).toEqual([
      { frame: 3, amount: 0, easing: 'hold' },
      { frame: 23, amount: 1, easing: 'linear' },
    ]);
  });

  it('refuse numbers out of range', async () => {
    const bad = async (change: (s: Record<string, unknown>) => void) =>
      loadProject(
        await edited(picture(), (json) => {
          change(json.layers.find((l) => l.kind === 'vector')!.objects![0]);
        }),
        codec,
      );
    await expect(bad((s) => (s.trim = { start: 2, end: 1, offset: 0 }))).rejects.toMatchObject({ key: 'error.projectInvalid' });
    await expect(bad((s) => (s.trim = { start: 0, end: 1, offset: 1e7 }))).rejects.toMatchObject({ key: 'error.projectInvalid' });
    await expect(bad((s) => (s.trimTie = { piece: 'rocket', end: 'middle', gap: 0 }))).rejects.toMatchObject({ key: 'error.projectInvalid' });
    await expect(bad((s) => (s.trimTie = { piece: 'rocket', end: 'start', gap: 1e9 }))).rejects.toMatchObject({ key: 'error.projectInvalid' });
    await expect(bad((s) => (s.trimKeys = []))).rejects.toMatchObject({ key: 'error.projectInvalid' });
    await expect(bad((s) => (s.trimKeys = [{ frame: 0, start: 0, end: 1, offset: 0, easing: 'wobbly' }]))).rejects.toMatchObject({ key: 'error.projectInvalid' });
  });
});
