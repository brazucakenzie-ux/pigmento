import type { ThemeMode } from '@shared/settings';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { reportEngineError } from '@engine/input/InputController';
import type { I18nKey } from '../../i18n';
import { engine } from '../state/engine';
import { openDialog, updateSettings, useUi, type UiState } from '../state/store';
import * as files from '../services/files';
import { THEME_FAMILIES } from '../theme/themes';

export type ActionGroup = 'file' | 'edit' | 'view' | 'tools' | 'image' | 'colors';

export interface Action {
  id: string;
  labelKey: I18nKey;
  icon?: string;
  group: ActionGroup;
  /** Default shortcuts, e.g. "Ctrl+Shift+S". The first is shown in tooltips. */
  shortcut?: string[];
  run(): void | Promise<void>;
  enabled?(s: UiState): boolean;
  checked?(s: UiState): boolean;
}

const hasSelection = (s: UiState) => s.selection.bounds !== null;

/** Open a selection dialog with floating pixels put down first (their selection stays). */
function selectionDialog(d: Parameters<typeof openDialog>[0]): void {
  engine.commitLive(true);
  openDialog(d);
}

function safe(fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (err) {
      reportEngineError(engine, err);
    }
  };
}

function setThemeMode(themeMode: ThemeMode): void {
  updateSettings({ themeMode });
}

function toggleView(key: 'rulers' | 'gridlines' | 'pixelGrid' | 'statusBar'): void {
  const v = useUi.getState().settings.view;
  const next = { ...v, [key]: !v[key] };
  updateSettings({ view: next });
  engine.setViewOptions({ pixelGrid: next.pixelGrid, gridlines: next.gridlines, gridSize: next.gridSize });
}

function togglePanel(id: 'history' | 'navigator' | 'layers'): void {
  const p = useUi.getState().settings.panels;
  const visible = { ...p.visible, [id]: !(p.visible[id] ?? true) };
  updateSettings({ panels: { ...p, open: true, visible } });
}

/** Grow/shrink the active tool's size by roughly 15% (at least 1 px), like Paint's [ and ]. */
function stepSize(dir: 1 | -1): void {
  const tool = engine.activeTool;
  const spec = tool.options.find((o) => o.type === 'slider' && (o.key === 'size' || o.key === 'width'));
  if (!spec || spec.type !== 'slider') return;
  const cur = Number(engine.options(tool.id)[spec.key] ?? spec.default);
  const step = Math.max(1, Math.round(cur * 0.15));
  const next = Math.min(spec.max, Math.max(spec.min, cur + dir * step));
  engine.setToolOption(tool.id, spec.key, next);
}

