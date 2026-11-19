import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { PaintDocument, RasterLayer } from '@engine/doc/Document';
import { History } from '@engine/history/History';
import { AnimationController, type AnimHost } from '@engine/anim/AnimationController';
import { cameraMoveAt, moveCameraKey, removeCameraKey, setCameraKey, type CameraKey } from '@engine/anim/cameraMove';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';
import { frameExtras } from '@engine/anim/pieceRaster';
import { transformCameraKeys } from '@engine/anim/pieceTransform';
import { Scene } from '@engine/anim/scene';
import { placementOf, project, spaceOf } from '@engine/anim/space';
import { identityState } from '@engine/anim/interpolate';
import { loadProject, saveProject, versionFor, type PngCodec } from '@engine/io/project';
import { Surface } from '@engine/raster/Surface';

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

const img = (w: number, h: number) => ({ w, h, data: new Uint8ClampedArray(w * h * 4).fill(255) });

describe('camera moves', () => {
  it('ease between keys, and hold before the first and after the last', () => {
    let keys: CameraKey[] = setCameraKey([], 0, {});
    keys = setCameraKey(keys, 10, { panX: 100, push: -50 });
    expect(cameraMoveAt([], 5)).toEqual({ panX: 0, panY: 0, push: 0 });
    expect(cameraMoveAt(keys, 5)).toEqual({ panX: 50, panY: 0, push: -25 });
    expect(cameraMoveAt(keys, 20).panX).toBe(100);
    keys = setCameraKey(keys, 0, { easing: 'hold' });
    expect(cameraMoveAt(keys, 9.5).panX).toBe(0);
    // A key added between two starts where the camera is there, and keeps the stretch's easing.
    keys = setCameraKey(setCameraKey(keys, 0, { easing: 'linear' }), 4, {});
    expect(keys.map((k) => k.frame)).toEqual([0, 4, 10]);
    expect(keys[1].panX).toBeCloseTo(40, 9);
    expect(moveCameraKey(keys, 4, 10)).toBeNull();
    expect(moveCameraKey(keys, 4, 7)!.map((k) => k.frame)).toEqual([0, 7, 10]);
    expect(removeCameraKey(keys, 3)).toBeNull();
    expect(removeCameraKey(keys, 4)!.map((k) => k.frame)).toEqual([0, 10]);
  });

  it('slide near pieces past faster than far ones (parallax), and push in grows near ones more', () => {
    const rest = spaceOf({ x: 400, y: 300, strength: 50 }, 800, 600);
    const pan = spaceOf({ x: 400, y: 300, strength: 50 }, 800, 600, { panX: 100, panY: 0, push: 0 });
    const near = { ...identityState(300, 300), depth: 0 };
    const far = { ...identityState(300, 300), depth: 1000 };
    const at = (s: typeof near, sp: typeof rest) => project(placementOf(s, { x: 5, y: 5 }, 10, 10, sp), { x: 5, y: 5 })!;
    expect(at(near, rest).x).toBeCloseTo(300, 9);
    expect(at(near, pan).x).toBeCloseTo(200, 9);
    const shift = at(far, pan).x - at(far, rest).x;
    expect(shift).toBeCloseTo((-100 * rest.f) / (rest.f + 1000), 6);
    // Pushed in, a piece on the canvas grows more than one far behind it.
    const push = spaceOf({ x: 400, y: 300, strength: 50 }, 800, 600, { panX: 0, panY: 0, push: 300 });
    const width = (s: typeof near, sp: typeof rest) => {
      const pl = placementOf(s, { x: 5, y: 5 }, 10, 10, sp);
      return project(pl, { x: 10, y: 5 })!.x - project(pl, { x: 0, y: 5 })!.x;
    };
    expect(width(near, push) / width(near, rest)).toBeCloseTo(rest.f / (rest.f - 300), 6);
    expect(width(far, push) / width(far, rest)).toBeLessThan(width(near, push) / width(near, rest));
    // A tilted piece is seen through the moved camera too.
    const tilted = { ...near, tilt: 0.5 };
    expect(at(tilted, pan).x).toBeCloseTo(200, 6);
  });

  it('turn, flip and grow with the picture', () => {
    const keys: CameraKey[] = [{ frame: 0, panX: 10, panY: 20, push: 30, easing: 'linear' }];
    expect(transformCameraKeys(keys, [-2, 0, 0, 2, 100, 0])[0]).toMatchObject({ panX: -20, panY: 40, push: 60 });
  });

  it('are seen frame by frame in what exports draw', () => {
    const layer = new RasterLayer('L', new Surface(200, 100));
    const doc = new PaintDocument({ width: 200, height: 100 }, [layer]);
    const p = makePiece('p', '', layer.id, { w: 10, h: 10, data: new Uint8ClampedArray(400).fill(255) }, { x: 95, y: 45, w: 10, h: 10 }, 0);
    doc.pieces = [p];
    doc.timeline = { fps: 12, length: 11, loop: 'loop', frame: 0 };
    doc.cameraKeys = setCameraKey(setCameraKey([], 0, {}), 10, { panX: 50 });
    const covered = (frame: number, x: number) => {
      const extras = frameExtras(doc, frame)!;
      return extras.covers(layer, { x, y: 49, w: 1, h: 1 });
    };
    expect(covered(0, 100)).toBe(true);
    expect(covered(10, 100)).toBe(false);
    expect(covered(10, 50)).toBe(true);
    expect(new Scene(doc.pieces, 10, doc.spaceAt(10)).bounds(p).x).toBeLessThan(50);
  });
});

