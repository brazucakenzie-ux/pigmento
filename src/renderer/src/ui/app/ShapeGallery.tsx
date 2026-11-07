import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { shapePath, shapeRegistry, SHAPE_CATEGORIES, type ShapeCategory, type ShapeDef, type ShapeParam } from '@engine/shapes/ShapeRegistry';
import { toSvgPath, type PathCmd } from '@engine/shapes/path';
import { DEFAULT_LIBRARY_SHAPE, libraryShapeOf } from '@engine/tools/builtin/shape';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Menu, MenuItem } from '../components/Menu';
import { Slider } from '../components/Controls';
import { engine } from '../state/engine';
import { openDialog, updateSettings, useUi } from '../state/store';
import { runAction } from '../actions/actions';
import { duplicateMyShape, isCustom } from '../services/shapes';
import { ActionButton, MenuButton, RibbonGroup } from './RibbonButton';
import { ColorsGroup } from './ColorsGroup';
import { ActionMenuItem } from './ActionMenuItem';

/** Thumbnails are drawn once per shape, in a 24×24 box (personal shapes keep their proportions). */
const THUMBS = new WeakMap<ShapeDef, string>();
const THUMB = 24;

function shifted(c: PathCmd, dx: number, dy: number): PathCmd {
  if (c.op === 'Z') return c;
  if (c.op === 'C') return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
  if (c.op === 'Q') return { ...c, x1: c.x1 + dx, y1: c.y1 + dy, x: c.x + dx, y: c.y + dy };
  return { ...c, x: c.x + dx, y: c.y + dy };
}

function thumbPath(def: ShapeDef): string {
  let d = THUMBS.get(def);
  if (d === undefined) {
    const a = def.aspect ?? 1;
    const w = a >= 1 ? THUMB : THUMB * a;
    const h = a >= 1 ? THUMB / a : THUMB;
    d = toSvgPath(shapePath(def, w, h).map((c) => shifted(c, (THUMB - w) / 2, (THUMB - h) / 2)));
    THUMBS.set(def, d);
  }
  return d;
}

export function shapeName(def: ShapeDef): string {
  return def.name ?? t(def.labelKey);
}

export function ShapeThumb({ id, size = 24 }: { id: string; size?: number }) {
  const def = shapeRegistry.get(id);
  if (!def) return null;
  return (
    <svg className={`shape-thumb${def.strokeOnly ? ' stroke-only' : ''}`} width={size} height={size} viewBox="-2 -2 28 28" aria-hidden="true" focusable="false">
      <path d={thumbPath(def)} fillRule={def.fillRule} />
    </svg>
  );
}

type GalleryFilter = 'all' | 'favorites' | ShapeCategory;

/** The categories the all-shapes popover lists (My shapes last, when there are any). */
const MENU_SECTIONS: ShapeCategory[] = [...SHAPE_CATEGORIES, 'custom'];

/** Search text and category survive switching ribbon tabs (not saved between runs). */
const useGallery = create<{ query: string; filter: GalleryFilter }>(() => ({ query: '', filter: 'all' }));

/** Draw this shape next (switches to the Shape tool). */
export function pickShape(id: string): void {
  engine.setToolOption('shape', 'shapeId', id);
  runAction('tool.shape');
}

function toggleFavorite(id: string): void {
  const s = useUi.getState().settings.shapes;
  const favorites = s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id];
  updateSettings({ shapes: { ...s, favorites } });
}

function useCurrentShape(): string {
  return useUi((s) => libraryShapeOf(s.toolOptions.shape ?? engine.options('shape')).shapeId);
}

/** Arrow keys move through a wrapping grid of options (rows found from the layout). */
function onGridKey(e: KeyboardEvent<HTMLDivElement>): void {
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0 || items.length === 0) return;
  const cols = Math.max(1, items.filter((el) => el.offsetTop === items[0].offsetTop).length);
  const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: items.length - 1 };
  const next = moves[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const el = items[Math.max(0, Math.min(items.length - 1, next))];
  el.focus();
  el.scrollIntoView({ block: 'nearest' });
}

function GalleryTile({ def, selected, focusable }: { def: ShapeDef; selected: boolean; focusable: boolean }) {
  const name = shapeName(def);
  return (
    <button
      type="button"
      role="option"
      className="shape-tile"
      aria-selected={selected}
      aria-label={name}
      data-tip={name}
      data-shape={def.id}
      tabIndex={focusable ? 0 : -1}
      onClick={() => pickShape(def.id)}
    >
      <ShapeThumb id={def.id} />
    </button>
  );
}

