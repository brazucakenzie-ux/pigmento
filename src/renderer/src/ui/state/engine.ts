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
  kind === 'copy' ? t('layer.copy', { name: String(arg) }) : t(kind === 'group' ? 'layer.group' : 'layer.default', { n: arg });

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
  engine.setViewOptions({
    pixelGrid: settings.view.pixelGrid,
    gridlines: settings.view.gridlines,
    gridSize: settings.view.gridSize,
  });

  useUi.setState({
    doc: engine.docInfo(),
    history: engine.historyInfo(),
    view: engine.view.state(),
    tool: engine.activeToolIdValue,
    toolOptions: { ...engine.allToolOptions() },
    colors: { primary: engine.primary, secondary: engine.secondary },
    layers: engine.layers.info(),
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

  engine.on('tool', ({ id }) => {
    useUi.setState({ tool: id });
    updateSettings({ activeTool: id });
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
