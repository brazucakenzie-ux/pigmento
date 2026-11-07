import { describe, expect, it } from 'vitest';
import { GroupLayer, PaintDocument, RasterLayer, VectorLayer } from '@engine/doc/Document';
import { documentToSvg, type SvgExportDeps } from '@engine/io/svgExport';
import { importSvg } from '@engine/io/svgImport';
import { PaletteError, paletteToJson, parseAse, parseGpl, parsePalette } from '@engine/io/palette';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { Surface } from '@engine/raster/Surface';
import { addImageAsset } from '@engine/vector/assets';
import type { VectorShape } from '@engine/vector/model';
import { subpathBounds } from '@engine/vector/pathData';

const RED = { r: 215, g: 38, b: 61, a: 255 };
const BLUE = { r: 30, g: 136, b: 229, a: 255 };
const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal ASE file: one colour block per entry. */
function ase(entries: { model: string; values: number[] }[]): Uint8Array {
  const blocks: number[][] = [];
  for (const e of entries) {
    const name = 'c\0';
    const body: number[] = [];
    body.push(0, name.length);
    for (const ch of name) body.push(0, ch.charCodeAt(0));
    for (const ch of e.model) body.push(ch.charCodeAt(0));
    for (const v of e.values) {
      const b = new Uint8Array(new Float32Array([v]).buffer).reverse();
      body.push(...b);
    }
    body.push(0, 2);
    const len = body.length;
    blocks.push([0x00, 0x01, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body]);
  }
  const head = [0x41, 0x53, 0x45, 0x46, 0, 1, 0, 0, 0, 0, 0, entries.length];
  return new Uint8Array([...head, ...blocks.flat()]);
}

