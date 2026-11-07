import { describe, expect, it } from 'vitest';
import { importSvg, parseColor, parsePathData, parseTransform, parseXml, SvgImportError } from '@engine/io/svgImport';
import { pathBounds } from '@engine/shapes/path';
import { subpathBounds } from '@engine/vector/pathData';
import { maskToSubpaths, simplifyClosed } from '@engine/vector/trace';
import { ShapePackSchema } from '@shared/shapeFormat';

const svg = (body: string, attrs = 'width="200" height="100"') => `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
const errorKey = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SvgImportError ? e.key : 'other';
  }
  return null;
};

describe('XML reader', () => {
  it('reads elements and attributes, skipping everything else', () => {
    const r = parseXml(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY boom "x">]><!-- note --><svg a="1" b='&amp;&lt;&#65;&boom;'><g><path d="M0 0"/></g><![CDATA[<path/>]]>text</svg>`);
    const s = r.children[0];
    expect(s.name).toBe('svg');
    // Only the five XML entities and character references are decoded; DOCTYPE entities are not.
    expect(s.attrs).toEqual({ a: '1', b: '&<A&boom;' });
    expect(s.children.map((c) => c.name)).toEqual(['g']);
    expect(s.children[0].children[0].attrs.d).toBe('M0 0');
  });

  it('drops namespace prefixes and refuses broken or huge files', () => {
    expect(parseXml('<svg:svg><svg:rect/></svg:svg>').children[0].children[0].name).toBe('rect');
    expect(errorKey(() => parseXml('<svg a="1" broken'))).toBe('error.svgInvalid');
    expect(errorKey(() => parseXml('<svg>' + '<g/>'.repeat(20001) + '</svg>'))).toBe('error.svgTooComplex');
    expect(errorKey(() => parseXml('<g>'.repeat(80)))).toBe('error.svgTooComplex');
  });
});

describe('path data', () => {
  it('reads absolute and relative commands, shorthands and compact numbers', () => {
    const c = parsePathData('M10,10 l20 0 h10 v10 H10 z m5 5 c0 10 10 10 10 0 s10 -10 10 0 q5 5 10 0 t10 0 L1e1 2.5.5 3');
    expect(c[0]).toEqual({ op: 'M', x: 10, y: 10 });
    expect(c[1]).toEqual({ op: 'L', x: 30, y: 10 });
    expect(c[2]).toEqual({ op: 'L', x: 40, y: 10 });
    expect(c[3]).toEqual({ op: 'L', x: 40, y: 20 });
    expect(c[5].op).toBe('Z');
    // After Z, a relative move starts from the subpath's start.
    expect(c[6]).toEqual({ op: 'M', x: 15, y: 15 });
    // The smooth curve reflects the previous control point.
    const s = c[8];
    expect(s.op === 'C' && [s.x1, s.y1]).toEqual([25, 5]);
    const t = c[10];
    expect(t.op === 'Q' && [t.x1, t.y1]).toEqual([50, 10]);
    expect(c.at(-2)).toEqual({ op: 'L', x: 10, y: 2.5 });
    expect(c.at(-1)).toEqual({ op: 'L', x: 0.5, y: 3 });
  });

  it('turns arcs (with packed flags) into curves through the end point', () => {
    const c = parsePathData('M0 50 a50 50 0 1150 0');
    expect(c.slice(1).every((x) => x.op === 'C')).toBe(true);
    const end = c.at(-1)!;
    expect(end.op === 'C' && [end.x, end.y]).toEqual([50, 50]);
    // A large arc bulges far past the chord.
    const b = pathBounds(c)!;
    expect(b.h).toBeGreaterThan(50);
    expect(parsePathData('M0 0 A0 10 0 0 1 10 10')[1]).toEqual({ op: 'L', x: 10, y: 10 });
  });

  it('ignores data that does not start with a move', () => {
    expect(parsePathData('L10 10')).toEqual([]);
    expect(parsePathData('M10 10 L20')).toEqual([{ op: 'M', x: 10, y: 10 }]);
  });
});

describe('transforms and colours', () => {
  it('composes transform lists left to right', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 0, 2, 10, 20]);
    const r = parseTransform('rotate(90 10 10)');
    // (20, 10) turns a quarter around (10, 10) to (10, 20).
    expect(r[0] * 20 + r[2] * 10 + r[4]).toBeCloseTo(10);
    expect(r[1] * 20 + r[3] * 10 + r[5]).toBeCloseTo(20);
    expect(parseTransform('skewX(45)')[2]).toBeCloseTo(1);
  });

  it('reads the common colour forms', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 255 });
    expect(parseColor('#11223380')).toEqual({ r: 17, g: 34, b: 51, a: 128 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 255 });
    expect(parseColor('rgba(100%, 0%, 0%, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 128 });
    expect(parseColor('Navy')).toEqual({ r: 0, g: 0, b: 128, a: 255 });
    expect(parseColor('none')).toBe('none');
    expect(parseColor('inherit')).toBeNull();
  });
});

