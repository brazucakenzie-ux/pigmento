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
  };
}