describe('palette files', () => {
  it('round-trip Pigmento palettes and accept a plain list of colours', () => {
    const json = paletteToJson({ name: 'Mine', colors: [RED, BLUE, RED] });
    const back = parsePalette('mine.json', enc(json));
    expect(back.name).toBe('Mine');
    // Repeats go; colours are opaque.
    expect(back.colors).toEqual([RED, BLUE]);
    expect(parsePalette('list.json', enc('["#000000", "#ffffff"]')).colors).toHaveLength(2);
    expect(() => parsePalette('bad.json', enc('{"format":"x"}'))).toThrow(PaletteError);
    expect(() => parsePalette('bad.json', enc('not json'))).toThrow(PaletteError);
  });

  it('reads GIMP palettes', () => {
    const p = parseGpl('GIMP Palette\nName: Sea\nColumns: 4\n# comment\n  0  51 102\tNavy\n255 255 255 White\nbroken line\n');
    expect(p.name).toBe('Sea');
    expect(p.colors).toEqual([
      { r: 0, g: 51, b: 102, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ]);
    expect(() => parseGpl('Not a palette\n1 2 3')).toThrow(PaletteError);
  });

  it('reads Adobe swatches in RGB, CMYK, grey and Lab', () => {
    const p = parseAse(
      ase([
        { model: 'RGB ', values: [1, 0, 0] },
        { model: 'CMYK', values: [0, 1, 1, 0] },
        { model: 'Gray', values: [0.5] },
        { model: 'LAB ', values: [1, 0, 0] },
      ]),
    );
    expect(p.colors[0]).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    // CMYK red folds into the RGB red already there.
    expect(p.colors[1]).toEqual({ r: 128, g: 128, b: 128, a: 255 });
    const white = p.colors[2];
    expect(white.r).toBeGreaterThan(250);
    expect(white.g).toBeGreaterThan(250);
    expect(white.b).toBeGreaterThan(250);
    expect(() => parseAse(enc('ASEF'))).toThrow(PaletteError);
    expect(() => parseAse(new Uint8Array([0x41, 0x53, 0x45, 0x46, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 200]))).toThrow(PaletteError);
  });
});

describe('SVG export', () => {
  const style: ShapeStyle = { mode: 'both', width: 4, outline: RED, fill: BLUE, radius: 0, antialias: true };
  const deps: SvgExportDeps = {
    encodePng: async (data, w, h) => new Uint8Array([w, h, data.length % 256]),
    patternTile: (_id, fg, bg) => ({ w: 2, h: 2, data: new Uint8ClampedArray([fg.r, fg.g, fg.b, 255, bg.r, bg.g, bg.b, 255, bg.r, bg.g, bg.b, 255, fg.r, fg.g, fg.b, 255]) }),
  };

  it('writes shapes as paths and pixel layers as PNGs, with layer settings', async () => {
    const surface = new Surface(100, 80);
    surface.writeRect({ x: 10, y: 10, w: 2, h: 2 }, { data: new Uint8ClampedArray(16).fill(255), stride: 2, ox: 10, oy: 10 });
    const raster = new RasterLayer('Paint', surface);
    const rect: VectorShape = { type: 'shape', id: 'r', shape: 'rect', box: { cx: 50, cy: 40, w: 40, h: 20, angle: 0 }, points: [], style: { ...style, dash: 'dash' } };
    const line: VectorShape = { type: 'shape', id: 'l', shape: 'line', box: null, points: [{ x: 0, y: 0 }, { x: 90, y: 0 }], style: { ...style, mode: 'outline', arrowEnd: 'triangle' } };
    const shapes = new VectorLayer('Shapes & <co>', 100, 80, [rect, line]);
    shapes.setProps({ opacity: 0.5, blend: 'multiply' });
    const hidden = new VectorLayer('Hidden', 100, 80, [rect]);
    hidden.setProps({ visible: false });
    const doc = new PaintDocument({ width: 100, height: 80 }, [raster, new GroupLayer('Group', [shapes, hidden])]);
    const svg = await documentToSvg(doc, deps);
    expect(svg).toMatch(/^<\?xml/);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80">');
    expect(svg).toContain('<rect width="100" height="80" fill="#ffffff"/>');
    expect(svg).toContain('<image data-name="Paint" x="10" y="10" width="2" height="2" href="data:image/png;base64,');
    expect(svg).toContain('opacity="0.5" style="mix-blend-mode:multiply" data-name="Shapes &amp; &lt;co&gt;"');
    expect(svg).toContain('stroke-dasharray="12 8"');
    expect(svg).not.toContain('data-name="Hidden"');
    // The arrowhead is its own filled path in the outline colour.
    expect(svg).toMatch(/<path d="M90 0L[^"]*Z" fill="#d7263d"\/>/);

    // Reading the export back gives the same rectangle (inset for its outline).
    const back = importSvg(svg);
    const r = back.shapes.find((s) => s.style.mode === 'both')!;
    expect(subpathBounds(r.subpaths!)).toEqual({ x: 32, y: 32, w: 36, h: 16 });
    // The layer's 50% opacity comes along onto the shape.
    expect(r.style.fill).toEqual({ ...BLUE, a: 128 });
  });

  it('writes gradients, patterns and pictures as SVG paint', async () => {
    const id = addImageAsset(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]));
    const g: VectorShape = { type: 'shape', id: 'g', shape: 'ellipse', box: { cx: 20, cy: 20, w: 20, h: 10, angle: 0.5 }, points: [], style: { ...style, fillKind: 'gradient', fillGradient: { type: 'radial', angle: 0, stops: null }, outlineKind: 'gradient', outlineGradient: { type: 'linear', angle: 90, stops: null } } };
    const p: VectorShape = { type: 'shape', id: 'p', shape: 'rect', box: { cx: 60, cy: 20, w: 20, h: 20, angle: 0 }, points: [], style: { ...style, fillKind: 'pattern', fillPattern: { id: 'checker', scale: 1 } } };
    const i: VectorShape = { type: 'shape', id: 'i', shape: 'rect', box: { cx: 60, cy: 60, w: 20, h: 20, angle: 0 }, points: [], style: { ...style, fillKind: 'image', fillImage: id } };
    const svg = await documentToSvg(new PaintDocument({ width: 100, height: 100, paper: null }, [new VectorLayer('S', 100, 100, [g, p, i])]), deps);
    expect(svg).toMatch(/<radialGradient id="g\d+" gradientUnits="userSpaceOnUse"[^>]*gradientTransform="matrix\(/);
    expect(svg).toMatch(/<linearGradient id="g\d+"/);
    expect(svg).toMatch(/stroke="url\(#g\d+\)"/);
    expect(svg).toMatch(/<pattern id="p\d+" patternUnits="userSpaceOnUse" width="2" height="2">/);
    expect(svg).toMatch(/<clipPath id="c\d+"><path d="[^"]+" clip-rule="nonzero"\/><\/clipPath>/);
    expect(svg).toMatch(/<g clip-path="url\(#c\d+\)"><image /);
    expect(svg).not.toContain('<rect width="100"');
  });
});
