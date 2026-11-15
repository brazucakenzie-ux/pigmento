import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Slider } from '../components/Controls';
import { Icon } from '../icons/Icon';
import { actions, type ActionGroup } from '../actions/actions';
import { comboOf, displayCombo, shortcutActions, shortcutsOf } from '../actions/keymap';
import { assignShortcut, canShare, isAssignable, isModifierKey, plainOverrides, removeShortcut, resetShortcut, shortcutOwners, type ShortcutOverrides } from '../actions/shortcuts';
import { closeDialog, updateSettings, useUi } from '../state/store';

export type SettingsPage = 'general' | 'shortcuts';
const PAGES: SettingsPage[] = ['general', 'shortcuts'];
const GROUPS: ActionGroup[] = ['file', 'edit', 'view', 'tools', 'image', 'colors'];

function GeneralPage() {
  const scale = useUi((s) => s.settings.ui.scale);
  return (
    <div className="settings-page">
      <div className="field">
        <span className="label">{t('settings.uiScale')}</span>
        <div className="row">
          <Slider label={t('settings.uiScale')} value={Math.round(scale * 100)} min={80} max={150} step={10} unit="%" onChange={(v) => updateSettings({ ui: { ...useUi.getState().settings.ui, scale: v / 100 } })} />
        </div>
      </div>
      <p className="dialog-note">{t('settings.uiScaleHint')}</p>
    </div>
  );
}

/** Waiting for a key: the action, and (after one is pressed) a clash to settle. */
interface Recording {
  id: string;
  clash: { combo: string; owners: string[]; share: boolean } | null;
}