describe('camera moves in the controller and in projects', () => {
  let doc: PaintDocument;
  let history: History;
  let anim: AnimationController;
  beforeEach(() => {
    doc = new PaintDocument({ width: 400, height: 300 });
    history = new History();
    const host: AnimHost = {
      get doc() {
        return doc;
      },
      history,
      commitLive: () => undefined,
      notify: () => undefined,
      animationChanged: () => undefined,
    };
    anim = new AnimationController(host);
  });

  it('keys the camera from rest at the start, as undoable steps, while its row is selected', () => {
    const p: Piece = anim.add(img(10, 10), { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    anim.selectCamera();
    expect(anim.selected).toBeNull();
    expect(anim.info()).toMatchObject({ cameraSelected: true, cameraMove: { panX: 0, keyed: false } });
    anim.setFrame(12);
    expect(anim.setCameraKey(12, { panX: 80 })).toBe(true);
    expect(doc.cameraKeys.map((k) => [k.frame, k.panX])).toEqual([
      [0, 0],
      [12, 80],
    ]);
    expect(anim.info().cameraMove).toMatchObject({ panX: 80, keyed: true });
    anim.setFrame(6);
    expect(anim.cameraFields().panX).toBeCloseTo(40, 9);
    anim.select(p.id);
    expect(anim.info().cameraSelected).toBe(false);
    history.undo();
    expect(doc.cameraKeys).toEqual([]);
  });

  it('saves and reopens the camera’s moves (version 3)', async () => {
    anim.add(img(4, 4), { x: 0, y: 0, w: 4, h: 4 }, doc.layers[0].id);
    expect(versionFor(doc)).toBe(2);
    doc.cameraKeys = setCameraKey(setCameraKey([], 0, {}), 8, { panX: -30, panY: 12, push: 100, easing: 'easeOut' });
    expect(versionFor(doc)).toBe(3);
    const bytes = await saveProject(doc, codec);
    const json = JSON.parse(strFromU8(unzipSync(bytes)['document.json'])) as { animation: { cameraMoves: unknown[] } };
    expect(json.animation.cameraMoves).toHaveLength(2);
    const back = await loadProject(bytes, codec);
    expect(back.cameraKeys).toEqual(doc.cameraKeys);
    expect(back.spaceAt(4)).toEqual(doc.spaceAt(4));
  });

  it('leaves a piece’s keyframes where they are: only how the camera sees them changes', () => {
    const p = anim.add(img(10, 10), { x: 0, y: 0, w: 10, h: 10 }, doc.layers[0].id)!;
    p.keyframes = setKey(p.keyframes, 0, { depth: 200 });
    const before = p.keyframes.map((k) => ({ ...k }));
    anim.setCameraKey(0, { panX: 40 });
    expect(anim.piece(p.id)!.keyframes).toEqual(before);
  });
});
