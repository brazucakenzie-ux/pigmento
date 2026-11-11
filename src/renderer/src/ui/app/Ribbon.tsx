import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { FILE_FORMATS, type FileFormat } from '@shared/formats';
import type { WallpaperStyle } from '@shared/ipc';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t, type I18nKey } from '../../i18n';
import { Menu, MenuHeading, MenuItem, MenuSeparator, SubMenu } from '../components/Menu';
import { useUi, type RibbonTab } from '../state/store';
import * as files from '../services/files';
import { ActionMenuItem } from './ActionMenuItem';
import { ActionButton, MenuButton, RibbonGroup, SplitButton } from './RibbonButton';
import { ColorsGroup } from './ColorsGroup';
import { ThemePicker } from './ThemePicker';
import { ShapesTab } from './ShapeGallery';
import { BrushGallery, pickBrush } from './BrushPicker';
import { engine } from '../state/engine';

const TABS: { id: RibbonTab; labelKey: I18nKey }[] = [
  { id: 'home', labelKey: 'tab.home' },
  { id: 'shapes', labelKey: 'tab.shapes' },
  { id: 'image', labelKey: 'tab.image' },
  { id: 'view', labelKey: 'tab.view' },
];

const WALLPAPER: { style: WallpaperStyle; key: I18nKey }[] = [
  { style: 'fill', key: 'file.wallpaper.fill' },
  { style: 'fit', key: 'file.wallpaper.fit' },
  { style: 'stretch', key: 'file.wallpaper.stretch' },
  { style: 'tile', key: 'file.wallpaper.tile' },
  { style: 'center', key: 'file.wallpaper.center' },
];

function FileMenu() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const recent = useUi((s) => s.recent);
  return (
    <>
      <button ref={ref} type="button" className="file-tab" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('top.fileMenu')}
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={t('top.fileMenu')}>
        <ActionMenuItem id="new" close={close} label={t('file.new')} />
        <ActionMenuItem id="newWindow" close={close} />
        <ActionMenuItem id="open" close={close} label={t('file.open')} />
        <ActionMenuItem id="importSvg" close={close} />
        <SubMenu label={t('file.recent')} icon="history">
          {(closeAll) => (
            <>
              {recent.length === 0 ? <div className="menu-note">{t('file.recentEmpty')}</div> : null}
              {recent.map((r) => (
                <MenuItem key={r.path} label={r.name} close={closeAll} onSelect={() => void files.openPath(r.path)} />
              ))}
              {recent.length > 0 ? (
                <>
                  <MenuSeparator />
                  <MenuItem label={t('file.recentClear')} icon="delete" close={closeAll} onSelect={() => void window.pigmento.recent.clear()} />
                </>
              ) : null}
            </>
          )}
        </SubMenu>
        <MenuSeparator />
        <ActionMenuItem id="save" close={close} />
        <SubMenu label={t('file.saveAs')} icon="save">
          {(closeAll) =>
            (Object.keys(FILE_FORMATS) as FileFormat[]).map((f) => (
              <MenuItem
                key={f}
                label={t('file.saveAsFormat', { format: t(FILE_FORMATS[f].labelKey as I18nKey) })}
                close={closeAll}
                onSelect={() => void files.saveAs(f)}
              />
            ))
          }
        </SubMenu>
        <ActionMenuItem id="export" close={close} />
        <ActionMenuItem id="exportSvg" close={close} />
        <MenuSeparator />
        <ActionMenuItem id="print" close={close} label={t('file.print')} />
        <SubMenu label={t('file.wallpaper')} icon="wallpaper">
          {(closeAll) =>
            WALLPAPER.map((w) => <MenuItem key={w.style} label={t(w.key)} close={closeAll} onSelect={() => void files.setWallpaper(w.style)} />)
          }
        </SubMenu>
        <ActionMenuItem id="properties" close={close} />
        <MenuSeparator />
        <MenuItem label={t('file.close')} icon="close" close={close} onSelect={() => void window.pigmento.window.requestClose()} />
      </Menu>
    </>
  );
}

function HelpMenu() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={ref} type="button" className="ribbon-tab" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('help.menu')}
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={t('help.menu')}>
        <ActionMenuItem id="shortcuts" close={close} />
        <ActionMenuItem id="about" close={close} />
      </Menu>
    </>
  );
}

function ToolButtons({ group, variant }: { group: 'tools' | 'shapes' | 'brushes'; variant: 'compact' | 'large' }) {
  return (
    <>
      {toolRegistry
        .byGroup(group)
        .filter((tool) => !tool.galleryOnly)
        .map((tool) => (
        <ActionButton key={tool.id} id={`tool.${tool.id}`} variant={variant} />
      ))}
    </>
  );
}

