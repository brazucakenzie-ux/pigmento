import { describe, expect, it } from 'vitest';
import { BOX_FACES, faceSize, makeBox, type BoxFace } from '@engine/anim/box';
import { checkLinks, treeOf } from '@engine/anim/links';
import { setKey, type Piece } from '@engine/anim/piece';
import { sampleProjectiveBatch } from '@engine/anim/pieceProject';
import { drawRuns, hingedIds, runSheets } from '@engine/anim/pieceRaster';
import { Scene } from '@engine/anim/scene';
import { defaultLight, project, spaceOf } from '@engine/anim/space';

const space = spaceOf({ x: 200, y: 150, strength: 60 }, 400, 300);
const size = { w: 80, h: 60, d: 40 };
let n = 0;
const box = (): Piece[] => makeBox(() => `p${++n}`, 'L', { x: 200, y: 150 }, size, 0, { names: (f) => f });
const face = (pieces: Piece[], f: BoxFace) => pieces.find((p) => p.name === f)!;

/** The 8 corners of the box in 3D, each as every face that has it says. */
function cornersIn3d(pieces: Piece[], scene: Scene): Map<string, number[][]> {
  const out = new Map<string, number[][]>();
  for (const f of BOX_FACES) {
    const p = face(pieces, f);
    const { w, h } = faceSize(f, size);
    for (const q of [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h }]) {
      const W = scene.worldOf(p, q);
      const k = W.map((v) => Math.round(v)).join(',');
      out.set(k, [...(out.get(k) ?? []), W]);
    }
  }
  return out;
}

describe('the box', () => {
  it('folds six faces into a closed box, its front on the canvas at its real size', () => {
    const pieces = box();
    expect(pieces).toHaveLength(7);
    expect(pieces[0].kind).toBe('group');
    expect(checkLinks(pieces)).toEqual(pieces);
    expect(treeOf(pieces, pieces[3])).toHaveLength(7);
    const scene = new Scene(pieces, 0, space);
    const front = face(pieces, 'front');
    const tl = project(scene.placement(front), { x: 0, y: 0 })!;
    const br = project(scene.placement(front), { x: 80, y: 60 })!;
    expect([tl.x, tl.y, br.x, br.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([160, 120, 240, 180]);
    // Every corner is shared by exactly three faces, which agree on where it is.
    const corners = cornersIn3d(pieces, scene);
    expect(corners.size).toBe(8);
    for (const list of corners.values()) {
      expect(list).toHaveLength(3);
      for (const W of list) W.forEach((v, i) => expect(v).toBeCloseTo(list[0][i], 6));
    }
    // From the front only the front shows its face; the back is turned away (fronts face out).
    expect(scene.placement(front).front).toBe(true);
    expect(scene.placement(face(pieces, 'back')).front).toBe(false);
  });

  it('turns about its middle', () => {
    const pieces = box();
    const g = pieces[0];
    const spun = pieces.map((p) => (p === g ? { ...p, keyframes: setKey(p.keyframes, 0, { turn: Math.PI / 2 }) } : p));
    const a = cornersIn3d(pieces, new Scene(pieces, 0, space));
    const b = cornersIn3d(spun, new Scene(spun, 0, space));
    const mid = (m: Map<string, number[][]>) => [0, 1, 2].map((i) => [...m.values()].reduce((s, l) => s + l[0][i], 0) / 8);
    mid(b).forEach((v, i) => expect(v).toBeCloseTo(mid(a)[i], 6));
  });

  it('shows no line along any edge at any of these angles', () => {
    for (const [tilt, turn] of [
      [0.4, -0.6],
      [-0.5, 0.8],
      [1.1, 2.4],
      [0.2, Math.PI - 0.3],
    ]) {
      const pieces = box().map((p) => (p.kind === 'group' ? { ...p, keyframes: setKey(p.keyframes, 0, { tilt, turn }) } : p));
      const scene = new Scene(pieces, 0, space);
      const faces = scene.backToFront(pieces.filter((p) => scene.shows(p)));
      const runs = drawRuns(faces, hingedIds(pieces));
      expect(runs).toHaveLength(1);
      const img = sampleProjectiveBatch(runSheets(runs[0], scene, defaultLight()), { x: 0, y: 0, w: 400, h: 300 });
      // Inside the box's outline (its pixels with a fully covered pixel on every side), nothing lets the background through.
      const a = (x: number, y: number) => (x < 0 || y < 0 || x >= img.w || y >= img.h ? 0 : img.data[(y * img.w + x) * 4 + 3]);
      let holes = 0;
      for (let y = 1; y < img.h - 1; y++) {
        for (let x = 1; x < img.w - 1; x++) {
          const inner = a(x - 1, y) === 255 && a(x + 1, y) === 255 && a(x, y - 1) === 255 && a(x, y + 1) === 255;
          if (inner && a(x, y) < 254) holes++;
        }
      }
      expect(holes, `tilt ${tilt}, turn ${turn}`).toBe(0);
    }
  });
});