/** Every shape by category in a popover (the ribbon gallery shows a filtered strip). */
function AllShapesMenu({ current }: { current: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button ref={ref} type="button" className="shape-expand" aria-haspopup="menu" aria-expanded={open} aria-label={t('shapes.expand')} data-tip={t('shapes.expand')} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-down" size={14} />
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={t('shapes.gallery')} className="shape-menu">
        {MENU_SECTIONS.map((cat) => {
          const defs = cat === 'custom' ? shapeRegistry.all().filter((d) => d.custom) : shapeRegistry.byCategory(cat).filter((d) => !d.custom);
          if (!defs.length) return null;
          return (
            <div key={cat} className="shape-menu-section" role="group" aria-label={t(`shapecat.${cat}` as I18nKey)}>
              <div className="menu-heading">{t(`shapecat.${cat}` as I18nKey)}</div>
              <div className="shape-menu-grid">
                {defs.map((def) => (
                  <button
                    key={def.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={def.id === current}
                    className="menu-item shape-tile"
                    aria-label={shapeName(def)}
                    data-tip={shapeName(def)}
                    onClick={() => {
                      pickShape(def.id);
                      close();
                    }}
                  >
                    <ShapeThumb id={def.id} size={26} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Menu>
    </>
  );
}

/** Rename, duplicate and delete for one of My shapes (one small menu, so the tab stays one screen wide). */
function ManageShape({ def }: { def: ShapeDef }) {
  return (
    <MenuButton label={t('shapes.manage')} icon="properties">
      {(close) => (
        <>
          <MenuItem label={t('shapes.rename')} icon="text" close={close} onSelect={() => openDialog({ kind: 'saveShape', id: def.id })} />
          <MenuItem label={t('shapes.duplicate')} icon="copy" close={close} onSelect={() => void duplicateMyShape(def.id, t('shape.copyName', { name: shapeName(def) }))} />
          <MenuItem label={t('shapes.delete')} icon="delete" close={close} onSelect={() => openDialog({ kind: 'deleteShape', id: def.id })} />
        </>
      )}
    </MenuButton>
  );
}

export function ShapesTab() {
  const { query, filter } = useGallery();
  const favorites = useUi((s) => s.settings.shapes.favorites);
  // Personal shapes come and go: the registry is read again when this changes.
  const library = useUi((s) => s.shapeLibrary);
  const current = useCurrentShape();
  const currentDef = shapeRegistry.get(current) ?? shapeRegistry.get(DEFAULT_LIBRARY_SHAPE)!;
  const isFavorite = favorites.includes(currentDef.id);
  const shown = useMemo(() => {
    void library;
    const found = shapeRegistry.search(query, shapeName);
    if (filter === 'all') return found;
    if (filter === 'favorites') return favorites.map((id) => found.find((d) => d.id === id)).filter((d): d is ShapeDef => d !== undefined);
    if (filter === 'custom') return found.filter((d) => d.custom);
    return found.filter((d) => d.category === filter);
  }, [query, filter, favorites, library]);
  const focusId = shown.some((d) => d.id === current) ? current : shown[0]?.id;
  const filters: GalleryFilter[] = ['all', 'favorites', 'custom', ...SHAPE_CATEGORIES];
  const empty = query ? t('shapes.none') : filter === 'favorites' ? t('shapes.noFavorites') : filter === 'custom' ? t('shapes.noCustom') : t('shapes.none');
  return (
    <>
      <RibbonGroup label={t('group.findShapes')}>
        <div className="rb-stack shape-find">
          <input
            type="search"
            className="text-input"
            placeholder={t('shapes.search')}
            aria-label={t('shapes.search')}
            value={query}
            spellCheck={false}
            onChange={(e) => useGallery.setState({ query: e.target.value })}
          />
          <select className="select" aria-label={t('shapes.category')} value={filter} onChange={(e) => useGallery.setState({ filter: e.target.value as GalleryFilter })}>
            {filters.map((f) => (
              <option key={f} value={f}>
                {t(`shapecat.${f}` as I18nKey)}
              </option>
            ))}
          </select>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.shapeGallery')} className="shape-gallery-group">
        <div className="shape-gallery" role="listbox" aria-label={t('shapes.gallery')} onKeyDown={onGridKey}>
          {shown.map((def) => (
            <GalleryTile key={def.id} def={def} selected={def.id === current} focusable={def.id === focusId} />
          ))}
          {shown.length === 0 ? <div className="shape-gallery-empty">{empty}</div> : null}
        </div>
        <AllShapesMenu current={current} />
      </RibbonGroup>
      <RibbonGroup label={t('group.shapeCurrent')}>
        <button type="button" className="rb rb-large shape-current" data-tip={t('shapes.draw')} onClick={() => pickShape(currentDef.id)}>
          <ShapeThumb id={currentDef.id} size={28} />
          <span className="rb-label">{shapeName(currentDef)}</span>
        </button>
        <div className="rb-stack">
          <button type="button" className="rb rb-small shape-favorite" aria-pressed={isFavorite} data-tip={t(isFavorite ? 'shapes.unfavorite' : 'shapes.favorite')} onClick={() => toggleFavorite(currentDef.id)}>
            <Icon name="star" size={16} />
            <span className="rb-label">{t(isFavorite ? 'shapes.unfavorite' : 'shapes.favorite')}</span>
          </button>
          {isCustom(currentDef) ? <ManageShape def={currentDef} /> : null}
          <MenuButton label={t('shapes.files')} icon="folder">
            {(close) => (
              <>
                <ActionMenuItem id="importSvg" close={close} />
                <ActionMenuItem id="importShapePack" close={close} />
                <ActionMenuItem id="exportShapePack" close={close} />
              </>
            )}
          </MenuButton>
        </div>
      </RibbonGroup>
      <RibbonGroup label={t('group.shapeDraw')}>
        <ActionButton id="tool.pen" />
        <div className="rb-stack">
          <ActionButton id="convertToPath" variant="small" />
          <ActionButton id="selectionToShape" variant="small" />
          <ActionButton id="saveShape" variant="small" />
        </div>
      </RibbonGroup>
      {/* Shapes use the primary (outline) and secondary (fill) colours, so they are picked here too. */}
      <RibbonGroup label={t('group.colors')}>
        <ColorsGroup />
      </RibbonGroup>
    </>
  );
}

/** One slider per shape setting (options bar). */
export function ShapeParamSliders({ def, values, onChange }: { def: ShapeDef; values: Readonly<Record<string, number>>; onChange: (key: string, v: number) => void }) {
  return (
    <>
      {def.params.map((p: ShapeParam) => {
        const label = t(p.labelKey);
        return (
          <span key={p.key} className="opt">
            <span>{label}</span>
            <Slider value={values[p.key] ?? p.default} min={p.min} max={p.max} step={p.step} unit={p.unit || undefined} label={label} width={80} onChange={(v) => onChange(p.key, v)} />
          </span>
        );
      })}
    </>
  );
}

/** Options bar: the Shape tool's shape (opens the Shapes tab) and its sliders. */
export function ShapeOption({ value }: { value: unknown }) {
  const def = shapeRegistry.get(String(value)) ?? shapeRegistry.get(DEFAULT_LIBRARY_SHAPE)!;
  return (
    <button type="button" className="btn small shape-pick" data-tip={t('opt.shapePick')} aria-label={`${t('opt.shape')}: ${shapeName(def)}`} onClick={() => useUi.setState({ tab: 'shapes' })}>
      <ShapeThumb id={def.id} size={18} />
      {shapeName(def)}
    </button>
  );
}

export function ShapeToolParams({ values }: { values: Record<string, unknown> }) {
  const { shapeId, params } = libraryShapeOf(values);
  const def = shapeRegistry.get(shapeId);
  if (!def || def.params.length === 0) return null;
  const table = (values.params ?? {}) as Record<string, Record<string, number>>;
  return <ShapeParamSliders def={def} values={params} onChange={(key, v) => engine.setToolOption('shape', 'params', { ...table, [shapeId]: { ...params, [key]: v } })} />;
}

/** Move tool: sliders for the one selected library shape. */
export function SelectedShapeParams() {
  const info = useUi((s) => s.vectorSelection.shape);
  const def = info ? shapeRegistry.get(info.shapeId) : undefined;
  if (!info || !def || def.params.length === 0) return null;
  return <ShapeParamSliders def={def} values={{ ...Object.fromEntries(def.params.map((p) => [p.key, p.default])), ...info.params }} onChange={(key, v) => engine.setVectorShapeParams({ [key]: v })} />;
}
