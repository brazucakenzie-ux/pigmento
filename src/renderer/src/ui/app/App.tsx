import { useEffect, useLayoutEffect } from 'react';
import { t } from '../../i18n';
import { handleGlobalKey, handleGlobalPointer } from '../actions/keymap';
import { TooltipLayer } from '../components/Tooltips';
import { AboutDialog, EditColorsDialog, PasteLargerDialog, QualityDialog, RecoverDialog, ShortcutsDialog } from '../dialogs/OtherDialogs';
import { clearOwnAutosave, offerRecovery, startAutosave } from '../services/autosave';
import { CanvasSizeDialog, NewImageDialog, PropertiesDialog, ResizeDialog, RotateDialog } from '../dialogs/ImageDialogs';
import { ExportDialog } from '../dialogs/ExportDialog';
import { GradientDialog } from '../dialogs/GradientDialog';
import { FilterDialog } from '../dialogs/FilterDialog';
import { DeleteShapeDialog, SaveShapeDialog } from '../dialogs/ShapeDialogs';
import { loadCustomShapes } from '../services/shapes';
import { loadCustomBrushes } from '../services/brushes';
import { BrushDesignerDialog, DeleteBrushDialog, StrokeOutlineDialog } from '../dialogs/BrushDesigner';
import { loadSavedPatterns } from '../services/patterns';
import { ColorRangeDialog, LoadSelectionDialog, ModifySelectionDialog, SaveSelectionDialog } from '../dialogs/SelectionDialogs';
import { confirmDiscard, openPath } from '../services/files';
import { bindEngine, engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';
import { applyTheme, resolveTheme, schemeFor } from '../theme/themes';
import { CanvasArea } from './CanvasArea';
import { OptionsBar } from './OptionsBar';
import { Ribbon } from './Ribbon';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';
import { installTestHook } from './testHook';

function rgbToHex(css: string): string {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (!m) return css.startsWith('#') ? css.slice(0, 7) : '#808080';
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Resolve a CSS custom property to a concrete colour (handles system colours too). */
function resolveColor(varName: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${varName})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}

function useTheme(): void {
  const family = useUi((s) => s.settings.theme);
  const mode = useUi((s) => s.settings.themeMode);
  const useAccent = useUi((s) => s.settings.useWindowsAccent);
  const system = useUi((s) => s.system);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const forced = window.matchMedia('(forced-colors: active)').matches;
    const resolved = resolveTheme(family, schemeFor(mode, system.dark), useAccent ? system.accent : null);
    applyTheme(root, resolved, forced);
    // Canvas colours and the native caption buttons follow the theme.
    const top = rgbToHex(resolveColor('--bg-top'));
    const text = rgbToHex(resolveColor('--text'));
    void window.pigmento.window.setTitleBarOverlay(top, text, 40);
    const saved = useUi.getState().settings.chrome;
    if (!forced && (saved?.bg !== top || saved?.fg !== text)) updateSettings({ chrome: { bg: top, fg: text } });
    engine.setTheme(
      {
        workspace: resolveColor('--bg-workspace'),
        shadow: resolveColor('--page-shadow'),
        checkerA: resolveColor('--checker-a'),
        checkerB: resolveColor('--checker-b'),
        pixelGrid: resolveColor('--pixel-grid'),
      },
      {
        accent: resolveColor('--accent'),
        handleStroke: resolveColor('--accent'),
        handleFill: '#ffffff',
        grid: resolveColor('--grid-line'),
      },
    );
  }, [family, mode, useAccent, system]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      engine.reducedMotion = mq.matches;
    };
    apply();
    mq.addEventListener('change', apply);
    const fc = window.matchMedia('(forced-colors: active)');
    const refresh = () => useUi.setState((s) => ({ system: { ...s.system } }));
    fc.addEventListener('change', refresh);
    return () => {
      mq.removeEventListener('change', apply);
      fc.removeEventListener('change', refresh);
    };
  }, []);
}

