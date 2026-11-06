import { useCallback, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { action, runAction } from '../actions/actions';
import { Icon } from '../icons/Icon';
import { Menu } from '../components/Menu';
import { useUi } from '../state/store';

export type RbVariant = 'large' | 'compact' | 'small';

const ICON_SIZE: Record<RbVariant, number> = { large: 26, compact: 16, small: 16 };

/** Ribbon button bound to an action: label, icon, shortcut tooltip, enabled/pressed state. */
export function ActionButton({ id, variant = 'large', label, icon }: { id: string; variant?: RbVariant; label?: string; icon?: string }) {
  const a = action(id);
  const enabled = useUi((s) => (a.enabled ? a.enabled(s) : true));
  const checked = useUi((s) => (a.checked ? a.checked(s) : undefined));
  const text = label ?? t(a.labelKey);
  return (
    <button
      type="button"
      className={`rb rb-${variant}`}
      aria-pressed={checked}
      disabled={!enabled}
      data-tip={text}
      data-kbd={a.shortcut?.[0]}
      onClick={() => runAction(id)}
    >
      <Icon name={icon ?? a.icon ?? 'info'} size={ICON_SIZE[variant]} />
      <span className="rb-label">{text}</span>
    </button>
  );
}

/** Button that opens a dropdown menu. */
export function MenuButton({
  label,
  icon,
  variant = 'small',
  children,
  tip,
}: {
  label: string;
  icon: string;
  variant?: RbVariant;
  tip?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`rb rb-${variant}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={tip ?? label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} size={ICON_SIZE[variant]} />
        <span className="rb-label">
          {label}
          <Icon name="chevron-down" size={12} className="rb-chevron" />
        </span>
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={label}>
        {children(close)}
      </Menu>
    </>
  );
}

/**
 * Paint-style split button: the icon half runs the main action, the labelled half opens a menu
 * of related commands.
 */
export function SplitButton({
  id,
  label,
  icon,
  menuLabel,
  children,
}: {
  id: string;
  label?: string;
  icon?: string;
  menuLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const a = action(id);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const enabled = useUi((s) => (a.enabled ? a.enabled(s) : true));
  const checked = useUi((s) => (a.checked ? a.checked(s) : undefined));
  const text = label ?? t(a.labelKey);
  return (
    <span className="rb-split" style={{ display: 'inline-flex', flexDirection: 'column', width: 60 }}>
      <button
        type="button"
        className="rb rb-large"
        style={{ height: 40, paddingTop: 7, justifyContent: 'center' }}
        aria-pressed={checked}
        disabled={!enabled}
        aria-label={text}
        data-tip={text}
        data-kbd={a.shortcut?.[0]}
        onClick={() => runAction(id)}
      >
        <Icon name={icon ?? a.icon ?? 'info'} size={26} />
      </button>
      <button
        ref={ref}
        type="button"
        className="rb rb-small"
        style={{ justifyContent: 'center', padding: '0 2px', height: 24 }}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={menuLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="rb-label" style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {text}
          <Icon name="chevron-down" size={12} className="rb-chevron" />
        </span>
      </button>
      <Menu anchor={ref} open={open} onClose={close} label={menuLabel}>
        {children(close)}
      </Menu>
    </span>
  );
}

export function RibbonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`ribbon-group${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      <div className="ribbon-group-body">{children}</div>
      <div className="ribbon-group-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}
