import { brushRegistry } from '@engine/brush/BrushRegistry';
import { brushPreview } from '@engine/brush/preview';
import { Selection } from '@engine/doc/Selection';
import type { VectorNode } from '@engine/vector/model';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { openPath } from '../services/files';
import { autosaveNow } from '../services/autosave';
import { defaultParams, shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { paintShape } from '@engine/vector/render';
import { makePiece, piecePlacementAt, pieceStateAt } from '@engine/anim/piece';
import { project } from '@engine/anim/space';
import { drawPiece } from '@engine/anim/pieceRaster';
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
    for (let f = 0; f <= 8; f++) drawPiece(view, { x: 0, y: r * H, w: W, h: H }, p, f);
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
    groupLayers: (ids: string[]) => engine.layers.group(ids),
    setLayerProps: (id: string, p: Record<string, unknown>) => engine.layers.setProps(id, p),
    /** The on-screen (GPU) composite at a pixel, for comparing against `pixel` (JS). */
    screenPixel: async (x: number, y: number) => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const ctx = engine.renderer.compositeCanvas.getContext('2d')!;
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
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
    /** Where a point of a piece (its own pixels) shows in the document at the frame shown. */
    pieceHandle: (id: string, x: number, y: number) => {
      const p = engine.anim.piece(id);
      if (!p) return { x: Number.NaN, y: Number.NaN };
      return project(piecePlacementAt(p, engine.anim.frame, engine.doc.space), { x, y }) ?? { x: Number.NaN, y: Number.NaN };
    },
  };
}
