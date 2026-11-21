import { describe, expect, it } from 'vitest';
import { PaintDocument, VectorLayer } from '@engine/doc/Document';
import { documentToSvg, type SvgExportDeps } from '@engine/io/svgExport';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { measurePath } from '@engine/anim/pathMeasure';
import { retrimNode, trimPart, type VectorShape } from '@engine/vector/model';
import { corner, fromCmds, type SubPath } from '@engine/vector/pathData';
import { trimmedLine, trimmedOutline } from '@engine/vector/render';
import { FULL_TRIM, measureOutline, piecePoints, trimPieces, trimSpans, type TrimPiece } from '@engine/vector/trim';
import type { PathCmd } from '@engine/shapes/path';

const style: ShapeStyle = { mode: 'outline', width: 4, outline: { r: 215, g: 38, b: 61, a: 255 }, fill: { r: 30, g: 136, b: 229, a: 255 }, radius: 0, antialias: true };
const deps: SvgExportDeps = { encodePng: async () => new Uint8Array([1, 2, 3]), patternTile: () => null };

/** A 100 px square, clockwise from (0, 0). */
const square: SubPath = { closed: true, anchors: [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)] };
const line = (x0: number, x1: number, y = 0): SubPath => ({ closed: false, anchors: [corner(x0, y), corner(x1, y)] });
const curve: SubPath = {
  closed: false,
  anchors: [
    { x: 0, y: 100, in: null, out: { x: 40, y: -60 }, smooth: false },
    { x: 200, y: 100, in: { x: 160, y: 260 }, out: null, smooth: false },
  ],
};

const lengthOf = (cmds: readonly PathCmd[]) => measureOutline(fromCmds(cmds)).total;
const ends = (p: TrimPiece) => {
  const first = p.cmds[0] as { x: number; y: number };
  const last = [...p.cmds].reverse().find((c) => c.op !== 'Z') as { x: number; y: number };
  return { a: { x: first.x, y: first.y }, b: { x: last.x, y: last.y } };
};

describe('trim spans', () => {
  it('are the part from Start to End (either way round), slid by Offset', () => {
    expect(trimSpans({ start: 0.2, end: 0.6, offset: 0 }, false)).toEqual([[0.2, 0.6]]);
    expect(trimSpans({ start: 0.6, end: 0.2, offset: 0 }, false)).toEqual([[0.2, 0.6]]);
    const [[a, b]] = trimSpans({ start: 0.2, end: 0.6, offset: 0.1 }, false)!;
    expect(a).toBeCloseTo(0.3, 12);
    expect(b).toBeCloseTo(0.7, 12);
  });

  it('stop at an open outline’s ends, and wrap round a closed one', () => {
    expect(trimSpans({ start: 0, end: 0.5, offset: 0.8 }, false)![0][0]).toBeCloseTo(0.8, 12);
    expect(trimSpans({ start: 0, end: 0.5, offset: 0.8 }, false)![0][1]).toBe(1);
    expect(trimSpans({ start: 0, end: 0.5, offset: 2 }, false)).toEqual([]);
    const wrapped = trimSpans({ start: 0, end: 0.5, offset: 0.8 }, true)!;
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0][0]).toBeCloseTo(0.8, 12);
    expect(wrapped[0][1]).toBe(1);
    expect(wrapped[1][0]).toBe(0);
    expect(wrapped[1][1]).toBeCloseTo(0.3, 12);
    // Many times round is the same.
    trimSpans({ start: 0, end: 0.5, offset: -3.2 }, true)!.forEach((span, i) => span.forEach((v, j) => expect(v).toBeCloseTo(wrapped[i][j], 9)));
  });

  it('are everything (null) for the whole outline, and nothing when Start meets End', () => {
    expect(trimSpans(FULL_TRIM, false)).toBeNull();
    expect(trimSpans({ start: 0, end: 1, offset: 0.4 }, true)).toBeNull();
    expect(trimSpans({ start: 0, end: 1, offset: 0.4 }, false)).not.toBeNull();
    expect(trimSpans({ start: 0.5, end: 0.5, offset: 0 }, false)).toEqual([]);
    expect(trimSpans({ start: Number.NaN, end: 2, offset: Number.POSITIVE_INFINITY }, false)).toBeNull();
  });
});