/** Smudge, Blur, Sharpen, Clone and Dodge/Burn share one cell of the Tools grid. */
function RetouchMenu() {
  const current = useUi((s) => toolRegistry.get(s.tool));
  const active = current?.group === 'retouch' ? current : null;
  return (
    <MenuButton label={active ? t(active.labelKey) : t('group.retouch')} icon={active?.icon ?? 'smudge'} variant="compact" tip={t('group.retouch')} pressed={active !== null}>
      {(close) => (
        <>
          {toolRegistry.byGroup('retouch').map((tool) => (
            <ActionMenuItem key={tool.id} id={`tool.${tool.id}`} close={close} />
          ))}
        </>
      )}
    </MenuButton>
  );
}

function RibbonBrushes({ close }: { close: () => void }) {
  const value = useUi((s) => String((s.toolOptions.brush ?? engine.options('brush')).brushId ?? 'round'));
  return (
    <BrushGallery
      menu
      value={value}
      onPick={(id) => {
        pickBrush('brush', id);
        close();
      }}
    />
  );
}

function HomeTab() {
  return (
    <>
      <RibbonGroup label={t('group.clipboard')}>
        <SplitButton id="paste" menuLabel={t('a11y.more')}>
          {(close) => (
            <>
              <ActionMenuItem id="paste" close={close} />
              <ActionMenuItem id="pasteNew" close={close} />
              <ActionMenuItem id="pasteFromFile" close={close} />
            </>
          )}
        </SplitButton>
        <div className="rb-stack">
          <ActionButton id="cut" variant="small" />
          <ActionButton id="copy" variant="small" />
          <ActionButton id="copyImage" variant="small" />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.selection')}>
        <SplitButton id="tool.select" menuLabel={t('a11y.more')}>
          {(close) => (
            <>
              <MenuHeading>{t('group.selection')}</MenuHeading>
              {toolRegistry.byGroup('selection').map((tool) => (
                <ActionMenuItem key={tool.id} id={`tool.${tool.id}`} close={close} />
              ))}
              <MenuSeparator />
              <ActionMenuItem id="selectAll" close={close} />
              <ActionMenuItem id="invertSelection" close={close} />
              <ActionMenuItem id="deselect" close={close} />
              <ActionMenuItem id="delete" close={close} />
              <MenuSeparator />
              <ActionMenuItem id="colorRange" close={close} />
              <SubMenu label={t('menu.modifySelection')} icon="feather">
                {(closeAll) => (
                  <>
                    <ActionMenuItem id="feather" close={closeAll} />
                    <ActionMenuItem id="grow" close={closeAll} />
                    <ActionMenuItem id="shrink" close={closeAll} />
                    <ActionMenuItem id="border" close={closeAll} />
                  </>
                )}
              </SubMenu>
              <ActionMenuItem id="saveSelection" close={close} />
              <ActionMenuItem id="loadSelection" close={close} />
              <ActionMenuItem id="definePattern" close={close} />
              <ActionMenuItem id="selectionToShape" close={close} />
              <MenuSeparator />
              <ActionMenuItem id="transparentSelection" close={close} />
            </>
          )}
        </SplitButton>
        <div className="rb-stack">
          <ActionButton id="crop" variant="small" />
          <ActionButton id="resize" variant="small" label={t('action.resize')} />
          <MenuButton label={t('action.rotate')} icon="rotate-cw">
            {(close) => (
              <>
                <ActionMenuItem id="rotateCw" close={close} />
                <ActionMenuItem id="rotateCcw" close={close} />
                <ActionMenuItem id="rotate180" close={close} />
                <ActionMenuItem id="rotateFree" close={close} />
                <ActionMenuItem id="freeTransform" close={close} />
                <MenuSeparator />
                <ActionMenuItem id="flipH" close={close} />
                <ActionMenuItem id="flipV" close={close} />
              </>
            )}
          </MenuButton>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.tools')}>
        <div className="rb-grid">
          <ToolButtons group="tools" variant="compact" />
          <RetouchMenu />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.brushes')}>
        {/* The Brush, with the brush library one click away. */}
        <SplitButton id="tool.brush" menuLabel={t('brushes.gallery')} menuClassName="brush-menu">
          {(close) => <RibbonBrushes close={close} />}
        </SplitButton>
      </RibbonGroup>
      <RibbonGroup label={t('group.shapes')}>
        <div className="rb-grid">
          <ToolButtons group="shapes" variant="compact" />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.colors')}>
        <ColorsGroup />
      </RibbonGroup>
    </>
  );
}

