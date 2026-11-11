import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { BRUSH_CATEGORIES, brushRegistry, type BrushCategory, type BrushDef } from '@engine/brush/BrushRegistry';
import { brushPreview } from '@engine/brush/preview';
import { flatOptions } from '@engine/tools/Tool';
import { brushOptionsFor } from '@engine/tools/brushTool';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Popover } from '../components/Popover';
import { runAction } from '../actions/actions';
import { engine } from '../state/engine';
import { updateSettings, useUi } from '../state/store';

export function brushName(def: BrushDef): string {
  return def.name ?? t(def.labelKey);
}

/** Previews are drawn once per brush and size (they're seeded, so they never change). */
const PREVIEWS = new WeakMap<BrushDef, Map<string, ImageData>>();

function previewOf(def: BrushDef, w: number, h: number): ImageData {
  let byDims = PREVIEWS.get(def);
  if (!byDims) {
    byDims = new Map();
    PREVIEWS.set(def, byDims);
  }
  const key = `${w}x${h}`;
  let img = byDims.get(key);
  if (!img) {
    const p = brushPreview(def.settings, w, h);
    img = new ImageData(new Uint8ClampedArray(p.data), p.w, p.h);
    byDims.set(key, img);
  }
  return img;
}

export function BrushThumb({ def, w = 96, h = 32 }: { def: BrushDef; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) ctx.putImageData(previewOf(def, pw, ph), 0, 0);
  }, [def, pw, ph]);
  return <canvas ref={ref} className="brush-thumb" width={pw} height={ph} style={{ width: w, height: h }} aria-hidden="true" />;
}

/**
 * Use a brush with a tool: its size, opacity, flow and hardness go into the tool's sliders.
 * An eraser brush picked for the Brush switches to the Eraser.
 */
export function pickBrush(toolId: string, id: string): void {
  const def = brushRegistry.get(id);
  if (!def) return;
  const target = def.eraser && toolId === 'brush' ? 'eraser' : toolId;
  const tool = toolRegistry.get(target);
  if (!tool) return;
  const keys = new Set(flatOptions(tool.options).map((o) => o.key));
  const values = Object.fromEntries(Object.entries(brushOptionsFor(def)).filter(([k]) => keys.has(k)));
  engine.setToolOptions(target, values);
  runAction(`tool.${target}`);
}

function toggleFavorite(id: string): void {
  const s = useUi.getState().settings.brushes;
  const favorites = s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id];
  updateSettings({ brushes: { ...s, favorites } });
}

type Filter = 'all' | 'favorites' | BrushCategory;

/** Search and category are kept while the app runs. */
const useGallery = create<{ query: string; filter: Filter }>(() => ({ query: '', filter: 'all' }));

/** The brush library: search, a category, favourites, and preview tiles to pick from. */
export function BrushGallery({ value, onPick, menu = false }: { value: string; onPick: (id: string) => void; menu?: boolean }) {
  const { query, filter } = useGallery();
  const favorites = useUi((s) => s.settings.brushes.favorites);
  const library = useUi((s) => s.brushLibrary);
  const current = brushRegistry.get(value);
  const shown = useMemo(() => {
    void library;
    const found = brushRegistry.search(query, brushName);
    if (filter === 'all') return found;
    if (filter === 'favorites') return favorites.map((id) => found.find((d) => d.id === id)).filter((d): d is BrushDef => d !== undefined);
    if (filter === 'custom') return found.filter((d) => d.custom);
    return found.filter((d) => d.category === filter);
  }, [query, filter, favorites, library]);
  const filters: Filter[] = ['all', 'favorites', ...BRUSH_CATEGORIES, 'custom'];
  const fav = current ? favorites.includes(current.id) : false;
  return (
    <div className="brush-gallery">
      <div className="brush-gallery-head">
        <input
          type="search"
          className="text-input"
          placeholder={t('brushes.search')}
          aria-label={t('brushes.search')}
          value={query}
          spellCheck={false}
          onChange={(e) => useGallery.setState({ query: e.target.value })}
          // Typing letters shouldn't move through the menu.
          onKeyDown={(e) => e.stopPropagation()}
        />
        <select className="select" aria-label={t('brushes.category')} value={filter} onChange={(e) => useGallery.setState({ filter: e.target.value as Filter })}>
          {filters.map((f) => (
            <option key={f} value={f}>
              {t(`brushcat.${f}` as I18nKey)}
            </option>
          ))}
        </select>
        {current ? (
          <button type="button" className="icon-btn brush-favorite" aria-pressed={fav} aria-label={t(fav ? 'brushes.unfavorite' : 'brushes.favorite')} data-tip={t(fav ? 'brushes.unfavorite' : 'brushes.favorite')} onClick={() => toggleFavorite(current.id)}>
            <Icon name="star" size={16} />
          </button>
        ) : null}
      </div>
      <div className="brush-grid" role={menu ? 'group' : 'listbox'} aria-label={t('brushes.gallery')}>
        {shown.map((def) => {
          const name = brushName(def);
          const selected = def.id === value;
          return (
            <button
              key={def.id}
              type="button"
              className={`brush-tile${menu ? ' menu-item' : ''}`}
              role={menu ? 'menuitemradio' : 'option'}
              aria-checked={menu ? selected : undefined}
              aria-selected={menu ? undefined : selected}
              aria-label={name}
              data-brush={def.id}
              onClick={() => onPick(def.id)}
            >
              <BrushThumb def={def} />
              <span className="brush-tile-name">{name}</span>
            </button>
          );
        })}
        {shown.length === 0 ? <div className="brush-gallery-empty">{filter === 'favorites' && !query ? t('brushes.noFavorites') : t('brushes.none')}</div> : null}
      </div>
    </div>
  );
}

/** Options bar: the tool's brush (a preview and its name) opening the library. */
export function BrushPicker({ toolId, value, label }: { toolId: string; value: string; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const def = brushRegistry.get(value);
  return (
    <span className="opt">
      <button ref={ref} type="button" className="brush-pick" aria-haspopup="dialog" aria-expanded={open} aria-label={`${label}: ${def ? brushName(def) : value}`} data-tip={t('brushes.pick')} onClick={() => setOpen((o) => !o)}>
        {def ? <BrushThumb def={def} w={56} h={20} /> : null}
        <span>{def ? brushName(def) : value}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={close} label={t('brushes.gallery')} className="brush-popover">
        <BrushGallery
          value={value}
          onPick={(id) => {
            pickBrush(toolId, id);
            close();
          }}
        />
      </Popover>
    </span>
  );
}
