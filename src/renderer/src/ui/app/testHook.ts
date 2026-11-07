import { Selection } from '@engine/doc/Selection';
import type { VectorNode } from '@engine/vector/model';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { openPath } from '../services/files';
import { autosaveNow } from '../services/autosave';

/**
 * Exposes a small read-mostly API on window.__pigmentoTest when running end-to-end tests
 * (PIGMENTO_E2E=1). Never installed in normal use.
 */
export function installTestHook(): void {
  (window as unknown as Record<string, unknown>).__pigmentoTest = {
    pixel: (x: number, y: number) => engine.sampleColor(x, y),
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
