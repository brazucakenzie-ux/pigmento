import '@engine/tools/builtin';
import { Engine } from '@engine/Engine';
import { parseHex, toHex8 } from '@engine/core/color';
import type { Settings } from '@shared/settings';
import { t } from '../../i18n';
import { showToast, updateSettings, useUi } from './store';

/** The single engine instance for this window. */
export const engine = new Engine();

// The engine stores user-visible names but never English text: the UI provides them.
engine.layers.namer = (kind, arg) =>
  kind === 'copy'
    ? t('layer.copy', { name: String(arg) })
    : t(kind === 'group' ? 'layer.group' : kind === 'shapes' ? 'layer.shapes' : 'layer.default', { n: arg });
engine.anim.namer = (n, kind) => t(kind === 'group' ? 'piece.groupName' : 'piece.defaultName', { n });
engine.anim.faceNamer = (face) => t(`box.${face}`);
// The start-up document was created before the namer existed.
for (const l of engine.doc.layers) if (!l.name) l.name = engine.layers.namer('layer', 1);

/** The engine's onion skin from the saved animation settings. */
export function onionOf(a: Settings['anim']): { count: number; opacity: number } | null {
  return a.onion ? { count: a.onionCount, opacity: a.onionOpacity } : null;
}

/** The engine's view options from the saved View settings. */
export function viewOptionsOf(v: Settings['view']): Parameters<typeof engine.setViewOptions>[0] {
  return {
    pixelGrid: v.pixelGrid,
    gridlines: v.gridlines,
    gridSize: v.gridSize,
    showGuides: v.showGuides,
    lockGuides: v.lockGuides,
    snap: v.snap,
    snapGrid: v.snapGrid,
    snapGuides: v.snapGuides,
    snapCanvas: v.snapCanvas,
    snapObjects: v.snapObjects,
    piecesOutside: v.piecesOutside,
    perspectiveGrid: v.perspectiveGrid,
  };
}

let bound = false;

/** Mirror engine events into the UI store and persist tool/colour preferences. */
export function bindEngine(settings: Settings): void {
  if (bound) return;
  bound = true;

  engine.loadToolOptions(settings.tools);
  const p = parseHex(settings.colors.primary);
  const s = parseHex(settings.colors.secondary);
  if (p) engine.setPrimary(p);
  if (s) engine.setSecondary(s);
  if (engine.tools.has(settings.activeTool)) engine.setTool(settings.activeTool);
  engine.setViewOptions(viewOptionsOf(settings.view));
  engine.setOnionSkin(onionOf(settings.anim));
  engine.setSymmetry({ mode: settings.drawing.symmetry, segments: settings.drawing.segments });

  useUi.setState({
    doc: engine.docInfo(),
    history: engine.historyInfo(),
    view: engine.view.state(),
    tool: engine.activeToolIdValue,
    toolOptions: { ...engine.allToolOptions() },
    colors: { primary: engine.primary, secondary: engine.secondary },
    layers: engine.layers.info(),
    savedSelections: engine.savedSelectionsInfo(),
    transform: engine.transformInfo(),
    patterns: engine.patternsInfo(),
    guides: engine.doc.guides.length,
    vectorSelection: engine.vectorSelectionInfo(),
  });

  engine.on('doc', (doc) => useUi.setState({ doc }));
  engine.on('history', (history) => useUi.setState({ history }));
  engine.on('view', (view) => useUi.setState({ view }));
  engine.on('cursor', (cursor) => useUi.setState({ cursor }));
  engine.on('selection', (selection) => useUi.setState({ selection }));
  engine.on('live', ({ kind }) => useUi.setState({ live: kind }));
  engine.on('text', (text) => useUi.setState({ text }));
  engine.on('hint', ({ key }) => useUi.setState({ hint: key }));
  engine.on('canvasDrag', (canvasDrag) => useUi.setState({ canvasDrag }));
  engine.on('notice', (n) => showToast(n));
  engine.on('layers', (layers) => useUi.setState({ layers }));
  engine.on('savedSelections', (savedSelections) => useUi.setState({ savedSelections }));
  engine.on('transform', (transform) => useUi.setState({ transform }));
  engine.on('path', (path) => useUi.setState({ path }));
  engine.on('patterns', (patterns) => useUi.setState({ patterns }));
  engine.on('guides', (guides) => useUi.setState({ guides }));
  engine.on('reference', (reference) => useUi.setState({ reference }));
  engine.on('animation', (animation) => useUi.setState({ animation }));
  engine.on('symmetry', (symmetry) => {
    useUi.setState({ symmetry });
    // Mode and segments are remembered; the centre belongs to the image.
    const d = useUi.getState().settings.drawing;
    if (d.symmetry !== symmetry.mode || d.segments !== symmetry.segments) updateSettings({ drawing: { symmetry: symmetry.mode, segments: symmetry.segments } });
  });
  engine.on('vectorSelection', (vectorSelection) => useUi.setState({ vectorSelection }));

  engine.on('tool', ({ id }) => {
    useUi.setState({ tool: id });
    // Modes like free transform aren't remembered as the tool to start with.
    if (!engine.tools.get(id)?.hidden) updateSettings({ activeTool: id });
  });

  let toolSave = 0;
  engine.on('toolOptions', ({ toolId, values }) => {
    useUi.setState((st) => ({ toolOptions: { ...st.toolOptions, [toolId]: values } }));
    window.clearTimeout(toolSave);
    toolSave = window.setTimeout(() => updateSettings({ tools: { ...engine.allToolOptions() } }), 300);
  });

  engine.on('colors', ({ primary, secondary }) => {
    useUi.setState({ colors: { primary, secondary } });
    const cur = useUi.getState().settings.colors;
    updateSettings({ colors: { ...cur, primary: toHex8(primary), secondary: toHex8(secondary) } });
  });
}
