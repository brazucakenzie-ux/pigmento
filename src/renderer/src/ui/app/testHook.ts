import { brushRegistry } from '@engine/brush/BrushRegistry';
import { brushPreview } from '@engine/brush/preview';
import { Selection } from '@engine/doc/Selection';
import type { VectorNode, VectorShape } from '@engine/vector/model';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { openPath } from '../services/files';
import { autosaveNow } from '../services/autosave';
import { defaultParams, shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { drawVectorShape, paintShape } from '@engine/vector/render';
import { corner } from '@engine/vector/pathData';
import type { ShapeStyle } from '@engine/live/ShapeObject';
import { makePiece, newPieceId, pieceStateAt, setKey, type Piece } from '@engine/anim/piece';
import { Scene } from '@engine/anim/scene';
import { defaultLight, project, spaceOf } from '@engine/anim/space';
import { drawPiece, drawRuns, frameExtras, hingedIds, runSheets } from '@engine/anim/pieceRaster';
import { applyPreset, makeTrail, type TrailPreset } from '@engine/anim/trail';
import { PaintDocument } from '@engine/doc/Document';
import { BOX_FACES, faceSize, makeBox, type BoxFace, type BoxSize } from '@engine/anim/box';
import { sampleProjectiveBatch } from '@engine/anim/pieceProject';
import { encodeAnimation } from '@engine/io/animExport';
import { EASINGS, type Keyframe } from '@engine/anim/interpolate';

/** Every built-in shape drawn into its own cell (golden-image tests). */
async function shapeSheet(cell: number, cols: number): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const defs = shapeRegistry.all().filter((d) => !d.custom);
  const w = cols * cell;
  const h = Math.ceil(defs.length / cols) * cell;
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  defs.forEach((d, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2;
    paintShape(ctx, {
      shape: 'parametric',
      shapeId: d.id,
      params: defaultParams(d),
      box: { cx, cy, w: cell - 10, h: cell - 10, angle: 0 },
      points: [],
      style: { mode: 'both', width: 2, outline: { r: 20, g: 20, b: 40, a: 255 }, fill: { r: 120, g: 160, b: 230, a: 255 }, radius: 0, antialias: true },
    });
  });
  const data = ctx.getImageData(0, 0, w, h).data;
  const png = await engine.codecs.encode('png', w, h, new Uint8ClampedArray(data), 100, 96);
  return { ids: defs.map((d) => d.id), w, h, png: Array.from(png) };
}

/**
 * Every built-in brush's sample stroke (seeded, so it never changes unless the brush does), in
 * cells of cellW×cellH on white.
 */
async function brushSheet(cellW: number, cellH: number, cols: number): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const defs = brushRegistry.all().filter((d) => !d.custom);
  const w = cols * cellW;
  const h = Math.ceil(defs.length / cols) * cellH;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  defs.forEach((d, i) => {
    const p = brushPreview(d.settings, cellW - 8, cellH - 8);
    const ox = (i % cols) * cellW + 4;
    const oy = Math.floor(i / cols) * cellH + 4;
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const s = (y * p.w + x) * 4;
        const a = p.data[s + 3] / 255;
        const t = ((oy + y) * w + ox + x) * 4;
        for (let c = 0; c < 3; c++) data[t + c] = Math.round(p.data[s + c] * a + 255 * (1 - a));
      }
    }
  });
  const png = await engine.codecs.encode('png', w, h, data, 100, 96);
  return { ids: defs.map((d) => d.id), w, h, png: Array.from(png) };
}

/** A test box's faces: each its own colour, with a dark mark in its top-left corner (a face turned or mirrored wrongly shows). */
const CUBE_COLOURS: Record<BoxFace, [number, number, number]> = { front: [200, 60, 50], top: [220, 170, 40], bottom: [60, 140, 70], left: [50, 90, 200], right: [150, 70, 170], back: [90, 90, 90] };

function cubeFaces(size: BoxSize, marks = true): Record<BoxFace, { w: number; h: number; data: Uint8ClampedArray }> {
  const out = {} as Record<BoxFace, { w: number; h: number; data: Uint8ClampedArray }>;
  for (const f of BOX_FACES) {
    const { w, h } = faceSize(f, size);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(marks && x < 10 && y < 10 ? [20, 20, 20, 255] : [...CUBE_COLOURS[f], 255], (y * w + x) * 4);
    out[f] = { w, h, data };
  }
  return out;
}

