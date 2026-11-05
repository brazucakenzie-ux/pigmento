import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';

export interface DialogProps {
  title: string;
  onCancel: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  children: ReactNode;
  /** Replace the default Cancel/OK footer. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Modal dialog on the native <dialog> element: focus is trapped, Esc cancels, Enter in a field
 * submits. Every dialog in the app goes through this component.
 */
export function Dialog({ title, onCancel, onSubmit, submitLabel, submitDisabled, children, footer, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.showModal();
    const first = d.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea');
    first?.focus();
    if (first instanceof HTMLInputElement && first.type !== 'checkbox' && first.type !== 'range') first.select();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog ${className ?? ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        cancelRef.current();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit && !submitDisabled) onSubmit();
          else if (!onSubmit) onCancel();
        }}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('dialog.close')} data-tip={t('dialog.close')} onClick={onCancel}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">
          {footer ?? (
            <>
              <button type="button" className="btn" onClick={onCancel}>
                {t('dialog.cancel')}
              </button>
              <button type="submit" className="btn primary" disabled={submitDisabled}>
                {submitLabel ?? t('dialog.ok')}
              </button>
            </>
          )}
        </div>
      </form>
    </dialog>
  );
}
