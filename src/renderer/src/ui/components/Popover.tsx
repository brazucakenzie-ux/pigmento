import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/**
 * A panel of controls anchored below a button (not a menu: Tab moves through it). Esc and
 * clicks outside close it; focus goes to its first control when it opens.
 */
export function Popover({
  anchor,
  open,
  onClose,
  label,
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.matches(':popover-open')) {
      el.showPopover();
      const a = anchor.current?.getBoundingClientRect();
      if (a) {
        const r = el.getBoundingClientRect();
        const x = Math.max(6, Math.min(a.left, window.innerWidth - r.width - 6));
        const y = Math.max(6, Math.min(a.bottom + 4, window.innerHeight - r.height - 6));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
      el.querySelector<HTMLElement>('button:not(:disabled), input, select')?.focus();
    } else if (!open && el.matches(':popover-open')) {
      el.hidePopover();
    }
  }, [open, anchor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === 'closed') {
        onClose();
        // Hand focus back to the button when the popover closed from inside it (Esc).
        if (el.contains(document.activeElement) || document.activeElement === document.body) anchor.current?.focus();
      }
    };
    el.addEventListener('toggle', onToggle);
    return () => el.removeEventListener('toggle', onToggle);
  }, [onClose, anchor]);

  return (
    <div
      ref={ref}
      popover="auto"
      className={`popover ${className ?? ''}`}
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        // Esc closes the popover only (tools also use Esc, e.g. to deselect shapes).
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        ref.current?.hidePopover();
      }}
    >
      {open ? children : null}
    </div>
  );
}