/** A box turned by tilt and turn: its pieces (group first), seen by a camera at its middle. */
function cubeAt(centre: { x: number; y: number }, size: BoxSize, tilt: number, turn: number, layerId: string, marks = true, names: (f: BoxFace) => string = (f) => f): Piece[] {
  const pieces = makeBox(newPieceId, layerId, centre, size, 0, { faces: cubeFaces(size, marks), names, shade: 0.6 });
  pieces[0].keyframes = setKey(pieces[0].keyframes, 0, { tilt, turn });
  return pieces;
}

/**
 * The cube sheet (golden-image test): a shaded box of six coloured faces at fixed angles, drawn
 * through the CPU path exports use, its faces together so the hinges stay solid.
 */
async function cubeSheet(): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const CELL = 200;
  const views: [string, number, number][] = [
    ['front-right', 0.35, -0.6],
    ['below-left', -0.45, 0.75],
    ['over-the-top', 0.9, 2.3],
    ['from-behind', 0.15, Math.PI - 0.35],
  ];
  const W = CELL * views.length;
  const data = new Uint8ClampedArray(W * CELL * 4).fill(255);
  views.forEach(([, tilt, turn], i) => {
    const centre = { x: i * CELL + CELL / 2, y: CELL / 2 };
    const pieces = cubeAt(centre, { w: 70, h: 60, d: 50 }, tilt, turn, 'sheet');
    const scene = new Scene(pieces, 0, spaceOf({ x: centre.x, y: centre.y, strength: 60 }, CELL, CELL));
    const cell = { x: i * CELL, y: 0, w: CELL, h: CELL };
    const order = scene.backToFront(pieces.filter((p) => scene.shows(p)));
    for (const run of drawRuns(order, hingedIds(pieces))) {
      const img = sampleProjectiveBatch(runSheets(run, scene, defaultLight()), cell);
      for (let y = 0; y < img.h; y++) {
        for (let x = 0; x < img.w; x++) {
          const s = (y * img.w + x) * 4;
          const a = img.data[s + 3] / 255;
          const t = ((img.y + y) * W + img.x + x) * 4;
          for (let c = 0; c < 3; c++) data[t + c] = Math.round(img.data[s + c] * a + data[t + c] * (1 - a));
        }
      }
    }
  });
  const png = await engine.codecs.encode('png', W, CELL, data, 100, 96);
  return { ids: views.map((v) => v[0]), w: W, h: CELL, png: Array.from(png) };
}

/**
 * The trim sheet (golden-image test): shapes with part of their outline showing, one a cell, drawn
 * as shape layers draw them: wrapping round, dashes and dots kept in place, arrowheads at the ends
 * that show, the fill whole, a gradient outline on a turned box, and a path of two parts.
 */
