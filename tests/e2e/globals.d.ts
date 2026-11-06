import type { PigmentoApi } from '../../src/shared/ipc';

/** Shape of the test hook exposed by the renderer when PIGMENTO_E2E=1. */
export interface PigmentoTestHook {
  pixel(x: number, y: number): { r: number; g: number; b: number; a: number };
  doc(): { width: number; height: number };
  history(): { index: number; length: number; dirty: boolean };
  tool(): string;
  docToScreen(x: number, y: number): { x: number; y: number };
  liveKind(): string | null;
  selection(): { x: number; y: number; w: number; h: number } | null;
  selectionAt(x: number, y: number): number;
  selectionArea(): number;
  savedSelections(): { id: string; name: string; w: number; h: number }[];
  openPath(path: string): Promise<boolean>;
  filePath(): string | null;
  autosaveNow(): Promise<boolean>;
  layers(): { tree: LayerNode[]; activeId: string; count: number };
  screenPixel(x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }>;
  fillLayer(id: string, c: { r: number; g: number; b: number; a: number }, r?: { x: number; y: number; w: number; h: number }): void;
  selectRect(x: number, y: number, w: number, h: number): void;
  addLayer(): string;
  groupLayers(ids: string[]): string | null;
  setLayerProps(id: string, p: Record<string, unknown>): void;
}

export interface LayerNode {
  id: string;
  kind: 'raster' | 'group';
  name: string;
  opacity: number;
  blend: string;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
  depth: number;
  children: LayerNode[];
}

declare global {
  interface Window {
    pigmento: PigmentoApi;
    __pigmentoTest?: PigmentoTestHook;
  }
}
