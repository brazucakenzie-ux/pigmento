import { exportSvgFile, importSvgFile } from '../services/svg';
import { exportShapePack, hasCustomShapes, importShapePack } from '../services/shapes';
import { brushTarget, duplicateBrush, exportBrushPack, hasCustomBrushes, importBrushPack, isCustomBrush } from '../services/brushes';
import type { ThemeMode } from '@shared/settings';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { reportEngineError } from '@engine/input/InputController';
import type { I18nKey } from '../../i18n';
import { engine, viewOptionsOf } from '../state/engine';
import { openDialog, updateSettings, useUi, type UiState } from '../state/store';
import * as files from '../services/files';
import { makePatternFromSelection } from '../services/patterns';
import { openFilter } from '../services/filters';
import { loadReference } from '../services/reference';
import { hasMemoryFor } from '../services/memory';
import { filterRegistry } from '@engine/filters/FilterRegistry';
import { THEME_FAMILIES } from '../theme/themes';

export type ActionGroup = 'file' | 'edit' | 'view' | 'tools' | 'image' | 'colors' | 'animation';

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
  /** Left out of the shortcuts list (a hidden developer shortcut). */
  hidden?: boolean;
}

const hasSelection = (s: UiState) => s.selection.bounds !== null;
/** The active layer holds pixels (frame-by-frame drawings are only for pixel layers). */
const rasterActive = (s: UiState) => findLayerKind(s.layers.tree, s.layers.activeId) === 'raster';
/** The brush the brush commands act on is a personal one (the library counter changes with it). */
const customBrush = (s: UiState) => s.brushLibrary >= 0 && isCustomBrush(brushTarget(s).brushId);
/** At least n objects selected on the active shape layer. */
const hasShapes = (n: number) => (s: UiState) => s.vectorSelection.count >= n;

/** Open a selection dialog with floating pixels put down first (their selection stays). */
function selectionDialog(d: Parameters<typeof openDialog>[0]): void {
  engine.commitLive(true);
  openDialog(d);
}

function findLayerKind(tree: UiState['layers']['tree'], id: string): string | null {
  for (const n of tree) {
    if (n.id === id) return n.kind;
    const k = findLayerKind(n.children, id);
    if (k) return k;
  }
  return null;
}

/**
 * A new drawing (blank or a copy) at the current frame, once there's memory for one: a drawing
 * can grow to the size of a whole layer, so a huge picture says so instead of running out.
 */
export async function addDrawing(layerId: string, copy: boolean): Promise<boolean> {
  if (!(await hasMemoryFor(engine.doc.width, engine.doc.height))) return false;
  return engine.anim.newDrawing(layerId, copy);
}