const base: Action[] = [
  // File
  { id: 'new', labelKey: 'action.new', icon: 'new', group: 'file', shortcut: ['Ctrl+N'], run: () => openDialog({ kind: 'new' }) },
  { id: 'newWindow', labelKey: 'file.newWindow', icon: 'new-window', group: 'file', shortcut: ['Ctrl+Shift+N'], run: () => window.pigmento.window.newWindow() },
  { id: 'open', labelKey: 'action.open', icon: 'open', group: 'file', shortcut: ['Ctrl+O'], run: () => files.open() },
  { id: 'save', labelKey: 'action.save', icon: 'save', group: 'file', shortcut: ['Ctrl+S'], run: async () => void (await files.save()) },
  { id: 'saveAs', labelKey: 'action.saveAs', icon: 'save', group: 'file', shortcut: ['Ctrl+Shift+S'], run: async () => void (await files.saveAs()) },
  {
    id: 'export',
    labelKey: 'action.export',
    icon: 'export',
    group: 'file',
    shortcut: ['Ctrl+Alt+Shift+S'],
    run: () => {
      engine.commitLive();
      openDialog({ kind: 'export' });
    },
  },
  { id: 'print', labelKey: 'action.print', icon: 'print', group: 'file', shortcut: ['Ctrl+P'], run: () => files.printImage() },
  { id: 'properties', labelKey: 'file.properties', icon: 'properties', group: 'image', shortcut: ['Ctrl+E'], run: () => openDialog({ kind: 'properties' }) },
  // Edit
  { id: 'undo', labelKey: 'action.undo', icon: 'undo', group: 'edit', shortcut: ['Ctrl+Z'], run: () => engine.undo(), enabled: (s) => s.history.canUndo },
  { id: 'redo', labelKey: 'action.redo', icon: 'redo', group: 'edit', shortcut: ['Ctrl+Y', 'Ctrl+Shift+Z'], run: () => engine.redo(), enabled: (s) => s.history.canRedo },
  { id: 'cut', labelKey: 'action.cut', icon: 'cut', group: 'edit', shortcut: ['Ctrl+X'], run: () => files.cut(), enabled: hasSelection },
  { id: 'copy', labelKey: 'action.copy', icon: 'copy', group: 'edit', shortcut: ['Ctrl+C'], run: () => files.copy(), enabled: hasSelection },
  { id: 'copyImage', labelKey: 'action.copyImage', icon: 'copy-image', group: 'edit', shortcut: ['Ctrl+Shift+C'], run: () => files.copyImage() },
  { id: 'paste', labelKey: 'action.paste', icon: 'paste', group: 'edit', shortcut: ['Ctrl+V'], run: () => files.paste() },
  { id: 'pasteNew', labelKey: 'action.pasteNew', icon: 'paste-new', group: 'edit', shortcut: ['Ctrl+Alt+V'], run: () => files.pasteAsNew() },
  { id: 'pasteFromFile', labelKey: 'file.pasteFrom', icon: 'open', group: 'edit', run: () => files.pasteFromFile() },
  { id: 'selectAll', labelKey: 'action.selectAll', icon: 'select-all', group: 'edit', shortcut: ['Ctrl+A'], run: () => engine.selectAll() },
  { id: 'deselect', labelKey: 'action.selectNone', icon: 'deselect', group: 'edit', shortcut: ['Ctrl+D'], run: () => engine.deselect(), enabled: hasSelection },
  { id: 'invertSelection', labelKey: 'action.invertSelection', icon: 'invert-selection', group: 'edit', shortcut: ['Ctrl+Shift+A'], run: () => engine.invertSelection() },
  { id: 'colorRange', labelKey: 'action.colorRange', icon: 'picker', group: 'edit', run: () => selectionDialog({ kind: 'colorRange' }) },
  { id: 'feather', labelKey: 'action.feather', icon: 'feather', group: 'edit', shortcut: ['Shift+F6'], run: () => selectionDialog({ kind: 'modifySelection', op: 'feather' }), enabled: hasSelection },
  { id: 'grow', labelKey: 'action.grow', icon: 'fit-canvas', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'grow' }), enabled: hasSelection },
  { id: 'shrink', labelKey: 'action.shrink', icon: 'trim', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'shrink' }), enabled: hasSelection },
  { id: 'border', labelKey: 'action.border', icon: 'select', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'border' }), enabled: hasSelection },
  { id: 'saveSelection', labelKey: 'action.saveSelection', icon: 'save-selection', group: 'edit', run: () => selectionDialog({ kind: 'saveSelection' }), enabled: hasSelection },
  { id: 'loadSelection', labelKey: 'action.loadSelection', icon: 'load-selection', group: 'edit', run: () => selectionDialog({ kind: 'loadSelection' }), enabled: (s) => s.savedSelections.length > 0 },
  { id: 'delete', labelKey: 'action.delete', icon: 'delete', group: 'edit', shortcut: ['Delete'], run: () => engine.deleteSelection(), enabled: hasSelection },
  {
    id: 'transparentSelection',
    labelKey: 'action.transparentSelection',
    icon: 'transparent',
    group: 'edit',
    run: () => {
      const on = !useUi.getState().transparentSelection;
      engine.setTransparentSelection(on);
      useUi.setState({ transparentSelection: on });
    },
    checked: (s) => s.transparentSelection,
  },
  // Image
  { id: 'crop', labelKey: 'action.crop', icon: 'crop', group: 'image', shortcut: ['Ctrl+Shift+X'], run: safe(() => engine.crop()), enabled: hasSelection },
  { id: 'trim', labelKey: 'action.trim', icon: 'trim', group: 'image', run: safe(() => engine.trimTransparentEdges()) },
  { id: 'fitCanvas', labelKey: 'action.fitCanvas', icon: 'fit-canvas', group: 'image', run: safe(() => engine.fitCanvasToContents()) },
  { id: 'resize', labelKey: 'action.resizeSkew', icon: 'resize', group: 'image', shortcut: ['Ctrl+W'], run: () => openDialog({ kind: 'resize' }) },
  { id: 'canvasSize', labelKey: 'action.canvasSize', icon: 'canvas-size', group: 'image', shortcut: ['Ctrl+Shift+R'], run: () => openDialog({ kind: 'canvasSize' }) },
  { id: 'rotateCw', labelKey: 'action.rotateCw', icon: 'rotate-cw', group: 'image', shortcut: ['Ctrl+Period'], run: safe(() => engine.rotate(1)) },
  { id: 'rotateCcw', labelKey: 'action.rotateCcw', icon: 'rotate-ccw', group: 'image', shortcut: ['Ctrl+Comma'], run: safe(() => engine.rotate(3)) },
  { id: 'rotate180', labelKey: 'action.rotate180', icon: 'rotate-180', group: 'image', run: safe(() => engine.rotate(2)) },
  { id: 'rotateFree', labelKey: 'action.rotateFree', icon: 'rotate-free', group: 'image', run: () => openDialog({ kind: 'rotate' }) },
  { id: 'flipH', labelKey: 'action.flipH', icon: 'flip-h', group: 'image', run: safe(() => engine.flip('h')) },
  { id: 'flipV', labelKey: 'action.flipV', icon: 'flip-v', group: 'image', run: safe(() => engine.flip('v')) },
  { id: 'invertColors', labelKey: 'action.invertColors', icon: 'invert', group: 'image', shortcut: ['Ctrl+Shift+I'], run: () => engine.invertColors() },
  // View
  { id: 'zoomIn', labelKey: 'action.zoomIn', icon: 'zoom-in', group: 'view', shortcut: ['Ctrl+Plus', 'Plus'], run: () => engine.zoomStep(1) },
  { id: 'zoomOut', labelKey: 'action.zoomOut', icon: 'zoom-out', group: 'view', shortcut: ['Ctrl+Minus', 'Minus'], run: () => engine.zoomStep(-1) },
  { id: 'zoom100', labelKey: 'action.zoom100', icon: 'actual-size', group: 'view', shortcut: ['Ctrl+1'], run: () => engine.actualSize() },
  { id: 'zoomFit', labelKey: 'action.zoomFit', icon: 'fit', group: 'view', shortcut: ['Ctrl+0'], run: () => engine.fit() },
  { id: 'rulers', labelKey: 'action.rulers', icon: 'ruler', group: 'view', shortcut: ['Ctrl+R'], run: () => toggleView('rulers'), checked: (s) => s.settings.view.rulers },
  { id: 'gridlines', labelKey: 'action.gridlines', icon: 'grid', group: 'view', shortcut: ['Ctrl+G'], run: () => toggleView('gridlines'), checked: (s) => s.settings.view.gridlines },
  { id: 'pixelGrid', labelKey: 'action.pixelGrid', icon: 'pixel-grid', group: 'view', run: () => toggleView('pixelGrid'), checked: (s) => s.settings.view.pixelGrid },
  { id: 'statusBar', labelKey: 'action.statusBar', icon: 'status-bar', group: 'view', run: () => toggleView('statusBar'), checked: (s) => s.settings.view.statusBar },
  {
    id: 'fullscreen',
    labelKey: 'action.fullscreen',
    icon: 'fullscreen',
    group: 'view',
    shortcut: ['F11'],
    run: async () => {
      const full = await window.pigmento.window.toggleFullscreen();
      useUi.setState({ fullscreen: full });
    },
    checked: (s) => s.fullscreen,
  },
  {
    id: 'panels',
    labelKey: 'action.panels',
    icon: 'panel-right',
    group: 'view',
    shortcut: ['F6'],
    run: () => {
      const p = useUi.getState().settings.panels;
      updateSettings({ panels: { ...p, open: !p.open } });
    },
    checked: (s) => s.settings.panels.open,
  },
  {
    id: 'panelSide',
    labelKey: 'action.panelSide',
    icon: 'panel-left',
    group: 'view',
    run: () => {
      const p = useUi.getState().settings.panels;
      updateSettings({ panels: { ...p, side: p.side === 'left' ? 'right' : 'left' } });
    },
    checked: (s) => s.settings.panels.side === 'left',
  },
  { id: 'layersPanel', labelKey: 'action.layersPanel', icon: 'layers', group: 'view', run: () => togglePanel('layers'), checked: (s) => s.settings.panels.open && s.settings.panels.visible.layers !== false },
  { id: 'historyPanel', labelKey: 'action.historyPanel', icon: 'history', group: 'view', run: () => togglePanel('history'), checked: (s) => s.settings.panels.open && s.settings.panels.visible.history !== false },
  { id: 'navigatorPanel', labelKey: 'action.navigatorPanel', icon: 'navigator', group: 'view', run: () => togglePanel('navigator'), checked: (s) => s.settings.panels.open && s.settings.panels.visible.navigator !== false },
  { id: 'themeSystem', labelKey: 'action.themeSystem', icon: 'system', group: 'view', run: () => setThemeMode('system'), checked: (s) => s.settings.themeMode === 'system' },
  { id: 'themeLight', labelKey: 'action.themeLight', icon: 'sun', group: 'view', run: () => setThemeMode('light'), checked: (s) => s.settings.themeMode === 'light' },
  { id: 'themeDark', labelKey: 'action.themeDark', icon: 'moon', group: 'view', run: () => setThemeMode('dark'), checked: (s) => s.settings.themeMode === 'dark' },
  {
    id: 'windowsAccent',
    labelKey: 'action.windowsAccent',
    icon: 'accent',
    group: 'view',
    run: () => updateSettings({ useWindowsAccent: !useUi.getState().settings.useWindowsAccent }),
    checked: (s) => s.settings.useWindowsAccent,
  },
  // Layers
  { id: 'layerNew', labelKey: 'action.layerNew', icon: 'layer-add', group: 'image', shortcut: ['Ctrl+Shift+L'], run: () => void engine.layers.add() },
  { id: 'layerDuplicate', labelKey: 'action.layerDuplicate', icon: 'copy', group: 'image', shortcut: ['Ctrl+J'], run: () => void engine.layers.duplicate() },
  { id: 'layerDelete', labelKey: 'action.layerDelete', icon: 'delete', group: 'image', run: () => void engine.layers.remove(), enabled: (s) => s.layers.count > 0 && engine.layers.canRemove() },
  { id: 'layerMergeDown', labelKey: 'action.layerMergeDown', icon: 'merge', group: 'image', shortcut: ['Ctrl+Shift+E'], run: () => void engine.layers.mergeDown(), enabled: (s) => s.layers.count > 0 && engine.layers.canMergeDown() },
  { id: 'layerFlatten', labelKey: 'action.layerFlatten', icon: 'flatten', group: 'image', run: () => void engine.layers.flatten(), enabled: (s) => s.layers.count > 1 },
  { id: 'layerGroup', labelKey: 'action.layerGroup', icon: 'folder', group: 'image', shortcut: ['Ctrl+Alt+G'], run: () => void engine.layers.group() },
  { id: 'layerUngroup', labelKey: 'action.layerUngroup', icon: 'ungroup', group: 'image', shortcut: ['Ctrl+Alt+Shift+G'], run: () => void engine.layers.ungroup(), enabled: (s) => s.layers.count > 0 && engine.doc.activeLayer.kind === 'group' },
  { id: 'layerUp', labelKey: 'action.layerUp', icon: 'arrow-up', group: 'image', shortcut: ['Ctrl+]'], run: () => void engine.layers.step(engine.doc.activeId, 1) },
  { id: 'layerDown', labelKey: 'action.layerDown', icon: 'arrow-down', group: 'image', shortcut: ['Ctrl+['], run: () => void engine.layers.step(engine.doc.activeId, -1) },
  // Colours
  { id: 'swapColors', labelKey: 'action.swapColors', icon: 'swap', group: 'colors', shortcut: ['X'], run: () => engine.swapColors() },
  { id: 'resetColors', labelKey: 'action.resetColors', group: 'colors', shortcut: ['D'], run: () => engine.resetColors() },
  { id: 'editColors', labelKey: 'action.editColors', icon: 'palette', group: 'colors', run: () => openDialog({ kind: 'editColors', target: 'primary' }) },
  { id: 'brushSizeUp', labelKey: 'action.brushSizeUp', group: 'tools', shortcut: [']'], run: () => stepSize(1) },
  { id: 'brushSizeDown', labelKey: 'action.brushSizeDown', group: 'tools', shortcut: ['['], run: () => stepSize(-1) },
  // Help
  { id: 'shortcuts', labelKey: 'action.shortcuts', icon: 'keyboard', group: 'view', shortcut: ['Ctrl+Slash', 'F1'], run: () => openDialog({ kind: 'shortcuts' }) },
  { id: 'about', labelKey: 'action.about', icon: 'info', group: 'view', run: () => openDialog({ kind: 'about' }) },
];

