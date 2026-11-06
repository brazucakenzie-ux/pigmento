import { create } from 'zustand';
import type { FileFormat, ImageFormat } from '@shared/formats';
import type { AutosaveEntry, RecentFile, SystemTheme } from '@shared/ipc';
import { defaultSettings, type Settings } from '@shared/settings';
import type { RGBA } from '@engine/core/color';
import type { Point } from '@engine/core/geometry';
import type { DocInfo, HistoryInfo, Notice, PatternInfo, SavedSelectionInfo, SelectionInfo } from '@engine/Engine';
import type { TransformInfo } from '@engine/live/TransformObject';
import type { SelectionModify } from '@engine/doc/Selection';
import type { LayersInfo } from '@engine/doc/LayerController';
import type { LiveKind } from '@engine/live/LiveObject';
import type { ViewState } from '@engine/render/View';
import type { TextEditState, ToolOptions } from '@engine/tools/Tool';
import type { I18nKey } from '../../i18n';

export type RibbonTab = 'home' | 'image' | 'view';

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
  | { kind: 'gradient' }
  | { kind: 'pasteLarger'; w: number; h: number; resolve: (r: 'enlarge' | 'keep' | null) => void }
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
  patterns: PatternInfo[];
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
  file: { path: null, name: null, format: null },
  doc: { width: 1280, height: 800, dpi: 96, paper: { r: 255, g: 255, b: 255, a: 255 } },
  history: { index: 0, length: 0, canUndo: false, canRedo: false, dirty: false, entries: [], initialLabel: 'history.initial.new' },
  view: { zoom: 1, panX: 0, panY: 0, width: 1, height: 1, docW: 1280, docH: 800 },
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
  patterns: [],
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