function DialogHost() {
  const d = useUi((s) => s.dialog);
  if (!d) return null;
  switch (d.kind) {
    case 'new':
      return <NewImageDialog />;
    case 'resize':
      return <ResizeDialog />;
    case 'canvasSize':
      return <CanvasSizeDialog />;
    case 'rotate':
      return <RotateDialog />;
    case 'properties':
      return <PropertiesDialog />;
    case 'editColors':
      return <EditColorsDialog target={d.target} />;
    case 'quality':
      return <QualityDialog d={d} />;
    case 'pasteLarger':
      return <PasteLargerDialog d={d} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'recover':
      return <RecoverDialog items={d.items} />;
    case 'export':
      return <ExportDialog />;
    case 'modifySelection':
      return <ModifySelectionDialog op={d.op} />;
    case 'colorRange':
      return <ColorRangeDialog />;
    case 'saveSelection':
      return <SaveSelectionDialog />;
    case 'loadSelection':
      return <LoadSelectionDialog />;
    case 'gradient':
      return <GradientDialog toolId={d.toolId ?? 'gradient'} optKey={d.optKey ?? 'stops'} />;
    case 'saveShape':
      return <SaveShapeDialog id={d.id} />;
    case 'deleteShape':
      return <DeleteShapeDialog id={d.id} />;
    case 'brushDesigner':
      return <BrushDesignerDialog id={d.id} from={d.from} />;
    case 'deleteBrush':
      return <DeleteBrushDialog id={d.id} />;
    case 'filter':
      return <FilterDialog key={d.id} id={d.id} />;
    case 'strokeOutline':
      return <StrokeOutlineDialog source={d.source} />;
  }
}

async function loadFonts(): Promise<void> {
  try {
    const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
    if (!q) return;
    const list = await q();
    const families = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
    if (families.length > 0) useUi.setState({ fonts: families });
  } catch {
    // Permission denied or unsupported: the options bar falls back to common Windows fonts.
  }
}

export function App() {
  const ready = useUi((s) => s.ready);
  const panelsLeft = useUi((s) => s.settings.panels.side === 'left');
  const statusBar = useUi((s) => s.settings.view.statusBar);
  const name = useUi((s) => s.file.name);
  const dirty = useUi((s) => s.history.dirty);
  useTheme();

  useEffect(() => {
    let cancelled = false;
    const api = window.pigmento;
    void (async () => {
      const [settings, system, recent, info] = await Promise.all([
        api.settings.get(),
        api.system.getTheme(),
        api.recent.list(),
        api.system.appInfo(),
      ]);
      if (cancelled) return;
      useUi.setState({ settings, system, recent });
      bindEngine(settings);
      if (info.isE2E) installTestHook();
      useUi.setState({ ready: true });
      void loadFonts();
      void loadSavedPatterns();
      void loadCustomShapes();
      void loadCustomBrushes();
      startAutosave();
      const launch = await api.window.getLaunchFile();
      if (launch) await openPath(launch, true);
      await offerRecovery();
    })();
    const offs = [
      api.system.onThemeChanged((system) => useUi.setState({ system })),
      api.recent.onChanged((recent) => useUi.setState({ recent })),
      api.window.onFullscreenChanged((fullscreen) => useUi.setState({ fullscreen })),
      api.window.onOpenFile((path) => void openPath(path)),
      api.window.onCloseRequested(() => {
        void (async () => {
          engine.commitLive();
          if (await confirmDiscard()) {
            allowUnload = true;
            await clearOwnAutosave();
            await api.window.close();
          }
        })();
      }),
    ];
    // Safety net: nothing may unload a window with unsaved work except the checked close path.
    let allowUnload = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!allowUnload && useUi.getState().history.dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', handleGlobalKey);
    // Capture phase: the canvas never sees the side buttons, so they can't start a stroke.
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) window.addEventListener(type, handleGlobalPointer, true);
    return () => {
      cancelled = true;
      offs.forEach((off) => off());
      window.removeEventListener('keydown', handleGlobalKey);
      for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) window.removeEventListener(type, handleGlobalPointer, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${name ?? t('doc.untitled')} - ${t('app.name')}`;
    window.pigmento.window.setDocState({ dirty, hasFile: name !== null });
  }, [name, dirty]);

  if (!ready) {
    return (
      <div className="splash" role="status">
        {t('app.name')}
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <Ribbon />
      <OptionsBar />
      <div className={`main ${panelsLeft ? 'panels-left' : ''}`}>
        <CanvasArea />
        <SidePanel />
      </div>
      {statusBar ? <StatusBar /> : <div />}
      <DialogHost />
      <Toasts />
      <TooltipLayer />
    </div>
  );
}
