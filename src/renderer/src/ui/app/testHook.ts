import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { openPath } from '../services/files';

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
    selection: () => useUi.getState().selection.bounds,
    openPath: (p: string) => openPath(p, true),
    filePath: () => useUi.getState().file.path,
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
    /** Fill a raster layer with a colour (test setup; recorded as no history step). */
    fillLayer: (id: string, c: { r: number; g: number; b: number; a: number }) => {
      const layer = engine.doc.layerById(id);
      if (layer?.kind !== 'raster') return;
      layer.surface.fillRect(engine.doc.bounds, c);
      engine.layerChanged(layer, null);
    },
  };
}
