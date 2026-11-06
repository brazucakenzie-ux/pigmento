import { describe, expect, it } from 'vitest';
import { PaintDocument, RasterLayer, VectorLayer } from '@engine/doc/Document';
import { History, type Command } from '@engine/history/History';
import { applyLossless } from '@engine/history/TransformCommand';
import { loadProject, saveProject, type PngCodec } from '@engine/io/project';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { Surface } from '@engine/raster/Surface';
import { groupNodes, nodeBounds, type VectorNode, type VectorShape } from '@engine/vector/model';

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

const style: ShapeStyle = { mode: 'both', width: 3, outline: { r: 10, g: 20, b: 30, a: 255 }, fill: { r: 200, g: 100, b: 50, a: 128 }, radius: 6, antialias: false };
const rect = (id: string, x: number, y: number, w: number, h: number): VectorShape => ({
  type: 'shape',
  id,
  shape: 'roundRect',
  box: { cx: x + w / 2, cy: y + h / 2, w, h, angle: 0.25 },
  points: [],
  style,
});
const line: VectorShape = { type: 'shape', id: 'l1', shape: 'polygon', box: null, points: [{ x: 1, y: 2 }, { x: 30, y: 4 }, { x: 12, y: 40 }], style: { ...style, mode: 'outline' } };

describe('history groups', () => {
  it('records several pushes as one step that undoes them all, last first', () => {
    const h = new History();
    const log: string[] = [];
    const cmd = (name: string): Command => ({ label: 'history.fill', bytes: 1, undo: () => log.push(`undo ${name}`), redo: () => log.push(`redo ${name}`) });
    h.group('history.rect', () => {
      h.push(cmd('layer'));
      h.push(cmd('shape'));
    });
    expect(h.length).toBe(1);
    expect(h.entries()[0].label).toBe('history.rect');
    h.undo();
    h.redo();
    expect(log).toEqual(['undo shape', 'undo layer', 'redo layer', 'redo shape']);
    // A single push inside a group stays a plain step.
    h.group('history.rect', () => h.push(cmd('one')));
    expect(h.entries()[1].label).toBe('history.fill');
  });
});

describe('shape layers', () => {
  it('round-trip through .pigm as objects (groups, styles and points intact)', async () => {
    const base = new RasterLayer('Base', new Surface(100, 80));
    const grouped = groupNodes([rect('a', 5, 5, 20, 10), rect('b', 40, 10, 30, 30)], new Set(['a', 'b']));
    const objects: VectorNode[] = [...grouped.list, line];
    const shapes = new VectorLayer('Shapes 1', 100, 80, objects);
    shapes.setProps({ opacity: 0.5, blend: 'multiply' });
    const doc = new PaintDocument({ width: 100, height: 80 }, [base, shapes]);
    const back = await loadProject(await saveProject(doc, rawCodec), rawCodec);
    const l = back.layers[1];
    expect(l.kind).toBe('vector');
    if (l.kind !== 'vector') return;
    expect([l.name, l.opacity, l.blend, l.width, l.height]).toEqual(['Shapes 1', 0.5, 'multiply', 100, 80]);
    expect(l.objects).toEqual(objects);
  });

  it('turn their objects with the image', () => {
    const shapes = new VectorLayer('S', 100, 50, [rect('a', 0, 0, 20, 10), line]);
    const doc = new PaintDocument({ width: 100, height: 50 }, [new RasterLayer('B', new Surface(100, 50)), shapes]);
    applyLossless(doc, { kind: 'flip', axis: 'h' }, false);
    const b = nodeBounds(shapes.objects[1])!;
    expect(b.x).toBeCloseTo(100 - 30, 6);
    applyLossless(doc, { kind: 'rotate', quarterTurns: 1 }, false);
    expect([doc.width, doc.height, shapes.width, shapes.height]).toEqual([50, 100, 50, 100]);
    applyLossless(doc, { kind: 'rotate', quarterTurns: 1 }, true);
    applyLossless(doc, { kind: 'flip', axis: 'h' }, true);
    const pts = (shapes.objects[1] as VectorShape).points;
    pts.forEach((p, i) => {
      expect(p.x).toBeCloseTo(line.points[i].x, 6);
      expect(p.y).toBeCloseTo(line.points[i].y, 6);
    });
  });

  it('bump their version and drop their pixels when the objects change', () => {
    const shapes = new VectorLayer('S', 10, 10);
    const v = shapes.version;
    const first = shapes.surface;
    shapes.setObjects([rect('a', 0, 0, 5, 5)]);
    expect(shapes.version).toBe(v + 1);
    expect(shapes.surface).not.toBe(first);
  });
});
