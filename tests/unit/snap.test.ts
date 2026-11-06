import { describe, expect, it } from 'vitest';
import { boxLines, snapBox, snapPoint, type SnapTargets } from '@engine/snap';
import { guide, reframeGuides, scaleGuides, turnGuides } from '@engine/doc/guides';
import { PaintDocument } from '@engine/doc/Document';
import { loadProject, saveProject, type PngCodec } from '@engine/io/project';

const canvas = boxLines({ x: 0, y: 0, w: 1000, h: 600 }, 'canvas');
const targets = (extra: Partial<SnapTargets> = {}): SnapTargets => ({ xs: [...canvas.xs], ys: [...canvas.ys], grid: null, ...extra });

describe('snapping', () => {
  it('pulls a point onto the nearest line within the threshold', () => {
    const t = targets({ xs: [...canvas.xs, { pos: 300, kind: 'guide', from: 0, to: 600 }] });
    expect(snapPoint({ x: 296, y: 299 }, t, 6).point).toEqual({ x: 300, y: 300 });
    expect(snapPoint({ x: 290, y: 280 }, t, 6).point).toEqual({ x: 290, y: 280 });
  });

  it('snaps to the grid', () => {
    expect(snapPoint({ x: 47, y: 18 }, targets({ grid: 16 }), 4).point).toEqual({ x: 48, y: 16 });
  });

  it('lines up a moving box by its nearest edge or centre', () => {
    // Box centre at 497 → canvas centre 500.
    const r = snapBox({ x: 447, y: 100, w: 100, h: 50 }, targets(), 6);
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.matches).toEqual([{ axis: 'x', pos: 500, kind: 'canvas', from: 0, to: 600 }]);
    // Right edge 996 → canvas edge 1000.
    expect(snapBox({ x: 896, y: 100, w: 100, h: 50 }, targets(), 6).dx).toBe(4);
  });

  it('aligns with other objects and reports the span for a smart guide', () => {
    const obj = boxLines({ x: 600, y: 400, w: 80, h: 80 }, 'object');
    const t = targets({ xs: [...canvas.xs, ...obj.xs], ys: [...canvas.ys, ...obj.ys] });
    const r = snapBox({ x: 602, y: 100, w: 40, h: 40 }, t, 6);
    expect(r.dx).toBe(-2);
    expect(r.matches[0]).toEqual({ axis: 'x', pos: 600, kind: 'object', from: 100, to: 480 });
  });

  it('leaves far boxes alone', () => {
    expect(snapBox({ x: 120, y: 130, w: 30, h: 30 }, targets(), 6)).toEqual({ dx: 0, dy: 0, matches: [] });
  });
});

describe('guides', () => {
  const list = [guide('x', 100, 'a'), guide('y', 50, 'b')];

  it('follow crops and canvas changes, and drop off the edge', () => {
    expect(reframeGuides(list, { x: 20, y: 10, w: 200, h: 100 })).toEqual([
      { id: 'a', axis: 'x', pos: 80 },
      { id: 'b', axis: 'y', pos: 40 },
    ]);
    expect(reframeGuides(list, { x: 150, y: 0, w: 100, h: 100 })).toEqual([{ id: 'b', axis: 'y', pos: 50 }]);
  });

  it('scale with the image', () => {
    expect(scaleGuides(list, 400, 200, 800, 100)).toEqual([
      { id: 'a', axis: 'x', pos: 200 },
      { id: 'b', axis: 'y', pos: 25 },
    ]);
  });

  it('flip and turn with the image', () => {
    expect(turnGuides(list, 400, 200, { kind: 'flip', axis: 'h' })[0].pos).toBe(300);
    // 90° clockwise on 400×200: vertical x=100 becomes horizontal y=100; horizontal y=50 becomes vertical x=150.
    expect(turnGuides(list, 400, 200, { kind: 'rotate', quarterTurns: 1 })).toEqual([
      { id: 'a', axis: 'y', pos: 100 },
      { id: 'b', axis: 'x', pos: 150 },
    ]);
    const there = turnGuides(list, 400, 200, { kind: 'rotate', quarterTurns: 1 });
    expect(turnGuides(there, 200, 400, { kind: 'rotate', quarterTurns: 3 })).toEqual(list);
  });

  it('are saved in projects', async () => {
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
    const doc = new PaintDocument({ width: 400, height: 200 });
    doc.guides = [guide('x', 100.5), guide('y', 50)];
    const back = await loadProject(await saveProject(doc, codec), codec);
    expect(back.guides.map((g) => [g.axis, g.pos])).toEqual([
      ['x', 100.5],
      ['y', 50],
    ]);
  });
});
