import logoUrl from '@resources/logo.svg?url';
import { t } from '../../i18n';
import { action, runAction } from '../actions/actions';
import { useShortcut } from '../actions/keymap';
import { Icon } from '../icons/Icon';
import { useUi } from '../state/store';
import { AssistantBadge } from './AssistantsUi';

function QuickButton({ id }: { id: string }) {
  const a = action(id);
  const kbd = useShortcut(id);
  const enabled = useUi((s) => (a.enabled ? a.enabled(s) : true));
  const label = t(a.labelKey);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      data-tip={label}
      data-kbd={kbd}
      disabled={!enabled}
      onClick={() => runAction(id)}
    >
      <Icon name={a.icon ?? 'info'} size={18} />
    </button>
  );
}

export function TopBar() {
  const name = useUi((s) => s.file.name) ?? t('doc.untitled');
  const dirty = useUi((s) => s.history.dirty);
  return (
    <header className="topbar">
      <div className="brand">
        <img src={logoUrl} alt="" />
        <span>{t('app.name')}</span>
      </div>
      <div className="quick" role="toolbar" aria-label={t('app.name')}>
        <QuickButton id="new" />
        <QuickButton id="open" />
        <QuickButton id="save" />
        <span className="divider" aria-hidden="true" />
        <QuickButton id="undo" />
        <QuickButton id="redo" />
      </div>
      <div className="title" aria-live="polite">
        {name}
        {dirty ? (
          <span className="dirty" aria-label={t('doc.unsaved')} title={t('doc.unsaved')}>
            ●
          </span>
        ) : null}
      </div>
      <AssistantBadge />
    </header>
  );
}
