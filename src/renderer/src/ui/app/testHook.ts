import { Selection } from '@engine/doc/Selection';
import type { VectorNode } from '@engine/vector/model';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { openPath } from '../services/files';
import { autosaveNow } from '../services/autosave';
import { defaultParams, shapeRegistry } from '@engine/shapes/ShapeRegistry';
import { paintShape } from '@engine/vector/render';

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

/** Pixels per cell that differ (any channel by more than 24) between two sheets. */
async function compareSheets(a: number[], b: number[], cell: number, cols: number): Promise<number[]> {
  const [x, y] = await Promise.all([engine.codecs.decode(new Uint8Array(a)), engine.codecs.decode(new Uint8Array(b))]);
  if (x.w !== y.w || x.h !== y.h) return [-1];
  const rows = Math.ceil(x.h / cell);
  const counts = new Array<number>(rows * cols).fill(0);
  for (let py = 0; py < x.h; py++) {
    for (let px = 0; px < x.w; px++) {
      const i = (py * x.w + px) * 4;
      const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]), Math.abs(x.data[i + 3] - y.data[i + 3]));
      if (d > 24) counts[Math.floor(py / cell) * cols + Math.floor(px / cell)]++;
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
    /** Fill a raster layer (or part of it) with a colour (test setup; recorded as no history step). */
    fillLayer: (id: string, c: { r: number; g: number; b: number; a: number }, r?: { x: number; y: number; w: number; h: number }) => {
      const layer = engine.doc.layerById(id);
      if (layer?.kind !== 'raster') return;
      layer.surface.fillRect(r ?? engine.doc.bounds, c);
      engine.layerChanged(layer, null);
    },
    selectRect: (x: number, y: number, w: number, h: number) =>
      engine.setSelection(Selection.fromRect({ x, y, w, h }, engine.doc.width, engine.doc.height)),
  };
}