async function trimSheet(): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const CELL = 120;
  const ink = { r: 20, g: 20, b: 40, a: 255 };
  const st = (extra: Partial<ShapeStyle> = {}): ShapeStyle => ({ mode: 'outline', width: 6, outline: ink, fill: { r: 120, g: 160, b: 230, a: 255 }, radius: 0, antialias: true, ...extra });
  const box = (i: number, w = 84, h = 70, angle = 0) => ({ cx: i * CELL + CELL / 2, cy: CELL / 2, w, h, angle });
  const x = (i: number, v: number) => i * CELL + v;
  const cases: [string, (i: number) => VectorShape][] = [
    ['rect-half', (i) => ({ type: 'shape', id: 'a', shape: 'rect', box: box(i), points: [], style: st({ join: 'miter' }), trim: { start: 0, end: 0.5, offset: 0 } })],
    ['ellipse-wraps', (i) => ({ type: 'shape', id: 'b', shape: 'ellipse', box: box(i), points: [], style: st(), trim: { start: 0, end: 0.3, offset: 0.85 } })],
    ['dashes-in-place', (i) => ({ type: 'shape', id: 'c', shape: 'rect', box: box(i), points: [], style: st({ dash: 'dash', width: 4 }), trim: { start: 0.3, end: 0.9, offset: 0 } })],
    ['dots-on-a-curve', (i) => ({ type: 'shape', id: 'd', shape: 'curve', box: null, points: [{ x: x(i, 12), y: 100 }, { x: x(i, 30), y: 0 }, { x: x(i, 90), y: 120 }, { x: x(i, 108), y: 20 }], style: st({ dash: 'dot', cap: 'round' }), trim: { start: 0.4, end: 1, offset: 0 } })],
    ['arrow-line', (i) => ({ type: 'shape', id: 'e', shape: 'line', box: null, points: [{ x: x(i, 10), y: 100 }, { x: x(i, 110), y: 20 }], style: st({ width: 4, arrowStart: 'circle', arrowEnd: 'triangle' }), trim: { start: 0.2, end: 0.7, offset: 0 } })],
    ['arrow-curve', (i) => ({ type: 'shape', id: 'f', shape: 'curve', box: null, points: [{ x: x(i, 10), y: 60 }, { x: x(i, 40), y: -10 }, { x: x(i, 80), y: 130 }, { x: x(i, 110), y: 60 }], style: st({ width: 4, arrowEnd: 'open' }), trim: { start: 0, end: 0.6, offset: 0 } })],
    ['fill-whole', (i) => ({ type: 'shape', id: 'g', shape: 'roundRect', box: box(i), points: [], style: st({ mode: 'both', radius: 16 }), trim: { start: 0, end: 0.4, offset: 0.1 } })],
    ['gradient-turned', (i) => ({ type: 'shape', id: 'h', shape: 'rect', box: box(i, 80, 50, 0.5), points: [], style: st({ width: 8, outlineKind: 'gradient', outlineGradient: { type: 'linear', angle: 0, stops: null } }), trim: { start: 0.1, end: 0.6, offset: 0 } })],
    ['two-parts', (i) => ({ type: 'shape', id: 'k', shape: 'path', box: null, points: [], style: st({ cap: 'round' }), subpaths: [{ closed: false, anchors: [corner(x(i, 15), 30), corner(x(i, 105), 30)] }, { closed: true, anchors: [corner(x(i, 25), 55), corner(x(i, 95), 55), corner(x(i, 95), 100), corner(x(i, 25), 100)] }], trim: { start: 0, end: 0.7, offset: 0 } })],
    ['polygon-offset', (i) => ({ type: 'shape', id: 'm', shape: 'polygon', box: null, points: [{ x: x(i, 60), y: 10 }, { x: x(i, 110), y: 100 }, { x: x(i, 10), y: 100 }], style: st({ join: 'round' }), trim: { start: 0.25, end: 0.75, offset: -0.6 } })],
  ];
  const W = CELL * cases.length;
  const ctx = new OffscreenCanvas(W, CELL).getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, CELL);
  cases.forEach(([, make], i) => drawVectorShape(ctx, make(i), W, CELL));
  const data = ctx.getImageData(0, 0, W, CELL).data;
  const png = await engine.codecs.encode('png', W, CELL, new Uint8ClampedArray(data), 100, 96);
  return { ids: cases.map((c) => c[0]), w: W, h: CELL, png: Array.from(png) };
}

/**
 * The trail sheet (golden-image test): a small piece moving up across each cell, leaving one
 * trail (each preset, a trail pushed back in 3D, an echo), drawn by the CPU path exports and
 * flattening use, at a fixed frame and seed.
 */
async function trailSheet(): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const CELL = 160;
  const cases: [string, TrailPreset, number][] = [
    ['rocket-smoke', 'rocketSmoke', 0],
    ['comet-tail', 'cometTail', 0],
    ['sparkles', 'sparkles', 0],
    ['speed-lines', 'speedLines', 0],
    ['echo', 'echo', 0],
    ['smoke-in-depth', 'rocketSmoke', 400],
  ];
  const W = CELL * cases.length;
  const sheet = new Uint8ClampedArray(W * CELL * 4).fill(255);
  for (const [i, [, preset, depth]] of cases.entries()) {
    const doc = new PaintDocument({ width: CELL, height: CELL });
    const body = new Uint8ClampedArray(24 * 12 * 4);
    for (let k = 0; k < body.length; k += 4) body.set([40, 90, 200, 255], k);
    const p = makePiece('p', '', doc.layers[0].id, { w: 24, h: 12, data: body }, { x: 0, y: 0, w: 24, h: 12 }, 0);
    p.keyframes = setKey(setKey(p.keyframes, 0, { x: 20, y: 135, depth, easing: 'linear' }), 23, { x: 140, y: 30, depth });
    const trail = applyPreset(makeTrail('t', 'puffs', { x: 0, y: 6 }, 4242), preset);
    // Speed lines are white (for skies); dark here, so they show on the white sheet.
    const dark = { r: 30, g: 40, b: 70, a: 255 };
    p.trails = [preset === 'speedLines' ? { ...trail, colors: [{ pos: 0, color: dark }, { pos: 1, color: dark }] } : trail];
    doc.pieces = [p];
    const view = { data: new Uint8ClampedArray(CELL * CELL * 4), stride: CELL, ox: 0, oy: 0 };
    frameExtras(doc, 18)!.draw(doc.layers[0], { x: 0, y: 0, w: CELL, h: CELL }, view);
    // Over white, into its cell.
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const s = (y * CELL + x) * 4;
        const a = view.data[s + 3] / 255;
        const d = (y * W + i * CELL + x) * 4;
        for (let c = 0; c < 3; c++) sheet[d + c] = Math.round(view.data[s + c] * a + 255 * (1 - a));
      }
    }
  }
  const png = await engine.codecs.encode('png', W, CELL, sheet, 100, 96);
  return { ids: cases.map((c) => c[0]), w: W, h: CELL, png: Array.from(png) };
}