describe('SVG import', () => {
  it('imports basic shapes as paths with their styles', () => {
    const d = importSvg(
      svg(
        `<rect x="10" y="10" width="50" height="30" rx="5" fill="#ff0000" stroke="blue" stroke-width="2"/>
         <circle cx="100" cy="50" r="20" style="fill:none;stroke:#00ff00;stroke-width:4;stroke-linecap:round"/>
         <line x1="0" y1="0" x2="200" y2="100" stroke="black"/>
         <polygon points="150,10 190,10 170,40" fill-rule="evenodd"/>
         <polyline points="0,90 50,95 100,90" fill="none" stroke="black"/>`,
      ),
    );
    expect(d.width).toBe(200);
    expect(d.height).toBe(100);
    expect(d.shapes).toHaveLength(5);
    const [rect, circle, line, poly] = d.shapes;
    expect(rect.style).toMatchObject({ mode: 'both', width: 2, fill: { r: 255, g: 0, b: 0, a: 255 }, outline: { r: 0, g: 0, b: 255, a: 255 } });
    expect(subpathBounds(rect.subpaths!)).toEqual({ x: 10, y: 10, w: 50, h: 30 });
    expect(circle.style).toMatchObject({ mode: 'outline', width: 4, cap: 'round' });
    // A line is never filled.
    expect(line.style.mode).toBe('outline');
    // Fill defaults to black; fill-rule is kept.
    expect(poly.style).toMatchObject({ mode: 'fill', fill: { r: 0, g: 0, b: 0, a: 255 } });
    expect(poly.fillRule).toBe('evenodd');
    expect(poly.subpaths![0].closed).toBe(true);
  });

  it('applies viewBox, group transforms, inherited styles and opacity', () => {
    const d = importSvg(svg(`<g transform="translate(5 5)" fill="#000080" opacity="0.5"><g transform="scale(2)"><rect width="10" height="10" stroke="red" stroke-width="1"/></g></g>`, 'viewBox="0 0 50 25" width="100" height="50"'));
    const r = d.shapes[0];
    // viewBox doubles everything, then the group moves by 5 and scales by 2 again.
    expect(subpathBounds(r.subpaths!)).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    expect(r.style.width).toBe(4);
    expect(r.style.fill).toEqual({ r: 0, g: 0, b: 128, a: 128 });
  });

  it('leaves out hidden, unsupported and paint-less parts', () => {
    const d = importSvg(
      svg(
        `<defs><rect width="9" height="9"/></defs><script>alert(1)</script><text>hi</text><image href="x.png"/>
         <use href="#a"/><rect width="5" height="5" display="none"/><rect width="5" height="5" fill="none"/>
         <foreignObject><rect width="5" height="5"/></foreignObject><rect id="a" width="7" height="7"/>`,
      ),
    );
    expect(d.shapes).toHaveLength(1);
    expect(subpathBounds(d.shapes[0].subpaths!)).toEqual({ x: 0, y: 0, w: 7, h: 7 });
  });

  it('refuses files without an svg root or without shapes', () => {
    expect(errorKey(() => importSvg('<html><rect width="1" height="1"/></html>'))).toBe('error.svgInvalid');
    expect(errorKey(() => importSvg(svg('<text>only text</text>')))).toBe('error.svgEmpty');
  });
});

describe('selection to shape', () => {
  it('simplifies stair-steps into straight lines', () => {
    const stairs = [];
    for (let i = 0; i <= 10; i++) stairs.push({ x: i, y: i }, { x: i + 1, y: i });
    const loop = [...stairs, { x: 11, y: 11 }, { x: 0, y: 11 }];
    expect(simplifyClosed(loop, 0.8).length).toBeLessThan(6);
  });

  it('traces a mask with a hole into two subpaths', () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = x >= 5 && x < 15 && y >= 5 && y < 15 ? 0 : 255;
    const subs = maskToSubpaths({ bounds: { x: 100, y: 50, w, h }, mask });
    expect(subs).toHaveLength(2);
    expect(subs.every((s) => s.closed && s.anchors.length === 4)).toBe(true);
    expect(subpathBounds(subs)).toEqual({ x: 100, y: 50, w: 20, h: 20 });
  });
});

describe('shape packs', () => {
  const shape = { name: 'Badge', category: 'symbols', aspect: 1, fillRule: 'evenodd', outline: [{ closed: true, anchors: [{ x: 0, y: 0, in: null, out: null, smooth: false }, { x: 1, y: 1, in: null, out: null, smooth: false }] }] };
  it('accept valid packs and refuse anything else', () => {
    expect(ShapePackSchema.safeParse({ format: 'pigmento-shape-pack', version: 1, name: 'Mine', shapes: [shape] }).success).toBe(true);
    expect(ShapePackSchema.safeParse({ format: 'pigmento-shape-pack', version: 2, name: 'Mine', shapes: [shape] }).success).toBe(false);
    expect(ShapePackSchema.safeParse({ format: 'pigmento-shape-pack', version: 1, name: 'Mine', shapes: [] }).success).toBe(false);
    expect(ShapePackSchema.safeParse({ format: 'pigmento-shape-pack', version: 1, name: 'Mine', shapes: [{ ...shape, category: 'weird' }] }).success).toBe(false);
    expect(ShapePackSchema.safeParse({ format: 'pigmento-shape-pack', version: 1, name: 'Mine', shapes: Array(501).fill(shape) }).success).toBe(false);
  });
});
