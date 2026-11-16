import type { PigmentoApi } from '../../src/shared/ipc';

/** Shape of the test hook exposed by the renderer when PIGMENTO_E2E=1. */
export interface PigmentoTestHook {
  pixel(x: number, y: number): { r: number; g: number; b: number; a: number };
  doc(): { width: number; height: number };
  history(): { index: number; length: number; dirty: boolean };
  brushSheet(cellW: number, cellH: number, cols: number): Promise<{ ids: string[]; w: number; h: number; png: number[] }>;
  motionSheet(): Promise<{ ids: string[]; w: number; h: number; png: number[] }>;
  tool(): string;
  docToScreen(x: number, y: number): { x: number; y: number };
  liveKind(): string | null;
  selection(): { x: number; y: number; w: number; h: number } | null;
  selectionAt(x: number, y: number): number;
  selectionArea(): number;
  savedSelections(): { id: string; name: string; w: number; h: number }[];
  transformInfo(): { x: number; y: number; w: number; h: number; angle: number; skew: number; distorted: boolean } | null;
  transformCorners(): { x: number; y: number }[] | null;
  guides(): { axis: 'x' | 'y'; pos: number }[];
  vectorObjects(id?: string): VectorObject[] | null;
  vectorSelection(): string[];
  shapeSheet(cell: number, cols: number): Promise<{ ids: string[]; w: number; h: number; png: number[] }>;
  compareSheets(a: number[], b: number[], cell: number, cols: number, cellH?: number): Promise<number[]>;
  pathInfo(): { drawing: boolean; closed: boolean; selected: { smooth: boolean } | null; anchors: number } | null;
  setVectorSelection(ids: string[]): void;
  activeLayerKind(): 'raster' | 'group' | 'vector';
  addGuide(axis: 'x' | 'y', pos: number): void;
  snapLines(): { axis: 'x' | 'y'; pos: number; kind: string; from: number; to: number }[];
  openPath(path: string): Promise<boolean>;
  filePath(): string | null;
  autosaveNow(): Promise<boolean>;
  layers(): { tree: LayerNode[]; activeId: string; count: number };
  screenPixel(x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }>;
  displayPixel(x: number, y: number): Promise<{ r: number; g: number; b: number; a: number }>;
  viewRotation(): number;
  breakInterface(): void;
  fillLayer(id: string, c: { r: number; g: number; b: number; a: number }, r?: { x: number; y: number; w: number; h: number }): void;
  selectRect(x: number, y: number, w: number, h: number): void;
  anim(): {
    fps: number;
    length: number;
    loop: 'loop' | 'once' | 'pingpong';
    frame: number;
    selectedId: string | null;
    pieces: { id: string; name: string; layerId: string; keys: { frame: number; easing: string }[] }[];
    current: { x: number; y: number; w: number; h: number; angle: number; skew: number; opacity: number; easing: string; keyed: boolean; curved: boolean } | null;
    playing: boolean;
    cels: Record<string, number[]>;
  };
  animateSelection(keepOriginal?: boolean): boolean;
  pieceKeys(id: string): { frame: number; x: number; y: number; in: { x: number; y: number } | null; out: { x: number; y: number } | null; easing: string }[];
  pieceAt(id: string, frame: number): { x: number; y: number; sx: number; sy: number; angle: number; skew: number; opacity: number } | null;
  setFrame(frame: number): void;
  setPieceKey(id: string, frame: number, change: Partial<Record<'x' | 'y' | 'sx' | 'sy' | 'angle' | 'skew' | 'opacity', number>>): boolean;
  addLayer(): string;
  groupLayers(ids: string[]): string | null;
  setLayerProps(id: string, p: Record<string, unknown>): void;
}

export interface VectorObject {
  type: 'shape' | 'group';
  id: string;
  shape?: string;
  box?: { cx: number; cy: number; w: number; h: number; angle: number } | null;
  points?: { x: number; y: number }[];
  mode?: string;
  width?: number;
  outline?: { r: number; g: number; b: number; a: number };
  fill?: { r: number; g: number; b: number; a: number };
  shapeId?: string | null;
  params?: Record<string, number> | null;
  /** The full style (fill and outline styles included). */
  style?: { dash?: string; fillKind?: string; [key: string]: unknown };
  subpaths?: { closed: boolean; anchors: { x: number; y: number; smooth: boolean; in: unknown; out: unknown }[] }[] | null;
  children?: VectorObject[];
}

export interface LayerNode {
  id: string;
  kind: 'raster' | 'group' | 'vector';
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
