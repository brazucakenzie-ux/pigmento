import { describe, expect, it } from 'vitest';
import { hinge } from '@engine/anim/links';
import { makePiece, setKey, type Piece } from '@engine/anim/piece';
import { sampleProjectiveBatch } from '@engine/anim/pieceProject';
import { drawPiece, drawRuns, hingedIds, runSheets } from '@engine/anim/pieceRaster';
import { Scene } from '@engine/anim/scene';
import { defaultLight, project, spaceOf, type Space } from '@engine/anim/space';
import type { ImageBuf } from '@engine/raster/transform';

const solid = (w: number, h: number, c: [number, number, number]): ImageBuf => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...c, 255], i);
  return { w, h, data };
};
const space: Space = spaceOf({ x: 200, y: 150, strength: 60 }, 400, 300);
const DEG = Math.PI / 180;
const AREA = { x: 0, y: 0, w: 400, h: 300 };

/** A dark front face with a dark side hinged on its right edge, folded by `fold`, the tree turned as `turn`. */
function pair(fold: number, change: Parameters<typeof setKey>[2]): { pieces: Piece[]; front: Piece; side: Piece } {
  const a = makePiece('a', '', 'L', solid(100, 80, [60, 30, 30]), { x: 120.3, y: 100.6, w: 100, h: 80 }, 0);
  const b = makePiece('b', '', 'L', solid(70, 80, [30, 60, 30]), { x: 0, y: 0, w: 70, h: 80 }, 0);
  const linked = hinge([a, b], 'b', 'a', { edge: 'e', childEdge: 'w', offset: 0, along: 1, across: 1 }, fold, () => 'g');
  if (typeof linked === 'string') throw new Error(linked);
  const pieces = linked.pieces.map((p) => (p.kind === 'group' ? { ...p, keyframes: setKey(p.keyframes, 0, change) } : p));
  return { pieces, front: pieces.find((p) => p.id === 'a')!, side: pieces.find((p) => p.id === 'b')! };
}

/** Alpha of the pixels along the hinge (away from its ends), from a picture of the doc area. */
function seamAlphas(img: { x: number; y: number; w: number; h: number; data: Uint8ClampedArray }, scene: Scene, front: Piece): number[] {
  const out: number[] = [];
  for (let t = 0.1; t <= 0.9; t += 0.02) {
    const p = project(scene.placement(front), { x: 100, y: 80 * t })!;
    const x = Math.floor(p.x) - img.x;
    const y = Math.floor(p.y) - img.y;
    out.push(img.data[(y * img.w + x) * 4 + 3]);
  }
  return out;
}

/** The same faces drawn one after the other (each smoothed at its own edges): the old way. */
function separately(pieces: Piece[], scene: Scene) {
  const data = new Uint8ClampedArray(AREA.w * AREA.h * 4);
  const view = { data, stride: AREA.w, ox: 0, oy: 0 };
  for (const p of scene.backToFront(pieces.filter((q) => q.kind === 'piece'))) drawPiece(view, AREA, p, scene, defaultLight());
  return { ...AREA, data };
}

describe('hinge seams', () => {
  for (const [name, fold, change] of [
    ['flat, turned at an odd angle', 0, { angle: 17 * DEG }],
    ['folded in 3D', 70 * DEG, { tilt: 0.35, turn: -0.5 }],
    ['folded square, its side turned towards the camera', 90 * DEG, { turn: -0.6, depth: 40 }],
  ] as const) {
    it(`shows no line along a hinge: ${name}`, () => {
      const { pieces, front } = pair(fold, change);
      const scene = new Scene(pieces, 0, space);
      const faces = scene.backToFront(pieces.filter((p) => p.kind === 'piece'));
      const runs = drawRuns(faces, hingedIds(pieces));
      expect(runs).toHaveLength(1);
      const img = sampleProjectiveBatch(runSheets(runs[0], scene, defaultLight()), AREA);
      // Every pixel along the seam is as solid as the faces either side of it.
      expect(Math.min(...seamAlphas(img, scene, front))).toBeGreaterThanOrEqual(254);
      // Drawn separately, the seam lets the background through somewhere along it.
      expect(Math.min(...seamAlphas(separately(pieces, scene), scene, front))).toBeLessThan(250);
    });
  }

  it('gathers only hinged faces next to each other in drawing order, never repeating ones', () => {
    const { pieces } = pair(0.4, {});
    const loose = makePiece('c', '', 'L', solid(4, 4, [0, 0, 0]), { x: 0, y: 0, w: 4, h: 4 }, 0);
    const [a, b] = [pieces.find((p) => p.id === 'a')!, pieces.find((p) => p.id === 'b')!];
    const hinged = hingedIds(pieces);
    expect([...hinged].sort()).toEqual(['a', 'b']);
    expect(drawRuns([a, b, loose], hinged).map((r) => r.map((p) => p.id))).toEqual([['a', 'b'], ['c']]);
    expect(drawRuns([a, loose, b], hinged).map((r) => r.length)).toEqual([1, 1, 1]);
    expect(drawRuns([a, { ...b, repeat: 'x' }], hinged).map((r) => r.length)).toEqual([1, 1]);
  });

  it('draws one sheet in a batch as it draws it alone', () => {
    const { pieces, side } = pair(50 * DEG, { tilt: 0.2 });
    const scene = new Scene(pieces, 0, space);
    const batch = sampleProjectiveBatch(runSheets([side], scene, defaultLight()), AREA);
    const alone = new Uint8ClampedArray(AREA.w * AREA.h * 4);
    drawPiece({ data: alone, stride: AREA.w, ox: 0, oy: 0 }, AREA, side, scene, defaultLight());
    let worst = 0;
    for (let y = 0; y < batch.h; y++) {
      for (let x = 0; x < batch.w; x++) {
        const i = (y * batch.w + x) * 4;
        const j = ((batch.y + y) * AREA.w + batch.x + x) * 4;
        worst = Math.max(worst, Math.abs(batch.data[i + 3] - alone[j + 3]));
        if (batch.data[i + 3] > 128) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(batch.data[i + k] - alone[j + k]));
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
  });
});