describe('trimming an outline', () => {
  it('cuts a closed outline at the right distances, round its corners', () => {
    const m = measureOutline([square]);
    expect(m.total).toBe(400);
    const [p] = trimPieces(m, { start: 0.125, end: 0.625, offset: 0 }, false)!;
    expect(ends(p)).toEqual({ a: { x: 50, y: 0 }, b: { x: 50, y: 100 } });
    expect(lengthOf(p.cmds)).toBeCloseTo(200, 9);
    expect(p.from).toBe(50);
  });

  it('cuts curves exactly where the share of their length falls', () => {
    const m = measureOutline([curve]);
    const exact = measurePath(curve)!;
    const [p] = trimPieces(m, { start: 0.25, end: 0.75, offset: 0 }, false)!;
    expect(p.cmds.map((c) => c.op)).toEqual(['M', 'C']);
    const { a, b } = ends(p);
    expect(Math.hypot(a.x - exact.at(0.25).x, a.y - exact.at(0.25).y)).toBeLessThan(0.05);
    expect(Math.hypot(b.x - exact.at(0.75).x, b.y - exact.at(0.75).y)).toBeLessThan(0.05);
    expect(lengthOf(p.cmds)).toBeCloseTo(m.total / 2, 0);
    // The curve cut out bends as the whole one does: its middle is on the original.
    const piece = measurePath(fromCmds(p.cmds)[0])!;
    const mid = piece.at(0.5);
    expect(Math.hypot(mid.x - exact.at(0.5).x, mid.y - exact.at(0.5).y)).toBeLessThan(0.1);
  });

  it('runs on through several outlines as one long line', () => {
    const m = measureOutline([line(0, 100), line(0, 300, 50)]);
    const pieces = trimPieces(m, { start: 0, end: 0.5, offset: 0 }, false)!;
    expect(pieces).toHaveLength(2);
    expect(ends(pieces[0])).toEqual({ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    expect(ends(pieces[1])).toEqual({ a: { x: 0, y: 50 }, b: { x: 100, y: 50 } });
    // Each piece says how far along its own outline it starts (dashes start again on each one).
    const later = trimPieces(m, { start: 0.5, end: 1, offset: 0 }, false)!;
    expect(later).toHaveLength(1);
    expect(later[0].from).toBe(100);
  });

  it('draws a stretch round past a closed outline’s start in one piece, or two when dashed', () => {
    const m = measureOutline([square]);
    const one = trimPieces(m, { start: 0, end: 0.2, offset: 0.9 }, false)!;
    expect(one).toHaveLength(1);
    expect(one[0].from).toBeCloseTo(360, 9);
    expect(lengthOf(one[0].cmds)).toBeCloseTo(80, 9);
    const dashed = trimPieces(m, { start: 0, end: 0.2, offset: 0.9 }, true)!;
    expect(dashed.map((p) => Math.round(p.from))).toEqual([360, 0]);
    // The whole of a closed outline (Start to End, any Offset) is drawn as it is.
    expect(trimPieces(m, { start: 0, end: 1, offset: 0.3 }, false)).toBeNull();
    // A whole outline inside the part that shows is closed up.
    const two = measureOutline([square, { ...square, anchors: square.anchors.map((a) => corner(a.x + 200, a.y)) }]);
    const [whole] = trimPieces(two, { start: 0, end: 0.75, offset: 0 }, false)!;
    expect(whole.cmds.at(-1)).toEqual({ op: 'Z' });
  });

  it('gives a trimmed line or curve back as its points, for arrowheads at the ends that show', () => {
    const m = measureOutline([line(0, 200)]);
    const [p] = trimPieces(m, { start: 0.25, end: 0.5, offset: 0 }, false)!;
    expect(piecePoints(p)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
    const [c] = trimPieces(measureOutline([curve]), { start: 0, end: 0.5, offset: 0 }, false)!;
    expect(piecePoints(c)).toHaveLength(4);
    const shape: VectorShape = { type: 'shape', id: 'a', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], style: { ...style, arrowEnd: 'triangle' }, trim: { start: 0, end: 0.5, offset: 0 } };
    expect(trimmedLine(trimmedOutline(shape, false)!)).toEqual({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], from: 0 });
    expect(trimmedOutline({ ...shape, trim: undefined }, false)).toBeNull();
  });
});

describe('trimmed shapes', () => {
  it('keep a trim only while it hides part of the outline', () => {
    const s: VectorShape = { type: 'shape', id: 's', shape: 'rect', box: { cx: 50, cy: 50, w: 40, h: 40, angle: 0 }, points: [], style };
    const t = retrimNode(s, { end: 0.5 }) as VectorShape;
    expect(t.trim).toEqual({ start: 0, end: 0.5, offset: 0 });
    expect(trimPart(t)).toEqual({ trim: { start: 0, end: 0.5, offset: 0 } });
    const back = retrimNode(t, { end: 1 }) as VectorShape;
    expect('trim' in back).toBe(false);
    expect(trimPart(back)).toEqual({});
    // A group trims every shape in it.
    const g = retrimNode({ type: 'group', id: 'g', children: [s, s] }, { start: 0.2 });
    expect(g.type === 'group' && g.children.every((c) => c.type === 'shape' && c.trim?.start === 0.2)).toBe(true);
  });

  it('export to SVG as they show: the fill whole, the outline trimmed with its dashes in place', async () => {
    const box: VectorShape = { type: 'shape', id: 'b', shape: 'rect', box: { cx: 50, cy: 50, w: 104, h: 104, angle: 0 }, points: [], style: { ...style, mode: 'both', dash: 'dash' }, trim: { start: 0.25, end: 0.5, offset: 0 } };
    const arrow: VectorShape = { type: 'shape', id: 'a', shape: 'line', box: null, points: [{ x: 0, y: 150 }, { x: 200, y: 150 }], style: { ...style, arrowEnd: 'triangle' }, trim: { start: 0, end: 0.5, offset: 0 } };
    const svg = await documentToSvg(new PaintDocument({ width: 200, height: 200, paper: null }, [new VectorLayer('S', 200, 200, [box, arrow])]), deps);
    // The fill on its own (the whole square), then the outline's part on its own, dashes picked up where they are.
    expect(svg).toMatch(/<path d="M[^"]*Z" fill="#1e88e5" fill-rule="nonzero"\/>/);
    expect(svg).toMatch(/<path d="M100 [^"]*" fill="none" stroke="#d7263d"[^>]*stroke-dasharray="[^"]+" stroke-dashoffset="100"\/>/);
    // The arrow's head is at the end that shows (half way), not at the line's end.
    const head = /<path d="M(\d+(?:\.\d+)?) 150[^"]*Z" fill="#d7263d"\/>/.exec(svg);
    expect(head).not.toBeNull();
    expect(Number(head![1])).toBeLessThanOrEqual(100);
    expect(svg).not.toMatch(/<path d="M200 150/);
  });
});