/** Pixels per cell that differ (any channel by more than 24) between two sheets. */
/**
 * The motion sheet (golden-image test): one row per easing and per kind of motion, each showing
 * a small piece at frames 0, 1 … 8 of a move across the row, drawn through the same pixel path
 * exports use.
 */
async function motionSheet(): Promise<{ ids: string[]; w: number; h: number; png: number[] }> {
  const W = 480;
  const H = 64;
  // A 20 × 12 bar, blue with a red nose, so turns and flips show.
  const src = { w: 20, h: 12, data: new Uint8ClampedArray(20 * 12 * 4) };
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 20; x++) {
      const i = (y * 20 + x) * 4;
      src.data.set(x >= 15 ? [220, 40, 40, 255] : [40, 80, 220, 255], i);
    }
  }
  type Row = { id: string; keys: [Partial<Keyframe>, Partial<Keyframe>]; pivot?: { x: number; y: number } };
  const rows: Row[] = [
    ...EASINGS.map((e): Row => ({ id: e, keys: [{ x: 30, y: 32, easing: e }, { x: 450, y: 32 }] })),
    { id: 'curve', keys: [{ x: 30, y: 54, out: { x: 160, y: -70 } }, { x: 450, y: 10, in: { x: -160, y: 70 } }] },
    { id: 'combo', keys: [{ x: 30, y: 32 }, { x: 450, y: 32, angle: 2 * Math.PI, sx: 2, sy: 0.5, skew: 0.3, opacity: 0.3 }] },
    { id: 'pivot', keys: [{ x: 30, y: 32 }, { x: 420, y: 32, angle: Math.PI }], pivot: { x: 0, y: 6 } },
  ];
  const data = new Uint8ClampedArray(W * H * rows.length * 4).fill(255);
  const view = { data, stride: W, ox: 0, oy: 0 };
  rows.forEach((row, r) => {
    const p = makePiece(`sheet-${row.id}`, row.id, 'sheet', src, { x: 0, y: 0, w: 20, h: 12 }, 0);
    if (row.pivot) p.pivot = row.pivot;
    const base = p.keyframes[0];
    const key = (k: Partial<Keyframe>, frame: number): Keyframe => ({ ...base, ...k, frame, y: (k.y ?? 32) + r * H });
    p.keyframes = [key(row.keys[0], 0), key(row.keys[1], 8)];
    for (let f = 0; f <= 8; f++) drawPiece(view, { x: 0, y: r * H, w: W, h: H }, p, new Scene([p], f));
  });
  const png = await engine.codecs.encode('png', W, H * rows.length, data, 100, 96);
  return { ids: rows.map((r) => r.id), w: W, h: H * rows.length, png: Array.from(png) };
}

async function compareSheets(a: number[], b: number[], cell: number, cols: number, cellH = cell): Promise<number[]> {
  const [x, y] = await Promise.all([engine.codecs.decode(new Uint8Array(a)), engine.codecs.decode(new Uint8Array(b))]);
  if (x.w !== y.w || x.h !== y.h) return [-1];
  const rows = Math.ceil(x.h / cellH);
  const counts = new Array<number>(rows * cols).fill(0);
  for (let py = 0; py < x.h; py++) {
    for (let px = 0; px < x.w; px++) {
      const i = (py * x.w + px) * 4;
      const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]), Math.abs(x.data[i + 3] - y.data[i + 3]));
      if (d > 24) counts[Math.floor(py / cellH) * cols + Math.floor(px / cell)]++;
    }
  }
  return counts;
}

