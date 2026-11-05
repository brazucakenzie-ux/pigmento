import { t } from '../../i18n';
import { action, runAction } from '../actions/actions';
import { MenuItem } from '../components/Menu';
import { useUi } from '../state/store';

/** A menu entry bound to an action (label, icon, shortcut, enabled and checked state). */
export function ActionMenuItem({ id, close, label }: { id: string; close: () => void; label?: string }) {
  const a = action(id);
  const enabled = useUi((s) => (a.enabled ? a.enabled(s) : true));
  const checked = useUi((s) => (a.checked ? a.checked(s) : undefined));
  return (
    <MenuItem
      label={label ?? t(a.labelKey)}
      icon={a.icon}
      shortcut={a.shortcut?.[0]}
      checked={checked}
      disabled={!enabled}
      close={close}
      onSelect={() => runAction(id)}
    />
  );
}
