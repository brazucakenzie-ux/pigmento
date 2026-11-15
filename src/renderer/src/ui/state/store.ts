import { create } from 'zustand';
import type { FileFormat, ImageFormat } from '@shared/formats';
import type { AutosaveEntry, RecentFile, SystemTheme } from '@shared/ipc';
import { defaultSettings, type Settings } from '@shared/settings';
import type { RGBA } from '@engine/core/color';
import type { Point } from '@engine/core/geometry';
import type { DocInfo, HistoryInfo, Notice, PatternInfo, SavedSelectionInfo, SelectionInfo, VectorSelectionInfo } from '@engine/Engine';
import type { TransformInfo } from '@engine/live/TransformObject';
import type { PathInfo } from '@engine/live/ShapeObject';
import type { Symmetry } from '@engine/brush/symmetry';
import type { ReferenceInfo } from '@engine/tools/Tool';
import type { SelectionModify } from '@engine/doc/Selection';
import type { LayersInfo } from '@engine/doc/LayerController';
import type { LiveKind } from '@engine/live/LiveObject';
import type { ViewState } from '@engine/render/View';
import type { TextEditState, ToolOptions } from '@engine/tools/Tool';
import type { I18nKey } from '../../i18n';

export type RibbonTab = 'home' | 'shapes' | 'brushes' | 'effects' | 'image' | 'view';

export type DialogState =
  | { kind: 'new' }
  | { kind: 'resize' }
  | { kind: 'canvasSize' }
  | { kind: 'rotate' }
  | { kind: 'properties' }
  | { kind: 'editColors'; target: 'primary' | 'secondary' }
  | { kind: 'quality'; format: ImageFormat; transparent: boolean; layers: boolean; selections: boolean; resolve: (q: number | null) => void }
  | { kind: 'recover'; items: AutosaveEntry[] }
  | { kind: 'export' }
  | { kind: 'modifySelection'; op: SelectionModify }
  | { kind: 'colorRange' }
  | { kind: 'saveSelection' }
  | { kind: 'loadSelection' }
  /** Edit a gradient option (the Gradient tool's colours unless another option is named). */
  | { kind: 'gradient'; toolId?: string; optKey?: string }
  | { kind: 'pasteLarger'; w: number; h: number; resolve: (r: 'enlarge' | 'keep' | null) => void }
  /** Save the selected shape to My shapes, or rename one (id). */
  | { kind: 'saveShape'; id?: string }
  | { kind: 'deleteShape'; id: string }
  /** The Brush Designer: edit personal brush `id`, or make a new one starting from brush `from`. */
  | { kind: 'brushDesigner'; id?: string; from?: string }
  | { kind: 'deleteBrush'; id: string }
  /** Paint along the selection's outline or the selected shapes/path with the brush in use. */
  | { kind: 'strokeOutline'; source: 'selection' | 'path' }
  /** An adjustment's or filter's settings, with a live preview. */
  | { kind: 'filter'; id: string }
  /** Settings: the interface and keyboard shortcuts. */
  | { kind: 'settings'; page?: 'general' | 'shortcuts' }
  | { kind: 'userGuide' }
  | { kind: 'shortcuts' }
  | { kind: 'about' };

export interface Toast extends Notice {
  id: number;
}

export interface FileState {
  path: string | null;
  name: string | null;
  format: FileFormat | null;
}

export interface UiState {
  ready: boolean;
  settings: Settings;
  system: SystemTheme;
  tab: RibbonTab;
  dialog: DialogState | null;
  toasts: Toast[];
  recent: RecentFile[];
  fonts: string[];
  fullscreen: boolean;
  /** The performance overlay (a hidden shortcut). */
  perfOverlay: boolean;
  /** The welcome tour is showing. */
  tour: boolean;
  /** Tests only: makes the interface fail, to exercise the error screen. */
  testCrash: boolean;
  file: FileState;
  // Engine mirrors
  doc: DocInfo;
  history: HistoryInfo;
  view: ViewState;
  cursor: Point | null;
  selection: SelectionInfo;
  tool: string;
  toolOptions: Record<string, ToolOptions>;
  colors: { primary: RGBA; secondary: RGBA };
  live: LiveKind | null;
  text: TextEditState | null;
  hint: I18nKey | null;
  transparentSelection: boolean;
  canvasDrag: { w: number; h: number } | null;
  layers: LayersInfo;
  savedSelections: SavedSelectionInfo[];
  transform: TransformInfo | null;
  /** A path being drawn or edited with the Pen tool (or in place). */
  path: PathInfo | null;
  /** Bumped when personal shapes are added, renamed or removed (the gallery re-reads them). */
  shapeLibrary: number;
  /** Brush symmetry. */
  symmetry: Symmetry;
  /** The reference image over the canvas, if any. */
  reference: ReferenceInfo | null;
  /** Bumped when personal brushes change (pickers re-read the library). */
  brushLibrary: number;
  patterns: PatternInfo[];
  /** How many guides the image has. */
  guides: number;
  /** Objects selected on the active shape layer. */
  vectorSelection: VectorSelectionInfo;
}

export const useUi = create<UiState>(() => ({
  ready: false,
  settings: defaultSettings(),
  system: { dark: false, highContrast: false, accent: null },
  tab: 'home',
  dialog: null,
  toasts: [],
  recent: [],
  fonts: [],
  fullscreen: false,
  perfOverlay: false,
  tour: false,
  testCrash: false,
  file: { path: null, name: null, format: null },
  doc: { width: 1280, height: 800, dpi: 96, paper: { r: 255, g: 255, b: 255, a: 255 } },
  history: { index: 0, length: 0, canUndo: false, canRedo: false, dirty: false, entries: [], initialLabel: 'history.initial.new' },
  view: { zoom: 1, panX: 0, panY: 0, width: 1, height: 1, docW: 1280, docH: 800, rotation: 0 },
  cursor: null,
  selection: { bounds: null, floating: false },
  tool: 'pencil',
  toolOptions: {},
  colors: { primary: { r: 0, g: 0, b: 0, a: 255 }, secondary: { r: 255, g: 255, b: 255, a: 255 } },
  live: null,
  text: null,
  hint: null,
  transparentSelection: false,
  canvasDrag: null,
  layers: { tree: [], activeId: '', count: 0 },
  savedSelections: [],
  transform: null,
  path: null,
  shapeLibrary: 0,
  symmetry: { mode: 'off', segments: 6, center: null },
  reference: null,
  brushLibrary: 0,
  patterns: [],
  guides: 0,
  vectorSelection: { count: 0, groups: 0, bounds: null, shape: null },
}));

let pendingPatch: Partial<Settings> = {};
let saveTimer = 0;

/** Update settings locally and persist (debounced) through the main process. */
export function updateSettings(patch: Partial<Settings>): void {
  useUi.setState((s) => ({ settings: { ...s.settings, ...patch } }));
  pendingPatch = { ...pendingPatch, ...patch };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const p = pendingPatch;
    pendingPatch = {};
    void window.pigmento.settings.set(p).catch((err: unknown) => console.error('Saving settings failed', err));
  }, 400);
}

let toastId = 0;
export function showToast(n: Notice, ttl = n.kind === 'error' ? 7000 : 3200): void {
  const id = ++toastId;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { ...n, id }] }));
  window.setTimeout(() => dismissToast(id), ttl);
}

export function dismissToast(id: number): void {
  useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function openDialog(d: DialogState): void {
  useUi.setState({ dialog: d });
}

export function closeDialog(): void {
  useUi.setState({ dialog: null });
}
