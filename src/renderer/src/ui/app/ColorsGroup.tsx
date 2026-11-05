import { parseHex, toCss, toHex6, type RGBA } from '@engine/core/color';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { action, runAction } from '../actions/actions';
import { engine } from '../state/engine';
import { openDialog, useUi } from '../state/store';

/** Pigmento's default palette: two rows of 12, tuned to read well on light and dark chrome. */
export const PALETTE = [
  '#000000', '#3d3d46', '#7a7a86', '#b9b9c4', '#ffffff', '#7a4a2b',
  '#d7263d', '#ff6b35', '#ffc914', '#2bb24c', '#1e88e5', '#4b4be0',
  '#5e2b97', '#c2185b', '#ff9fb2', '#f4d6a0', '#fff3a3', '#b8e986',
  '#00a896', '#7fd3f7', '#a5a5ff', '#2c3e7a', '#144d2c', '#9e6b4a',
];

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
  const slots = Array.from({ length: CUSTOM_SLOTS }, (_, i) => custom[i] ?? null);
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
          data-kbd={swap.shortcut?.[0]}
          onClick={() => runAction('swapColors')}
        >
          <Icon name="swap" size={13} />
        </button>
      </div>
      <div className="palette" role="group" aria-label={t('colors.palette')}>
        {PALETTE.map((hex) => (
          <Swatch key={hex} hex={hex} color={parseHex(hex)!} />
        ))}
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