function toggleTimeline(): void {
  const anim = useUi.getState().settings.anim;
  updateSettings({ anim: { ...anim, timeline: !anim.timeline } });
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

type ViewToggle = 'rulers' | 'gridlines' | 'pixelGrid' | 'statusBar' | 'showGuides' | 'lockGuides' | 'snap' | 'snapGrid' | 'snapGuides' | 'snapCanvas' | 'snapObjects';

function toggleView(key: ViewToggle): void {
  const v = useUi.getState().settings.view;
  const next = { ...v, [key]: !v[key] };
  // Picking something to snap to turns snapping on.
  if (key.startsWith('snap') && key !== 'snap' && next[key]) next.snap = true;
  updateSettings({ view: next });
  engine.setViewOptions(viewOptionsOf(next));
}

const viewToggle = (id: string, labelKey: I18nKey, key: ViewToggle, icon?: string, shortcut?: string[]): Action => ({
  id,
  labelKey,
  icon,
  group: 'view',
  shortcut,
  run: () => toggleView(key),
  checked: (s) => s.settings.view[key],
});

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
  { id: 'feather', labelKey: 'action.feather', icon: 'feather', group: 'edit', shortcut: ['Ctrl+Alt+D'], run: () => selectionDialog({ kind: 'modifySelection', op: 'feather' }), enabled: hasSelection },
  { id: 'grow', labelKey: 'action.grow', icon: 'fit-canvas', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'grow' }), enabled: hasSelection },
  { id: 'shrink', labelKey: 'action.shrink', icon: 'trim', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'shrink' }), enabled: hasSelection },
  { id: 'border', labelKey: 'action.border', icon: 'select', group: 'edit', run: () => selectionDialog({ kind: 'modifySelection', op: 'border' }), enabled: hasSelection },
  { id: 'definePattern', labelKey: 'action.definePattern', icon: 'fill', group: 'edit', run: async () => void (await makePatternFromSelection()), enabled: hasSelection },
  { id: 'saveSelection', labelKey: 'action.saveSelection', icon: 'save-selection', group: 'edit', run: () => selectionDialog({ kind: 'saveSelection' }), enabled: hasSelection },
  { id: 'loadSelection', labelKey: 'action.loadSelection', icon: 'load-selection', group: 'edit', run: () => selectionDialog({ kind: 'loadSelection' }), enabled: (s) => s.savedSelections.length > 0 },
  { id: 'delete', labelKey: 'action.delete', icon: 'delete', group: 'edit', shortcut: ['Delete'], run: () => engine.deleteSelection(), enabled: (s) => hasSelection(s) || s.vectorSelection.count > 0 },
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
  // Animation
  {
    id: 'animateSelection',
    labelKey: 'action.animateSelection',
    icon: 'animate',
    group: 'animation',
    // Straight on to the Animate tool, with the new piece selected and the timeline showing.
    run: safe(() => {
      const anim = useUi.getState().settings.anim;
      if (!engine.animateSelection(anim.keepOriginal)) return;
      engine.setTool('animate');
      if (!anim.timeline) updateSettings({ anim: { ...anim, timeline: true } });
    }),
    enabled: hasSelection,
  },
  {
    id: 'animKeepOriginal',
    labelKey: 'action.animKeepOriginal',
    icon: 'keep-original',
    group: 'animation',
    run: () => updateSettings({ anim: { ...useUi.getState().settings.anim, keepOriginal: !useUi.getState().settings.anim.keepOriginal } }),
    checked: (s) => s.settings.anim.keepOriginal,
  },
  { id: 'timeline', labelKey: 'action.timeline', icon: 'timeline', group: 'view', run: () => toggleTimeline(), checked: (s) => s.settings.anim.timeline },
  {
    id: 'exportAnimation',
    labelKey: 'action.exportAnimation',
    icon: 'timeline',
    group: 'animation',
    run: () => {
      engine.commitLive();
      openDialog({ kind: 'exportAnimation' });
    },
    enabled: (s) => s.animation.pieces.length > 0,
  },
  // Frame-by-frame drawings on the active pixel layer, at the frame shown.
  { id: 'newDrawing', labelKey: 'action.newDrawing', icon: 'new', group: 'animation', run: () => void addDrawing(engine.doc.activeId, false), enabled: rasterActive },
  { id: 'copyDrawing', labelKey: 'action.copyDrawing', icon: 'copy', group: 'animation', run: () => void addDrawing(engine.doc.activeId, true), enabled: rasterActive },
  { id: 'clearDrawing', labelKey: 'action.clearDrawing', icon: 'eraser', group: 'animation', run: () => void engine.anim.clearDrawing(engine.doc.activeId), enabled: rasterActive },
  { id: 'deleteDrawing', labelKey: 'action.deleteDrawing', icon: 'delete', group: 'animation', run: () => void engine.anim.deleteDrawing(engine.doc.activeId), enabled: (s) => s.animation.cels[s.layers.activeId] !== undefined },
  { id: 'animPlay', labelKey: 'action.animPlay', icon: 'play', group: 'animation', shortcut: ['Ctrl+Space'], run: () => engine.anim.togglePlay(), checked: (s) => s.animation.playing },
  { id: 'animFirstFrame', labelKey: 'action.animFirstFrame', icon: 'frame-first', group: 'animation', run: () => engine.anim.setFrame(0) },
  { id: 'animPrevFrame', labelKey: 'action.animPrevFrame', icon: 'frame-prev', group: 'animation', shortcut: ['Comma'], run: () => engine.anim.setFrame(engine.anim.frame - 1) },
  { id: 'animNextFrame', labelKey: 'action.animNextFrame', icon: 'frame-next', group: 'animation', shortcut: ['Period'], run: () => engine.anim.setFrame(engine.anim.frame + 1) },
  { id: 'animLastFrame', labelKey: 'action.animLastFrame', icon: 'frame-last', group: 'animation', run: () => engine.anim.setFrame(engine.anim.timeline.length - 1) },
  { id: 'animPrevKey', labelKey: 'action.animPrevKey', icon: 'keyframe', group: 'animation', shortcut: ['Shift+Comma'], run: () => engine.anim.stepKey(-1) },
  { id: 'animNextKey', labelKey: 'action.animNextKey', icon: 'keyframe', group: 'animation', shortcut: ['Shift+Period'], run: () => engine.anim.stepKey(1) },
  { id: 'freeTransform', labelKey: 'action.freeTransform', icon: 'transform', group: 'image', shortcut: ['Ctrl+T'], run: safe(() => void engine.freeTransform()) },
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
  viewToggle('guides', 'action.guides', 'showGuides', 'guides', ['Ctrl+;']),
  viewToggle('lockGuides', 'action.lockGuides', 'lockGuides', 'lock'),
  { id: 'clearGuides', labelKey: 'action.clearGuides', icon: 'delete', group: 'view', run: () => engine.clearGuides(), enabled: (s) => s.guides > 0 },
  viewToggle('snap', 'action.snap', 'snap', 'magnet'),
  viewToggle('snapGrid', 'action.snapGrid', 'snapGrid', 'grid'),
  viewToggle('snapGuides', 'action.snapGuides', 'snapGuides', 'guides'),
  viewToggle('snapCanvas', 'action.snapCanvas', 'snapCanvas', 'canvas-size'),
  viewToggle('snapObjects', 'action.snapObjects', 'snapObjects', 'layers'),
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
  // Shape layers
  { id: 'newShapeLayer', labelKey: 'action.newShapeLayer', icon: 'shapes', group: 'image', run: () => void engine.newShapeLayer() },
  { id: 'rasterizeLayer', labelKey: 'action.rasterizeLayer', icon: 'pixel-grid', group: 'image', run: () => void engine.rasterizeActiveLayer(), enabled: (s) => s.layers.count > 0 && engine.doc.activeLayer.kind === 'vector' },
  { id: 'alignLeft', labelKey: 'action.alignLeft', icon: 'shape-align-left', group: 'image', run: () => engine.alignVector('left'), enabled: hasShapes(1) },
  { id: 'alignHCenter', labelKey: 'action.alignHCenter', icon: 'shape-align-hcenter', group: 'image', run: () => engine.alignVector('hcenter'), enabled: hasShapes(1) },
  { id: 'alignRight', labelKey: 'action.alignRight', icon: 'shape-align-right', group: 'image', run: () => engine.alignVector('right'), enabled: hasShapes(1) },
  { id: 'alignTop', labelKey: 'action.alignTop', icon: 'shape-align-top', group: 'image', run: () => engine.alignVector('top'), enabled: hasShapes(1) },
  { id: 'alignVCenter', labelKey: 'action.alignVCenter', icon: 'shape-align-vcenter', group: 'image', run: () => engine.alignVector('vcenter'), enabled: hasShapes(1) },
  { id: 'alignBottom', labelKey: 'action.alignBottom', icon: 'shape-align-bottom', group: 'image', run: () => engine.alignVector('bottom'), enabled: hasShapes(1) },
  { id: 'distributeH', labelKey: 'action.distributeH', icon: 'distribute-h', group: 'image', run: () => engine.distributeVector('x'), enabled: hasShapes(3) },
  { id: 'distributeV', labelKey: 'action.distributeV', icon: 'distribute-v', group: 'image', run: () => engine.distributeVector('y'), enabled: hasShapes(3) },
  { id: 'bringToFront', labelKey: 'action.bringToFront', icon: 'front', group: 'image', run: () => engine.arrangeVector('front'), enabled: hasShapes(1) },
  { id: 'bringForward', labelKey: 'action.bringForward', icon: 'bring-forward', group: 'image', run: () => engine.arrangeVector('forward'), enabled: hasShapes(1) },
  { id: 'sendBackward', labelKey: 'action.sendBackward', icon: 'send-backward', group: 'image', run: () => engine.arrangeVector('backward'), enabled: hasShapes(1) },
  { id: 'sendToBack', labelKey: 'action.sendToBack', icon: 'back', group: 'image', run: () => engine.arrangeVector('back'), enabled: hasShapes(1) },
  { id: 'groupShapes', labelKey: 'action.groupShapes', icon: 'group', group: 'image', run: () => engine.groupVector(), enabled: hasShapes(2) },
  {
    id: 'convertToPath',
    labelKey: 'action.convertToPath',
    icon: 'pen',
    group: 'image',
    run: () => engine.convertVectorToPath(),
    enabled: (s) => s.vectorSelection.count > s.vectorSelection.groups,
  },
  {
    id: 'selectionToShape',
    labelKey: 'action.selectionToShape',
    icon: 'shapes',
    group: 'image',
    run: () => void engine.selectionToShape(),
    enabled: (s) => s.selection.bounds !== null,
  },
  { id: 'importSvg', labelKey: 'action.importSvg', icon: 'open', group: 'file', run: () => void importSvgFile() },
  { id: 'exportSvg', labelKey: 'action.exportSvg', icon: 'export', group: 'file', run: () => void exportSvgFile() },
  { id: 'importShapePack', labelKey: 'action.importShapePack', icon: 'open', group: 'file', run: () => void importShapePack() },
  // Enabled once My shapes has something in it (the library counter changes with it).
  { id: 'exportShapePack', labelKey: 'action.exportShapePack', icon: 'export', group: 'file', run: () => void exportShapePack(), enabled: (s) => s.shapeLibrary >= 0 && hasCustomShapes() },
  {
    id: 'saveShape',
    labelKey: 'action.saveShape',
    icon: 'star',
    group: 'image',
    run: () => openDialog({ kind: 'saveShape' }),
    // One shape selected, or a shape or finished path being edited.
    enabled: (s) => (s.live === 'shape' && !s.path?.drawing) || (s.vectorSelection.count === 1 && s.vectorSelection.groups === 0),
  },
  // Brushes: the active brush tool's brush (or the Brush's)
  { id: 'newBrush', labelKey: 'action.newBrush', icon: 'plus', group: 'tools', run: () => openDialog({ kind: 'brushDesigner', from: brushTarget().brushId }) },
  { id: 'editBrush', labelKey: 'action.editBrush', icon: 'brush', group: 'tools', run: () => openDialog({ kind: 'brushDesigner', id: brushTarget().brushId }), enabled: customBrush },
  {
    id: 'duplicateBrush',
    labelKey: 'action.duplicateBrush',
    icon: 'copy',
    group: 'tools',
    run: () => {
      const b = brushTarget();
      void duplicateBrush(b.brushId, b.toolId);
    },
    enabled: customBrush,
  },
  { id: 'deleteBrush', labelKey: 'action.deleteBrush', icon: 'delete', group: 'tools', run: () => openDialog({ kind: 'deleteBrush', id: brushTarget().brushId }), enabled: customBrush },
  { id: 'strokeSelection', labelKey: 'action.strokeSelection', icon: 'select', group: 'image', run: () => selectionDialog({ kind: 'strokeOutline', source: 'selection' }), enabled: hasSelection },
  { id: 'strokePath', labelKey: 'action.strokePath', icon: 'pen', group: 'image', run: () => openDialog({ kind: 'strokeOutline', source: 'path' }), enabled: (s) => s.vectorSelection.count > 0 || s.live === 'shape' },
  // View: turning it, and a reference image
  { id: 'rotateViewLeft', labelKey: 'action.rotateViewLeft', icon: 'rotate-ccw', group: 'view', shortcut: ['Ctrl+Alt+ArrowLeft'], run: () => engine.rotateViewBy(-15) },
  { id: 'rotateViewRight', labelKey: 'action.rotateViewRight', icon: 'rotate-cw', group: 'view', shortcut: ['Ctrl+Alt+ArrowRight'], run: () => engine.rotateViewBy(15) },
  { id: 'resetViewRotation', labelKey: 'action.resetViewRotation', icon: 'rotate-view', group: 'view', shortcut: ['Ctrl+Alt+0'], run: () => engine.setViewRotation(0), enabled: (s) => s.view.rotation !== 0 },
  { id: 'loadReference', labelKey: 'action.loadReference', icon: 'reference', group: 'view', run: () => void loadReference() },
  {
    id: 'toggleReference',
    labelKey: 'action.toggleReference',
    icon: 'eye',
    group: 'view',
    run: () => {
      const visible = !(useUi.getState().reference?.visible ?? true);
      engine.setToolOption('reference', 'visible', visible);
      engine.updateReference({ visible });
    },
    enabled: (s) => s.reference !== null,
    checked: (s) => s.reference?.visible === true,
  },
  { id: 'removeReference', labelKey: 'action.removeReference', icon: 'delete', group: 'view', run: () => engine.clearReference(), enabled: (s) => s.reference !== null },
  {
    id: 'simpleMode',
    labelKey: 'action.simpleMode',
    icon: 'simple-mode',
    group: 'view',
    run: () => {
      const ui = useUi.getState().settings.ui;
      updateSettings({ ui: { ...ui, mode: ui.mode === 'simple' ? 'full' : 'simple' } });
    },
    checked: (s) => s.settings.ui.mode === 'simple',
  },
  { id: 'userGuide', labelKey: 'help.guide', icon: 'help', group: 'view', run: () => openDialog({ kind: 'userGuide' }) },
  { id: 'welcomeTour', labelKey: 'action.welcomeTour', icon: 'tour', group: 'view', run: () => useUi.setState({ tour: true }) },
  { id: 'settings', labelKey: 'action.settings', icon: 'settings', group: 'file', shortcut: ['Ctrl+Alt+S'], run: () => openDialog({ kind: 'settings' }) },
  {
    id: 'perfOverlay',
    labelKey: 'action.perfOverlay',
    group: 'view',
    shortcut: ['Ctrl+Alt+Shift+P'],
    hidden: true,
    run: () => useUi.setState((s) => ({ perfOverlay: !s.perfOverlay })),
    checked: (s) => s.perfOverlay,
  },
  { id: 'importBrushPack', labelKey: 'action.importBrushPack', icon: 'open', group: 'file', run: () => void importBrushPack() },
  // Enabled once My brushes has something in it.
  { id: 'exportBrushPack', labelKey: 'action.exportBrushPack', icon: 'export', group: 'file', run: () => void exportBrushPack(), enabled: (s) => s.brushLibrary >= 0 && hasCustomBrushes() },
  { id: 'ungroupShapes', labelKey: 'action.ungroupShapes', icon: 'ungroup', group: 'image', run: () => engine.ungroupVector(), enabled: (s) => s.vectorSelection.groups > 0 },
  // Colours
  { id: 'swapColors', labelKey: 'action.swapColors', icon: 'swap', group: 'colors', shortcut: ['X'], run: () => engine.swapColors() },
  { id: 'resetColors', labelKey: 'action.resetColors', group: 'colors', shortcut: ['D'], run: () => engine.resetColors() },
  { id: 'editColors', labelKey: 'action.editColors', icon: 'palette', group: 'colors', run: () => openDialog({ kind: 'editColors', target: 'primary' }) },
  { id: 'brushSizeUp', labelKey: 'action.brushSizeUp', group: 'tools', shortcut: [']', 'Mouse5'], run: () => stepSize(1) },
  { id: 'brushSizeDown', labelKey: 'action.brushSizeDown', group: 'tools', shortcut: ['[', 'Mouse4'], run: () => stepSize(-1) },
  // Help
  { id: 'shortcuts', labelKey: 'action.shortcuts', icon: 'keyboard', group: 'view', shortcut: ['Ctrl+Slash', 'F1'], run: () => openDialog({ kind: 'shortcuts' }) },
  { id: 'about', labelKey: 'action.about', icon: 'info', group: 'view', run: () => openDialog({ kind: 'about' }) },
];

/** One action per adjustment and filter (Effects tab). Settings-less ones apply at once. */
function filterActions(): Action[] {
  return filterRegistry.all().map((d) => ({
    id: `filter.${d.id}`,
    labelKey: `action.filter.${d.id}` as I18nKey,
    icon: d.icon,
    group: 'image' as const,
    run: () => void openFilter(d.id),
  }));
}

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
  return toolRegistry.all().filter((tool) => !tool.hidden).map((tool) => ({
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
  if (!cache) cache = new Map([...base, ...themeActions(), ...toolActions(), ...filterActions()].map((a) => [a.id, a]));
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

