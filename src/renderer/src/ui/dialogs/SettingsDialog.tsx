import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { NumberField, Segmented, Slider } from '../components/Controls';
import { ASSISTANT_PERMISSIONS, type AssistantPermission, type Settings } from '@shared/settings';
import { clientSnippet, httpAddress, MCP_CLIENTS, type McpClient, type McpCommand } from '@shared/mcpSetup';
import { Icon } from '../icons/Icon';
import { actions, type ActionGroup } from '../actions/actions';
import { comboOf, displayCombo, shortcutActions, shortcutsOf } from '../actions/keymap';
import { assignShortcut, canShare, isAssignable, isModifierKey, plainOverrides, removeShortcut, resetShortcut, shortcutOwners, type ShortcutOverrides } from '../actions/shortcuts';
import { closeDialog, updateSettings, useUi } from '../state/store';

export type SettingsPage = 'general' | 'shortcuts' | 'assistants';
const PAGES: SettingsPage[] = ['general', 'shortcuts', 'assistants'];
const GROUPS: ActionGroup[] = ['file', 'edit', 'view', 'tools', 'image', 'colors', 'animation'];

function GeneralPage() {
  const scale = useUi((s) => s.settings.ui.scale);
  const mode = useUi((s) => s.settings.ui.mode);
  return (
    <div className="settings-page">
      <div className="field">
        <span className="label">{t('settings.mode')}</span>
        <div className="row">
          <Segmented
            label={t('settings.mode')}
            value={mode}
            choices={[
              { value: 'simple', label: t('mode.simple') },
              { value: 'full', label: t('mode.full') },
            ]}
            onChange={(v) => updateSettings({ ui: { ...useUi.getState().settings.ui, mode: v === 'simple' ? 'simple' : 'full' } })}
          />
        </div>
      </div>
      <p className="dialog-note">{t('settings.modeHint')}</p>
      <div className="field">
        <span className="label">{t('settings.uiScale')}</span>
        <div className="row">
          <Slider label={t('settings.uiScale')} value={Math.round(scale * 100)} min={80} max={200} step={5} unit="%" onChange={(v) => updateSettings({ ui: { ...useUi.getState().settings.ui, scale: v / 100 } })} />
        </div>
      </div>
      <p className="dialog-note">{t('settings.uiScaleHint')}</p>
    </div>
  );
}

const ASSISTANT_KINDS = ['look', 'edit', 'files', 'pictures', 'settings'] as const;

