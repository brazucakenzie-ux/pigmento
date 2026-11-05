import { useCallback, useMemo, useRef, useState } from 'react';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Menu, MenuHeading, MenuSeparator } from '../components/Menu';
import { updateSettings, useUi } from '../state/store';
import { THEME_FAMILIES, resolveTheme, schemeFor, themeFamily, type Scheme } from '../theme/themes';
import { ActionMenuItem } from './ActionMenuItem';

/** Two mini windows (light and dark) in a family's own colours. */
function Preview({ family }: { family: (typeof THEME_FAMILIES)[number]['id'] }) {
  const chips = useMemo(
    () =>
      (['light', 'dark'] as Scheme[]).map((s) => {
        const tk = resolveTheme(family, s).tokens;
        return { s, bg: tk['bg-ribbon'], top: tk['bg-top'], border: tk['border-strong'], accent: tk.accent, text: tk.text };
      }),
    [family],
  );
  return (
    <span className="theme-preview" aria-hidden="true">
      {chips.map((c) => (
        <span key={c.s} className="theme-chip" style={{ background: c.bg, borderColor: c.border, boxShadow: `inset 0 5px 0 ${c.top}` }}>
          <span className="dot" style={{ background: c.accent }} />
          <span className="bar" style={{ background: c.text }} />
        </span>
      ))}
    </span>
  );
}

/** Ribbon button + menu for choosing a theme family (the mode picks its light or dark variant). */
export function ThemePicker() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const family = useUi((s) => s.settings.theme);
  const mode = useUi((s) => s.settings.themeMode);
  const systemDark = useUi((s) => s.system.dark);
  const name = t(themeFamily(family).labelKey);
  const variant = t(schemeFor(mode, systemDark) === 'dark' ? 'theme.variant.dark' : 'theme.variant.light', { name });
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="rb rb-large"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={t('theme.current', { name: variant })}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="palette" size={26} />
        <span className="rb-label">
          {t('theme.label')}
          <Icon name="chevron-down" size={12} className="rb-chevron" />
        </span>
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={t('theme.label')}>
        <MenuHeading>{t('theme.label')}</MenuHeading>
        {THEME_FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            className="menu-item theme-item"
            role="menuitemradio"
            aria-checked={f.id === family}
            onClick={() => {
              close();
              updateSettings({ theme: f.id });
            }}
          >
            <span className="mi-icon">{f.id === family ? <Icon name="check" size={16} /> : null}</span>
            <span className="mi-label">{t(f.labelKey)}</span>
            <Preview family={f.id} />
          </button>
        ))}
        <MenuSeparator />
        <MenuHeading>{t('theme.mode')}</MenuHeading>
        <ActionMenuItem id="themeLight" close={close} />
        <ActionMenuItem id="themeDark" close={close} />
        <ActionMenuItem id="themeSystem" close={close} />
        <MenuSeparator />
        <ActionMenuItem id="windowsAccent" close={close} />
      </Menu>
    </>
  );
}
