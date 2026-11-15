import { parseHex, toCss, toHex6, type RGBA } from '@engine/core/color';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { action, runAction } from '../actions/actions';
import { useShortcut } from '../actions/keymap';
import { engine } from '../state/engine';
import { openDialog, useUi } from '../state/store';
import { useCallback, useRef, useState } from 'react';
import { Popover } from '../components/Popover';
import { PALETTE } from './paletteDefaults';

export { PALETTE } from './paletteDefaults';

/** Swatches shown in the ribbon; a bigger imported palette shows the rest in a popover. */
const RIBBON_SWATCHES = 24;
const CUSTOM_SLOTS = 12;

function Swatch({ color, hex }: { color: RGBA; hex: string }) {
  const label = t('colors.swatch', { hex: hex.toUpperCase() });
  return (
    <button
      type="button"
      className="swatch"
      style={{ background: toCss(color) }}
      aria-label={label}
      data-tip={label}
      onClick={() => engine.setPrimary(color)}
      onContextMenu={(e) => {
        e.preventDefault();
        engine.setSecondary(color);
      }}
      onKeyDown={(e) => {
        // Shift+Enter sets the secondary colour for keyboard users.
        if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          engine.setSecondary(color);
        }
      }}
    />
  );
}

export function ColorsGroup() {
  const colors = useUi((s) => s.colors);
  const custom = useUi((s) => s.settings.colors.custom);
  const swap = action('swapColors');
  const swapKey = useShortcut('swapColors');
  const slots = Array.from({ length: CUSTOM_SLOTS }, (_, i) => custom[i] ?? null);
  const palette = useUi((s) => s.settings.colors.palette) ?? PALETTE;
  return (
    <div className="colors-group">
      <div className="color-pair">
        <button
          type="button"
          className="color-chip primary"
          aria-label={`${t('colors.primary')}: ${toHex6(colors.primary)}`}
          data-tip={`${t('colors.primary')} · ${t('colors.edit')}`}
          onClick={() => openDialog({ kind: 'editColors', target: 'primary' })}
        >
          <span style={{ background: toCss(colors.primary) }} />
        </button>
        <button
          type="button"
          className="color-chip secondary"
          aria-label={`${t('colors.secondary')}: ${toHex6(colors.secondary)}`}
          data-tip={`${t('colors.secondary')} · ${t('colors.edit')}`}
          onClick={() => openDialog({ kind: 'editColors', target: 'secondary' })}
        >
          <span style={{ background: toCss(colors.secondary) }} />
        </button>
        <button
          type="button"
          className="swap"
          aria-label={t(swap.labelKey)}
          data-tip={t(swap.labelKey)}
          data-kbd={swapKey}
          onClick={() => runAction('swapColors')}
        >
          <Icon name="swap" size={13} />
        </button>
      </div>
      <div className="palette" role="group" aria-label={t('colors.palette')}>
        {/* A bigger palette gives its last cell to a button showing all of it. */}
        {palette.slice(0, palette.length > RIBBON_SWATCHES ? RIBBON_SWATCHES - 1 : RIBBON_SWATCHES).map((hex) => (
          <Swatch key={hex} hex={hex} color={parseHex(hex)!} />
        ))}
        {palette.length > RIBBON_SWATCHES ? <MorePalette palette={palette} /> : null}
        {slots.map((hex, i) =>
          hex ? (
            <Swatch key={`c${i}`} hex={hex.slice(0, 7)} color={parseHex(hex)!} />
          ) : (
            <button
              key={`e${i}`}
              type="button"
              className="swatch empty"
              aria-label={t('colors.addCustom')}
              data-tip={t('colors.addCustom')}
              onClick={() => openDialog({ kind: 'editColors', target: 'primary' })}
            />
          ),
        )}
      </div>
      <button
        type="button"
        className="rb rb-large"
        data-tip={t('colors.edit')}
        onClick={() => openDialog({ kind: 'editColors', target: 'primary' })}
      >
        <Icon name="palette" size={26} />
        <span className="rb-label">{t('colors.edit')}</span>
      </button>
    </div>
  );
}

/** The rest of a big imported palette. */
function MorePalette({ palette }: { palette: string[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const label = t('colors.more', { count: palette.length });
  return (
    <>
      <button ref={ref} type="button" className="swatch palette-more" aria-haspopup="dialog" aria-expanded={open} aria-label={label} data-tip={label} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={close} label={t('colors.palette')} className="palette-popover">
        <div className="palette-all" role="group" aria-label={t('colors.palette')}>
          {palette.map((hex) => (
            <Swatch key={hex} hex={hex} color={parseHex(hex)!} />
          ))}
        </div>
      </Popover>
    </>
  );
}