function ShortcutsPage({ recording, setRecording }: { recording: Recording | null; setRecording: (r: Recording | null) => void }) {
  const overrides = useUi((s) => s.settings.shortcuts);
  const [query, setQuery] = useState('');
  const list = useMemo(() => shortcutActions(), []);
  const all = actions();
  const save = (next: ShortcutOverrides) => updateSettings({ shortcuts: plainOverrides(next) });
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((g) => ({
      group: g,
      items: [...all.values()]
        .filter((a) => a.group === g && !a.hidden)
        .filter((a) => !q || t(a.labelKey).toLowerCase().includes(q) || shortcutsOf(a.id, overrides).some((c) => displayCombo(c).toLowerCase().includes(q)))
        .sort((a, b) => t(a.labelKey).localeCompare(t(b.labelKey))),
    })).filter((g) => g.items.length);
  }, [query, all, overrides]);
  const assign = (id: string, combo: string, how: 'replace' | 'share') => {
    save(assignShortcut(list, overrides, id, combo, how));
    setRecording(null);
  };
  return (
    <div className="settings-page">
      <input
        type="search"
        className="text-input"
        placeholder={t('settings.searchShortcuts')}
        aria-label={t('settings.searchShortcuts')}
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />
      {recording?.clash ? (
        <div className="shortcut-clash" role="alert">
          <p>
            {t('settings.clash', {
              combo: displayCombo(recording.clash.combo),
              owners: recording.clash.owners.map((id) => t(all.get(id)!.labelKey)).join(', '),
            })}
          </p>
          <div className="row">
            <button type="button" className="btn small primary" onClick={() => assign(recording.id, recording.clash!.combo, 'replace')}>
              {t('settings.clashReplace')}
            </button>
            {recording.clash.share ? (
              <button type="button" className="btn small" onClick={() => assign(recording.id, recording.clash!.combo, 'share')}>
                {t('settings.clashShare')}
              </button>
            ) : null}
            <button type="button" className="btn small" onClick={() => setRecording(null)}>
              {t('dialog.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      <div className="shortcut-list">
        {rows.map((g) => (
          <section key={g.group} aria-label={t(`shortcut.group.${g.group}` as I18nKey)}>
            <h3>{t(`shortcut.group.${g.group}` as I18nKey)}</h3>
            {g.items.map((a) => {
              const keys = shortcutsOf(a.id, overrides);
              const label = t(a.labelKey);
              const changed = Object.prototype.hasOwnProperty.call(overrides, a.id);
              const waiting = recording?.id === a.id && !recording.clash;
              return (
                <div key={a.id} className="sc-row" role="group" aria-label={label}>
                  <span className="shortcut-name">{label}</span>
                  <span className="shortcut-keys">
                    {keys.map((k) => (
                      <span key={k} className="kbd-chip">
                        <kbd>{displayCombo(k)}</kbd>
                        <button type="button" className="icon-btn small" aria-label={t('settings.removeShortcut', { combo: displayCombo(k), action: label })} onClick={() => save(removeShortcut(list, overrides, a.id, k))}>
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    ))}
                    {waiting ? <span className="shortcut-waiting">{t('settings.pressKeys')}</span> : null}
                  </span>
                  <button type="button" className="btn small" aria-label={t('settings.addShortcut', { action: label })} aria-pressed={waiting} onClick={() => setRecording(waiting ? null : { id: a.id, clash: null })}>
                    <Icon name="plus" size={14} />
                  </button>
                  <button type="button" className="btn small" disabled={!changed} aria-label={t('settings.resetShortcut', { action: label })} data-tip={t('settings.resetShortcut', { action: label })} onClick={() => save(resetShortcut(overrides, a.id))}>
                    <Icon name="undo" size={14} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
        {rows.length === 0 ? <p className="dialog-note">{t('settings.noShortcuts')}</p> : null}
      </div>
    </div>
  );
}

/** Settings: General (interface scale) and keyboard shortcuts. Changes apply at once. */
export function SettingsDialog({ page: first = 'general' }: { page?: SettingsPage }) {
  const [page, setPage] = useState<SettingsPage>(first);
  const [recording, setRecordingState] = useState<Recording | null>(null);
  const recordingRef = useRef<Recording | null>(null);
  const setRecording = (r: Recording | null) => {
    recordingRef.current = r;
    setRecordingState(r);
  };
  const overrides = useUi((s) => s.settings.shortcuts);
  const anyChanged = Object.keys(overrides).length > 0;

  /** A key (or a side mouse button) pressed while waiting for one. */
  const take = (combo: string) => {
    const r = recordingRef.current;
    if (!r || r.clash) return;
    if (!isAssignable(combo)) return;
    const list = shortcutActions();
    const current = useUi.getState().settings.shortcuts;
    if (shortcutsOf(r.id, current).includes(combo)) return setRecording(null);
    const owners = shortcutOwners(list, current, combo, r.id).map((a) => a.id);
    if (owners.length === 0) {
      updateSettings({ shortcuts: plainOverrides(assignShortcut(list, current, r.id, combo, 'replace')) });
      return setRecording(null);
    }
    setRecording({ id: r.id, clash: { combo, owners, share: canShare(list, current, r.id, combo) } });
  };

  // Keys go to the recorder first, before the dialog (Esc only stops recording).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = recordingRef.current;
      if (!r || r.clash) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return setRecording(null);
      if (isModifierKey(e.key)) return;
      take(comboOf(e));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const onPointer = (e: ReactPointerEvent) => {
    if (!recordingRef.current || (e.button !== 3 && e.button !== 4)) return;
    e.preventDefault();
    take(e.button === 3 ? 'Mouse4' : 'Mouse5');
  };
  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = PAGES[(i + d + PAGES.length) % PAGES.length];
    setPage(next);
    requestAnimationFrame(() => document.getElementById(`settings-tab-${next}`)?.focus());
  };

  return (
    <Dialog
      title={t('settings.title')}
      onCancel={() => (recordingRef.current ? setRecording(null) : closeDialog())}
      className="settings-dialog"
      footer={
        <>
          {page === 'shortcuts' ? (
            <button type="button" className="btn" disabled={!anyChanged} onClick={() => updateSettings({ shortcuts: {} })}>
              {t('settings.resetAll')}
            </button>
          ) : null}
          <span className="spacer" />
          <button type="button" className="btn primary" onClick={closeDialog}>
            {t('dialog.close')}
          </button>
        </>
      }
    >
      <div onPointerDown={onPointer}>
        <div className="bd-tabs" role="tablist" aria-label={t('settings.title')}>
          {PAGES.map((p, i) => (
            <button
              key={p}
              id={`settings-tab-${p}`}
              type="button"
              role="tab"
              className="bd-tab"
              aria-selected={page === p}
              aria-controls="settings-panel"
              tabIndex={page === p ? 0 : -1}
              onClick={() => setPage(p)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t(`settings.page.${p}` as I18nKey)}
            </button>
          ))}
        </div>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${page}`}>
          {page === 'general' ? <GeneralPage /> : <ShortcutsPage recording={recording} setRecording={setRecording} />}
        </div>
      </div>
    </Dialog>
  );
}