function ImageTab() {
  return (
    <>
      <RibbonGroup label={t('group.selection')}>
        <ActionButton id="selectAll" />
        <div className="rb-stack">
          <ActionButton id="invertSelection" variant="small" />
          <ActionButton id="deselect" variant="small" />
          <ActionButton id="transparentSelection" variant="small" />
        </div>
        {/* Crop, and the automatic crops that need no selection. */}
        <SplitButton id="crop" menuLabel={t('a11y.more')}>
          {(close) => (
            <>
              <ActionMenuItem id="crop" close={close} />
              <ActionMenuItem id="trim" close={close} />
              <ActionMenuItem id="fitCanvas" close={close} />
            </>
          )}
        </SplitButton>
      </RibbonGroup>
      <RibbonGroup label={t('group.size')}>
        <ActionButton id="resize" label={t('action.resize')} />
        <ActionButton id="canvasSize" label={t('dialog.canvas.title')} />
      </RibbonGroup>
      <RibbonGroup label={t('group.transform')}>
        <ActionButton id="rotateCw" label={t('action.rotateCw')} />
        <ActionButton id="rotateCcw" label={t('action.rotateCcw')} />
        <div className="rb-stack">
          <ActionButton id="rotate180" variant="small" />
          <ActionButton id="rotateFree" variant="small" />
          <ActionButton id="freeTransform" variant="small" />
        </div>
        <div className="rb-stack">
          <ActionButton id="flipH" variant="small" />
          <ActionButton id="flipV" variant="small" />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.adjust')}>
        <ActionButton id="invertColors" />
      </RibbonGroup>
      <RibbonGroup label={t('group.layers')}>
        <ActionButton id="layerNew" />
        <div className="rb-stack">
          <ActionButton id="layerDuplicate" variant="small" />
          <ActionButton id="layerDelete" variant="small" />
          <ActionButton id="layerGroup" variant="small" />
        </div>
        <div className="rb-stack">
          <ActionButton id="layerMergeDown" variant="small" />
          <ActionButton id="layerFlatten" variant="small" />
          <ActionButton id="layerUngroup" variant="small" />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.canvas')}>
        <ActionButton id="properties" label={t('action.properties')} />
      </RibbonGroup>
    </>
  );
}

function ViewTab() {
  return (
    <>
      <RibbonGroup label={t('group.zoom')}>
        <ActionButton id="zoomIn" />
        <ActionButton id="zoomOut" />
        <ActionButton id="zoom100" />
        <ActionButton id="zoomFit" />
      </RibbonGroup>
      <RibbonGroup label={t('group.show')}>
        <div className="rb-stack">
          <ActionButton id="rulers" variant="small" />
          <ActionButton id="gridlines" variant="small" />
          <ActionButton id="pixelGrid" variant="small" />
        </div>
        <div className="rb-stack">
          <ActionButton id="statusBar" variant="small" />
          <ActionButton id="guides" variant="small" />
          {/* Snapping and guide options share one menu, so the View tab stays one screen wide. */}
          <MenuButton label={t('group.snap')} icon="magnet">
            {(close) => (
              <>
                <ActionMenuItem id="snap" close={close} />
                <MenuSeparator />
                <ActionMenuItem id="snapGrid" close={close} />
                <ActionMenuItem id="snapGuides" close={close} />
                <ActionMenuItem id="snapCanvas" close={close} />
                <ActionMenuItem id="snapObjects" close={close} />
                <MenuSeparator />
                <ActionMenuItem id="lockGuides" close={close} />
                <ActionMenuItem id="clearGuides" close={close} />
              </>
            )}
          </MenuButton>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.panels')}>
        <ActionButton id="panels" />
        <div className="rb-stack">
          <ActionButton id="layersPanel" variant="small" />
          <ActionButton id="historyPanel" variant="small" />
          <ActionButton id="navigatorPanel" variant="small" />
        </div>
        <div className="rb-stack">
          <ActionButton id="panelSide" variant="small" />
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.window')}>
        <ActionButton id="fullscreen" />
        <ActionButton id="newWindow" />
      </RibbonGroup>
      <RibbonGroup label={t('group.theme')}>
        <ThemePicker />
        <div className="rb-stack">
          <ActionButton id="themeLight" variant="small" />
          <ActionButton id="themeDark" variant="small" />
          <ActionButton id="themeSystem" variant="small" />
        </div>
        <div className="rb-stack">
          <ActionButton id="windowsAccent" variant="small" />
        </div>
      </RibbonGroup>
    </>
  );
}

export function Ribbon() {
  const tab = useUi((s) => s.tab);
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = TABS[(i + d + TABS.length) % TABS.length];
    useUi.setState({ tab: next.id });
    requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
  };
  return (
    <div className="ribbon" aria-label={t('a11y.ribbon')}>
      <div className="ribbon-tabs" role="tablist" aria-label={t('a11y.ribbon')}>
        <FileMenu />
        {TABS.map((tb, i) => (
          <button
            key={tb.id}
            id={`tab-${tb.id}`}
            type="button"
            role="tab"
            className="ribbon-tab"
            aria-selected={tab === tb.id}
            aria-controls="ribbon-panel"
            tabIndex={tab === tb.id ? 0 : -1}
            onClick={() => useUi.setState({ tab: tb.id })}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t(tb.labelKey)}
          </button>
        ))}
        <span className="spacer" />
        <HelpMenu />
      </div>
      <div className="ribbon-panel" id="ribbon-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'home' ? <HomeTab /> : tab === 'shapes' ? <ShapesTab /> : tab === 'image' ? <ImageTab /> : <ViewTab />}
      </div>
    </div>
  );
}