/**
 * Exposes a small read-mostly API on window.__pigmentoTest when running end-to-end tests
 * (PIGMENTO_E2E=1). Never installed in normal use.
 */
export function installTestHook(): void {
  (window as unknown as Record<string, unknown>).__pigmentoTest = {
    pixel: (x: number, y: number) => engine.sampleColor(x, y),
    shapeSheet,
    brushSheet,
    motionSheet,
    compareSheets,
    doc: () => ({ width: engine.doc.width, height: engine.doc.height }),
    history: () => {
      const h = engine.historyInfo();
      return { index: h.index, length: h.length, dirty: h.dirty };
    },
    tool: () => engine.activeToolIdValue,
    docToScreen: (x: number, y: number) => {
      const r = engine.overlay.canvas.getBoundingClientRect();
      const p = engine.view.toScreen(x, y);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    liveKind: () => engine.live?.kind ?? null,
    pathInfo: () => useUi.getState().path,
    selection: () => useUi.getState().selection.bounds,
    /** Coverage (0–255) of the active selection at a pixel, and its "mostly selected" pixel count. */
    selectionAt: (x: number, y: number) => {
      const s = engine.doc.selection;
      if (!s) return 0;
      const lx = x - s.bounds.x;
      const ly = y - s.bounds.y;
      return lx < 0 || ly < 0 || lx >= s.bounds.w || ly >= s.bounds.h ? 0 : s.mask[ly * s.bounds.w + lx];
    },
    selectionArea: () => engine.doc.selection?.area() ?? 0,
    savedSelections: () => engine.savedSelectionsInfo(),
    transformInfo: () => engine.transformInfo(),
    guides: () => engine.doc.guides.map((g) => ({ axis: g.axis, pos: g.pos })),
    /** Objects of a shape layer (default: the active one), summarised. */
    vectorObjects: (id?: string) => {
      const l = id ? engine.doc.layerById(id) : engine.doc.activeLayer;
      if (l?.kind !== 'vector') return null;
      const summary = (n: VectorNode): Record<string, unknown> =>
        n.type === 'group'
          ? { type: 'group', id: n.id, children: n.children.map(summary) }
          : { type: 'shape', id: n.id, shape: n.shape, box: n.box, points: n.points, mode: n.style.mode, width: n.style.width, outline: n.style.outline, fill: n.style.fill, shapeId: n.shapeId ?? null, params: n.params ?? null, style: structuredClone(n.style), subpaths: n.subpaths ? structuredClone(n.subpaths) : null };
      return l.objects.map(summary);
    },
    vectorSelection: () => [...engine.vectorSelection],
    setVectorSelection: (ids: string[]) => engine.setVectorSelection(ids),
    activeLayerKind: () => engine.doc.activeLayer.kind,
    addGuide: (axis: 'x' | 'y', pos: number) => engine.addGuide(axis, pos),
    snapLines: () => engine.activeSnapLines.map((m) => ({ ...m })),
    /** Destination corners of the free transform in progress (TL, TR, BR, BL). */
    transformCorners: () => engine.transforming?.corners.map((p) => ({ x: p.x, y: p.y })) ?? null,
    openPath: (p: string) => openPath(p, true),
    filePath: () => useUi.getState().file.path,
    autosaveNow: () => autosaveNow(),
    layers: () => engine.layers.info(),
    addLayer: () => engine.layers.add(),
    setActiveLayer: (id: string) => engine.layers.setActive(id),
    groupLayers: (ids: string[]) => engine.layers.group(ids),
    setLayerProps: (id: string, p: Record<string, unknown>) => engine.layers.setProps(id, p),
    /** The on-screen (GPU) composite at a pixel, for comparing against `pixel` (JS). */
    screenPixel: async (x: number, y: number) => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const ctx = engine.renderer.compositeCanvas.getContext('2d')!;
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    /** Many points of the composited picture as the screen draws it (GPU), after one frame. */
    screenPixels: async (points: { x: number; y: number }[]) => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const ctx = engine.renderer.compositeCanvas.getContext('2d')!;
      const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
      return points.map(({ x, y }) => {
        const i = (y * ctx.canvas.width + x) * 4;
        return { r: img[i], g: img[i + 1], b: img[i + 2], a: img[i + 3] };
      });
    },
    /** What the screen shows at document point (x, y): after zoom, rotation and the reference image. */
    displayPixel: async (x: number, y: number) => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const c = engine.renderer.viewCanvas;
      const p = engine.view.toScreen(x, y);
      const k = c.width / engine.view.width;
      const d = c.getContext('2d')!.getImageData(Math.floor(p.x * k), Math.floor(p.y * k), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    viewRotation: () => engine.view.rotation,
    breakInterface: () => useUi.setState({ testCrash: true }),
    /** Fill a raster layer (or part of it) with a colour (test setup; recorded as no history step). */
    fillLayer: (id: string, c: { r: number; g: number; b: number; a: number }, r?: { x: number; y: number; w: number; h: number }) => {
      const layer = engine.doc.layerById(id);
      if (layer?.kind !== 'raster') return;
      layer.surface.fillRect(r ?? engine.doc.bounds, c);
      engine.layerChanged(layer, null);
    },
    selectRect: (x: number, y: number, w: number, h: number) =>
      engine.setSelection(Selection.fromRect({ x, y, w, h }, engine.doc.width, engine.doc.height)),
    /** Pieces, keyframes and the timeline. */
    anim: () => engine.anim.info(),
    animateSelection: (keepOriginal = false) => engine.animateSelection(keepOriginal),
    setFrame: (frame: number) => engine.anim.setFrame(frame),
    setPieceKey: (id: string, frame: number, change: Partial<Record<'x' | 'y' | 'sx' | 'sy' | 'angle' | 'skew' | 'opacity' | 'scrollX' | 'scrollY' | 'depth' | 'tilt' | 'turn', number>>) =>
      engine.anim.setKey(id, frame, change),
    celMirrors: () => engine.renderer.celMirrorCount,
    setTimeline: (change: { fps?: number; length?: number }) => engine.anim.setTimeline(change),
    /** Milliseconds to go to each frame and draw it (the work, without waiting for the screen). */
    renderTimes: (frames: number[]) =>
      frames.map((f) => {
        const t0 = performance.now();
        engine.anim.setFrame(f);
        engine.renderer.render();
        return performance.now() - t0;
      }),
    /** Encode frames 0 … count-1 as a GIF or MP4 the way Export animation does (no Save dialog). */
    encodeAnimation: async (format: 'gif' | 'mp4', count: number) => {
      const t0 = performance.now();
      const bytes = await encodeAnimation(
        (f) => engine.animationFrameCanvas(f, { scale: 1, transparent: false }),
        { format, frames: Array.from({ length: count }, (_, i) => i), fps: engine.anim.timeline.fps, repeat: 0, transparent: false, quality: 'high' },
        () => undefined,
        new AbortController().signal,
      );
      return { ms: performance.now() - t0, bytes: bytes.length };
    },
    pieceKeys: (id: string) => (engine.anim.piece(id)?.keyframes ?? []).map((k) => ({ ...k })),
    pieceAt: (id: string, frame: number) => {
      const p = engine.anim.piece(id);
      return p ? pieceStateAt(p, frame) : null;
    },
    /** A piece's own size and where it came from (or was placed). */
    pieceInfo: (id: string) => {
      const p = engine.anim.piece(id);
      return p ? { w: p.src.width, h: p.src.height, home: { ...p.home }, layerId: p.layerId } : null;
    },
    /** A pixel of a piece's own pixels. */
    piecePixel: (id: string, x: number, y: number) => engine.anim.piece(id)?.src.getPixel(x, y) ?? null,
    pieceFromLayer: (keepOriginal = false) => engine.pieceFromLayer(keepOriginal),
    setPieceRepeat: (id: string, repeat: 'none' | 'x' | 'y' | 'both') => engine.anim.setRepeat(id, repeat),
    selectPiece: (id: string | null) => engine.anim.select(id),
    setPieceBack: (id: string, back: 'mirror' | 'hide') => engine.anim.setBack(id, back),
    gpuPlanes: () => engine.renderer.gpuPlanes,
    /** A pixel of an animation-export frame (drawn on the GPU like the screen), on the paper. */
    exportFramePixel: (frame: number, x: number, y: number) => {
      const c = engine.animationFrameCanvas(frame, { scale: 1, transparent: false });
      const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    /** Where a point of a piece (its own pixels) shows in the document at the frame shown. */
    cubeSheet,
    trimSheet,
    trailSheet,
    /**
     * The 3D performance scene on top of what's there: a 6000 px striped background repeating across
     * the bottom layer and scrolling round, and a shaded box of 1024 px faces spinning once round
     * over the timeline (48 frames at 24 fps). Its group's id, and the background's.
     */
    perfBoxScene: (background = true) => {
      const a = engine.anim;
      a.setTimeline({ length: 48, fps: 24 });
      const { width: w, height: hh } = engine.doc;
      const box = () => {
        a.makeBox({ w: 1024, h: 1024, d: 1024 });
        const group = a.info().pieces.filter((p) => p.kind === 'group').at(-1)!.id;
        a.setKey(group, 47, { turn: a.piece(group)!.keyframes[0].turn + 2 * Math.PI });
        a.select(null);
        return group;
      };
      if (!background) return { group: box(), background: null, width: w };
      const bw = 6000;
      const data = new Uint8ClampedArray(bw * hh * 4);
      for (let y = 0; y < hh; y++) for (let x = 0; x < bw; x++) data.set([((x >> 6) & 1) * 120 + 60, 90 + (y % 200) / 2, 180 - ((x >> 7) & 1) * 80, 255], (y * bw + x) * 4);
      const bottom = engine.doc.rasterLayers()[0].id;
      const bg = a.add({ w: bw, h: hh, data }, { x: 0, y: 0, w: bw, h: hh }, bottom, 'history.placeImage', true)!;
      a.setRepeat(bg.id, 'x');
      a.loopScroll(bg.id);
      return { group: box(), background: bg.id, width: w };
    },
    /**
     * Times (ms) to redraw a drag of a piece, step by step (moving it and tilting it a little more each
     * time), each waiting for the GPU to finish (a 1-pixel read of the picture); the drag is then undone.
     */
    dragTimes: (id: string, steps: number) => {
      const a = engine.anim;
      const p = a.piece(id);
      if (!p) return [];
      const f = a.frame;
      const keys0 = p.keyframes.map((k) => ({ ...k }));
      const s0 = pieceStateAt(p, f);
      a.beginDrag();
      const times: number[] = [];
      for (let i = 1; i <= steps; i++) {
        const t0 = performance.now();
        a.preview(id, (q) => (q.keyframes = setKey(keys0, f, { x: s0.x + i * 4, y: s0.y + i * 2, tilt: s0.tilt + i * 0.004 })));
        engine.renderer.render();
        engine.renderer.compositeCanvas.getContext('2d')!.getImageData(0, 0, 1, 1);
        times.push(performance.now() - t0);
      }
      a.cancelDrag();
      return times;
    },
    /** How long (ms) the whole picture takes to draw through the CPU path, as a still export does. */
    stillExportMs: () => {
      const t0 = performance.now();
      engine.flatten(false);
      return performance.now() - t0;
    },
    /** Start timing pointer-to-pixel latency afresh, or read it (ms). */
    perfStart: () => {
      engine.perf.enabled = true;
      engine.perf.reset();
    },
    perfLatency: () => {
      const s = engine.perf.stats(performance.now());
      return { median: s.latency, p95: s.latencyP95 };
    },
    selectCamera: () => engine.anim.selectCamera(),
    pieceFront: (id: string) => {
      const p = engine.anim.piece(id);
      return p ? engine.anim.scene().placement(p).front : false;
    },
    /** A box of coloured faces on the active layer (one undo step), turned by tilt and turn: its face ids. */
    addTestBox: (cx: number, cy: number, size: BoxSize, tilt: number, turn: number, hideBacks = false, marks = true, named = false) => {
      const pieces = cubeAt({ x: cx, y: cy }, size, tilt, turn, engine.doc.activeId, marks, named ? engine.anim.faceNamer : undefined);
      if (hideBacks) for (const p of pieces) p.back = 'hide';
      if (!engine.anim.addTree(pieces, 'history.box')) return null;
      // By face (front, back…) whatever the faces are called.
      return Object.fromEntries(pieces.map((p, i) => [p.kind === 'group' ? 'group' : BOX_FACES[i - 1], p.id])) as Record<BoxFace | 'group', string>;
    },
    pieceHandle: (id: string, x: number, y: number) => {
      const p = engine.anim.piece(id);
      if (!p) return { x: Number.NaN, y: Number.NaN };
      return project(engine.anim.scene().placement(p), { x, y }) ?? { x: Number.NaN, y: Number.NaN };
    },
  };
}
