import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Icon } from '../icons/Icon';
import { displayCombo } from '../actions/keymap';

interface MenuProps {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Open beside the anchor (submenus) instead of below it. */
  side?: 'below' | 'right';
  label: string;
}

function focusItem(menu: HTMLElement, dir: 1 | -1 | 'first' | 'last'): void {
  const items = [...menu.querySelectorAll<HTMLElement>(':scope > .menu-item:not(:disabled), :scope > .submenu > .menu-item:not(:disabled)')];
  if (items.length === 0) return;
  const idx = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (dir === 'first') next = 0;
  else if (dir === 'last') next = items.length - 1;
  else next = (idx + dir + items.length) % items.length;
  items[next].focus();
}

/** Popover menu anchored to an element; arrow keys move, Esc and outside clicks close. */
export function Menu({ anchor, open, onClose, children, side = 'below', label }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.matches(':popover-open')) {
      el.showPopover();
      const a = anchor.current?.getBoundingClientRect();
      if (a) {
        const r = el.getBoundingClientRect();
        let x = side === 'below' ? a.left : a.right + 2;
        let y = side === 'below' ? a.bottom + 4 : a.top - 6;
        x = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
        if (side === 'right' && a.right + r.width + 6 > window.innerWidth) x = Math.max(6, a.left - r.width - 2);
        y = Math.max(6, Math.min(y, window.innerHeight - r.height - 6));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      focusItem(el, 'first');
    } else if (!open && el.matches(':popover-open')) {
      el.hidePopover();
    }
  }, [open, anchor, side]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') onClose();
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [onClose]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.currentTarget !== el) return;
    if (e.key === 'ArrowDown') focusItem(el, 1);
    else if (e.key === 'ArrowUp') focusItem(el, -1);
    else if (e.key === 'Home') focusItem(el, 'first');
    else if (e.key === 'End') focusItem(el, 'last');
    else if (e.key === 'ArrowLeft' && side === 'right') {
      onClose();
      anchor.current?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} popover="auto" className="menu" role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {open ? children : null}
    </div>
  );
}

export interface MenuItemProps {
  label: string;
  icon?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  close: () => void;
}

export function MenuItem({ label, icon, shortcut, checked, disabled, onSelect, close }: MenuItemProps) {
  return (
    <button
      type="button"
      className="menu-item"
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <span className="mi-icon">{checked ? <Icon name="check" size={16} /> : icon ? <Icon name={icon} size={16} /> : null}</span>
      <span className="mi-label">{label}</span>
      {shortcut ? <span className="mi-shortcut">{displayCombo(shortcut)}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-sep" role="separator" />;
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <div className="menu-heading">{children}</div>;
}

/** Item that opens a nested menu to the side (hover, click, or →). */
export function SubMenu({ label, icon, children }: { label: string; icon?: string; children: (close: () => void) => ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const closeAll = useCallback(() => {
    setOpen(false);
    const parent = btn.current?.closest('.menu') as HTMLElement | null;
    if (parent?.matches(':popover-open')) parent.hidePopover();
  }, []);
  return (
    <div className="submenu">
      <button
        ref={btn}
        type="button"
        className="menu-item"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            setOpen(true);
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onPointerEnter={() => setOpen(true)}
      >
        <span className="mi-icon">{icon ? <Icon name={icon} size={16} /> : null}</span>
        <span className="mi-label">{label}</span>
        <Icon name="chevron-right" size={14} />
      </button>
      <Menu anchor={btn} open={open} onClose={close} side="right" label={label}>
        {children(closeAll)}
      </Menu>
    </div>
  );
}