/** One action per theme family (the variant follows the Light/Dark/Match Windows mode). */
function themeActions(): Action[] {
  return THEME_FAMILIES.map((f) => ({
    id: `theme.${f.id}`,
    labelKey: f.labelKey,
    icon: f.id === 'contrast' ? 'contrast' : 'palette',
    group: 'view' as const,
    run: () => updateSettings({ theme: f.id }),
    checked: (s: UiState) => s.settings.theme === f.id,
  }));
}

/** One action per registered tool, with its letter shortcut. */
function toolActions(): Action[] {
  return toolRegistry.all().map((tool) => ({
    id: `tool.${tool.id}`,
    labelKey: tool.labelKey,
    icon: tool.icon,
    group: 'tools' as const,
    shortcut: tool.shortcut ? [tool.shortcut.toUpperCase()] : undefined,
    run: () => engine.setTool(tool.id),
    checked: (s: UiState) => s.tool === tool.id,
  }));
}

let cache: Map<string, Action> | null = null;

export function actions(): Map<string, Action> {
  if (!cache) cache = new Map([...base, ...themeActions(), ...toolActions()].map((a) => [a.id, a]));
  return cache;
}

export function action(id: string): Action {
  const a = actions().get(id);
  if (!a) throw new Error(`Unknown action ${id}`);
  return a;
}

export function runAction(id: string): void {
  const a = action(id);
  if (a.enabled && !a.enabled(useUi.getState())) return;
  void Promise.resolve(a.run()).catch((err: unknown) => reportEngineError(engine, err));
}

