import { useCallback, useEffect, useRef, useState } from 'react';
import { toCss, type RGBA } from '@engine/core/color';
import type { PatternInfo } from '@engine/Engine';
import { stopsFromOptions } from '@engine/tools/builtin/gradient';
import type { GradientStop } from '@engine/raster/gradient';
import { t, type I18nKey } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Menu, MenuItem, MenuSeparator } from '../components/Menu';
import { engine } from '../state/engine';
import { openDialog, useUi } from '../state/store';
import { deletePattern, makePatternFromSelection } from '../services/patterns';

/** CSS for a gradient strip (over a checkerboard so transparency shows). */
export function gradientCss(stops: readonly GradientStop[]): string {
  const parts = [...stops].sort((a, b) => a.pos - b.pos).map((s) => `${toCss(s.color)} ${(s.pos * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Options bar: the gradient's colours; opens the gradient editor. */
export function GradientButton({ value, label }: { value: unknown; label: string }) {
  const colors = useUi((s) => s.colors);
  const stops = stopsFromOptions(value, colors.primary, colors.secondary);
  const title = value === null ? t('gradient.usingColors') : t('gradient.edit');
  return (
    <span className="opt">
      <span>{label}</span>
      <button type="button" className="gradient-button" aria-label={`${label}: ${title}`} data-tip={t('gradient.edit')} onClick={() => openDialog({ kind: 'gradient' })}>
        <span className="gradient-strip checker-bg">
          <span style={{ background: gradientCss(stops) }} />
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
    </span>
  );
}

/** A small preview of a fill pattern in the current colours. */
export function PatternSwatch({ pattern, size = 28 }: { pattern: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colors = useUi((s) => s.colors);
  const clear = useUi((s) => s.toolOptions.fill?.patternClear === true);
  const patterns = useUi((s) => s.patterns);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const tile = engine.patternTile({ pattern, fg: colors.primary, bg: clear ? null : colors.secondary, scale: 1 });
    if (!tile) return;
    const off = new OffscreenCanvas(tile.w, tile.h);
    off.getContext('2d')!.putImageData(new ImageData(tile.data as Uint8ClampedArray<ArrayBuffer>, tile.w, tile.h), 0, 0);
    if (tile.w <= c.width && tile.h <= c.height) {
      ctx.fillStyle = ctx.createPattern(off, 'repeat') ?? 'transparent';
      ctx.fillRect(0, 0, c.width, c.height);
    } else {
      // A big saved pattern is shown whole, scaled down.
      const k = Math.min(c.width / tile.w, c.height / tile.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, (c.width - tile.w * k) / 2, (c.height - tile.h * k) / 2, tile.w * k, tile.h * k);
    }
  }, [pattern, colors, clear, patterns]);
  const dpr = window.devicePixelRatio || 1;
  return <canvas ref={ref} className="pattern-swatch checker-bg" width={Math.round(size * dpr)} height={Math.round(size * dpr)} style={{ width: size, height: size }} aria-hidden="true" />;
}

const nameOf = (p: PatternInfo) => (p.labelKey ? t(p.labelKey as I18nKey) : (p.name ?? p.id));

/** Options bar: which pattern the Fill tool uses (built-in or made from a selection). */
export function PatternPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const patterns = useUi((s) => s.patterns);
  const hasSelection = useUi((s) => s.selection.bounds !== null);
  const current = patterns.find((p) => p.id === value) ?? patterns[0];
  const saved = patterns.filter((p) => !p.builtin);
  const tile = (p: PatternInfo) => (
    <button
      key={p.id}
      type="button"
      role="menuitemradio"
      aria-checked={p.id === value}
      className="menu-item pattern-tile"
      aria-label={nameOf(p)}
      data-tip={nameOf(p)}
      onClick={() => {
        onChange(p.id);
        close();
      }}
    >
      <PatternSwatch pattern={p.id} size={32} />
    </button>
  );
  return (
    <span className="opt">
      <span>{label}</span>
      <button ref={ref} type="button" className="pattern-button" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current ? nameOf(current) : ''}`} onClick={() => setOpen((o) => !o)}>
        {current ? <PatternSwatch pattern={current.id} size={20} /> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={label} className="pattern-menu">
        {patterns.filter((p) => p.builtin).map(tile)}
        {saved.length ? <div className="menu-heading">{t('pattern.saved')}</div> : null}
        {saved.map(tile)}
        <MenuSeparator />
        <MenuItem label={t('pattern.fromSelection')} icon="save-selection" disabled={!hasSelection} close={close} onSelect={() => void makePatternFromSelection()} />
        {current && !current.builtin ? <MenuItem label={t('pattern.delete')} icon="delete" close={close} onSelect={() => void deletePattern(current.id)} /> : null}
      </Menu>
    </span>
  );
}

/** Colour of a stop as CSS (for the editor). */
export function stopCss(c: RGBA): string {
  return toCss(c);
}