/** A new token for the local HTTP address (48 hex digits). */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Settings → AI assistants: whether they may connect, what they may do, how you watch, and how to connect a client. */
function AssistantsPage() {
  const a = useUi((s) => s.settings.assistants);
  const [cmd, setCmd] = useState<McpCommand | null>(null);
  const [client, setClient] = useState<McpClient>('claudeDesktop');
  const [byUrl, setByUrl] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    void window.pigmento.system.appInfo().then((i) => setCmd(i.mcp));
  }, []);
  const set = (change: Partial<Settings['assistants']>) => updateSettings({ assistants: { ...useUi.getState().settings.assistants, ...change } });
  const url = a.http && a.httpToken ? httpAddress(a.httpPort, a.httpToken) : null;
  const snippet = cmd ? clientSnippet(client, cmd, byUrl && url && client !== 'claudeDesktop' ? url : null) : null;
  const copy = (what: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    });
  };
  const chooseFolder = async () => {
    const folder = await window.pigmento.files.chooseFolder();
    if (folder) set({ folder });
  };
  return (
    <div className="settings-page assistants-page">
      <label className="check">
        <input type="checkbox" checked={a.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {t('assistants.enabled')}
      </label>
      <p className="dialog-note">{t('assistants.enabledHint')}</p>
      <fieldset className="assistants-options" disabled={!a.enabled}>
        <legend>{t('assistants.permissions')}</legend>
        {ASSISTANT_KINDS.map((k) => (
          <label key={k} className="field">
            <span className="label">{t(`assistants.kind.${k}` as I18nKey)}</span>
            <select className="select" value={a[k]} onChange={(e) => set({ [k]: e.target.value as AssistantPermission })}>
              {ASSISTANT_PERMISSIONS.map((p) => (
                <option key={p} value={p}>
                  {t(`assistants.permission.${p}` as I18nKey)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="dialog-note">{t('assistants.permissionsHint')}</p>
        <div className="assistants-folder-row">
          <label className="check">
            <input type="checkbox" checked={a.folder !== null} onChange={(e) => (e.target.checked ? void chooseFolder() : set({ folder: null }))} />
            {t('assistants.folderOnly')}
          </label>
          {a.folder ? (
            <div className="row">
              <span className="assistants-folder" data-tip={a.folder}>
                {a.folder}
              </span>
              <button type="button" className="btn small" onClick={() => void chooseFolder()}>
                {t('assistants.folderChange')}
              </button>
            </div>
          ) : null}
        </div>
        <div className="field">
          <span className="label">{t('assistants.pace')}</span>
          <div className="row">
            <Segmented
              label={t('assistants.pace')}
              value={a.pace}
              choices={[
                { value: 'watch', label: t('assistants.pace.watch') },
                { value: 'instant', label: t('assistants.pace.instant') },
              ]}
              onChange={(v) => set({ pace: v === 'instant' ? 'instant' : 'watch' })}
            />
          </div>
        </div>
      </fieldset>
      <fieldset className="assistants-options" disabled={!a.enabled}>
        <legend>{t('assistants.connect')}</legend>
        <label className="field">
          <span className="label">{t('assistants.client')}</span>
          <select className="select" value={client} onChange={(e) => setClient(e.target.value as McpClient)}>
            {MCP_CLIENTS.map((c) => (
              <option key={c} value={c}>
                {t(`assistants.client.${c}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
        <p className="dialog-note">{t(`assistants.where.${client}` as I18nKey)}</p>
        {url && client !== 'claudeDesktop' ? (
          <label className="check">
            <input type="checkbox" checked={byUrl} onChange={(e) => setByUrl(e.target.checked)} />
            {t('assistants.byUrl')}
          </label>
        ) : null}
        <pre className="assistants-snippet" tabIndex={0} aria-label={t('assistants.snippet')}>
          {snippet?.text ?? ''}
        </pre>
        <div className="row">
          <button type="button" className="btn small" disabled={!snippet} onClick={() => snippet && copy('snippet', snippet.text)}>
            <Icon name="copy" size={14} />
            {copied === 'snippet' ? t('assistants.copied') : t('assistants.copy')}
          </button>
        </div>
      </fieldset>
      <fieldset className="assistants-options" disabled={!a.enabled}>
        <legend>{t('assistants.http')}</legend>
        <label className="check">
          <input type="checkbox" checked={a.http} onChange={(e) => set(e.target.checked ? { http: true, httpToken: a.httpToken || newToken() } : { http: false })} />
          {t('assistants.httpOn')}
        </label>
        <p className="dialog-note">{t('assistants.httpHint')}</p>
        {a.http ? (
          <>
            <div className="field">
              <span className="label">{t('assistants.port')}</span>
              <div className="row">
                <NumberField className="num" value={a.httpPort} min={1024} max={65535} label={t('assistants.port')} onChange={(v) => set({ httpPort: v })} />
              </div>
            </div>
            {url ? (
              <div className="field">
                <span className="label">{t('assistants.address')}</span>
                <div className="assistants-address-box">
                  <code className="assistants-address">{url}</code>
                  <div className="row">
                    <button type="button" className="btn small" onClick={() => copy('address', url)}>
                      <Icon name="copy" size={14} />
                      {copied === 'address' ? t('assistants.copied') : t('assistants.copy')}
                    </button>
                    <button type="button" className="btn small" data-tip={t('assistants.newTokenTip')} onClick={() => set({ httpToken: newToken() })}>
                      {t('assistants.newToken')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </fieldset>
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

/** Settings: General (interface scale), keyboard shortcuts and AI assistants. Changes apply at once. */
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
          {page === 'general' ? <GeneralPage /> : page === 'assistants' ? <AssistantsPage /> : <ShortcutsPage recording={recording} setRecording={setRecording} />}
        </div>
      </div>
    </Dialog>
  );
}
