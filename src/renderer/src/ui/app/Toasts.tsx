import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { dismissToast, useUi } from '../state/store';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((n) => (
        <div key={n.id} className={`toast ${n.kind}`} role={n.kind === 'error' ? 'alert' : undefined}>
          <span className="toast-icon">
            <Icon name={n.kind === 'error' ? 'alert' : 'info'} size={18} />
          </span>
          <span className="msg">{t(n.key, n.params)}</span>
          <button type="button" className="icon-btn" aria-label={t('notice.dismiss')} onClick={() => dismissToast(n.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
