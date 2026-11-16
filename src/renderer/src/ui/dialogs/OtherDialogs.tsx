import { useEffect, useMemo, useState } from 'react';
import { FORMATS, type ImageFormat } from '@shared/formats';
import type { AutosaveEntry } from '@shared/ipc';
import { colorEquals, parseHex, toCss, toHex8, type RGBA } from '@engine/core/color';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Segmented, Slider } from '../components/Controls';
import { ColorFields, ColorPicker } from '../components/ColorPicker';
import { actions, type ActionGroup } from '../actions/actions';
import { displayCombo, shortcutsOf } from '../actions/keymap';
import { engine } from '../state/engine';
import { closeDialog, updateSettings, useUi, type DialogState } from '../state/store';
import { rememberQuality } from '../services/files';
import { discardAutosave, restoreAutosave } from '../services/autosave';
import { exportPaletteFile, importPaletteFile, resetPalette } from '../services/palette';

function addRecent(c: RGBA): void {
  const colors = useUi.getState().settings.colors;
  const hex = toHex8(c);
  updateSettings({ colors: { ...colors, recent: [hex, ...colors.recent.filter((r) => r !== hex)].slice(0, 12) } });
}

export function EditColorsDialog({ target: initial }: { target: 'primary' | 'secondary' }) {
  const colors = useUi((s) => s.colors);
  const saved = useUi((s) => s.settings.colors);
  const [target, setTarget] = useState(initial);
  const [value, setValue] = useState<RGBA>(colors[initial]);
  const current = colors[target];
  const switchTarget = (v: string) => {
    const next = v as 'primary' | 'secondary';
    setTarget(next);
    setValue(colors[next]);
  };
  const apply = () => {
    if (target === 'primary') engine.setPrimary(value);
    else engine.setSecondary(value);
    if (!colorEquals(value, current)) addRecent(value);
    closeDialog();
  };
  const addCustom = () => {
    const hex = toHex8(value);
    updateSettings({ colors: { ...saved, custom: [hex, ...saved.custom.filter((c) => c !== hex)].slice(0, 12) } });
  };
  const chips = (list: string[], label: I18nKey) =>
    list.length === 0 ? null : (
      <div>
        <div className="dialog-note" style={{ marginBottom: 6 }}>
          {t(label)}
        </div>
        <div className="cp-swatches">
          {list.map((hex) => {
            const c = parseHex(hex);
            if (!c) return null;
            return (
              <button
                key={hex}
                type="button"
                className="swatch"
                style={{ background: toCss(c) }}
                aria-label={t('colors.swatch', { hex: hex.slice(0, 7).toUpperCase() })}
                data-tip={hex.slice(0, 7).toUpperCase()}
                onClick={() => setValue(c)}
              />
            );
          })}
        </div>
      </div>
    );
  return (
    <Dialog title={t('colors.edit')} onCancel={closeDialog} onSubmit={apply}>
      <div className="field" style={{ gridTemplateColumns: '80px 1fr' }}>
        <span className="label">{t('colors.editing')}</span>
        <Segmented
          value={target}
          onChange={switchTarget}
          label={t('colors.editing')}
          choices={[
            { value: 'primary', label: t('colors.primaryShort') },
            { value: 'secondary', label: t('colors.secondaryShort') },
          ]}
        />
      </div>
      <div className="cp">
        <ColorPicker value={value} onChange={setValue} />
        <div className="cp-side">
          <div className="cp-compare" aria-hidden="true">
            <div style={{ background: toCss(value) }}>
              <span>{t('colors.new')}</span>
            </div>
            <div style={{ background: toCss(current) }}>
              <span>{t('colors.current')}</span>
            </div>
          </div>
          <ColorFields value={value} onChange={setValue} />
        </div>
      </div>
      {chips(saved.recent, 'colors.recent')}
      {chips(saved.custom, 'colors.custom')}
      <div className="palette-actions">
        <button type="button" className="btn small" onClick={addCustom}>
          {t('colors.addCustom')}
        </button>
        <span className="grow" />
        <button type="button" className="btn small" onClick={() => void importPaletteFile()}>
          {t('palette.import')}
        </button>
        <button type="button" className="btn small" onClick={() => void exportPaletteFile()}>
          {t('palette.export')}
        </button>
        {saved.palette ? (
          <button type="button" className="btn small" onClick={resetPalette}>
            {t('palette.reset')}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}

export function QualityDialog({ d }: { d: Extract<DialogState, { kind: 'quality' }> }) {
  const settings = useUi((s) => s.settings.export);
  const lossy = FORMATS[d.format].lossy;
  const [q, setQ] = useState(d.format === 'webp' ? settings.webpQuality : settings.jpegQuality);
  const name = t(FORMATS[d.format].labelKey as I18nKey);
  const cancel = () => {
    closeDialog();
    d.resolve(null);
  };
  const ok = () => {
    void rememberQuality(d.format as ImageFormat, q);
    closeDialog();
    d.resolve(q);
  };
  return (
    <Dialog title={t('dialog.quality.title', { format: name })} onCancel={cancel} onSubmit={ok} submitLabel={t('dialog.save')}>
      {lossy ? (
        <>
          <div className="field">
            <label>{t('dialog.quality.label')}</label>
            <Slider value={q} onChange={setQ} min={1} max={100} label={t('dialog.quality.label')} unit="%" width={180} />
          </div>
          <p className="dialog-note">{t('dialog.quality.hint')}</p>
        </>
      ) : null}
      {d.transparent && !FORMATS[d.format].alpha ? <p className="dialog-note">{t('dialog.quality.flatten', { format: name })}</p> : null}
      {d.layers ? <p className="dialog-note warn">{t('dialog.quality.layers', { format: name })}</p> : null}
      {d.selections ? <p className="dialog-note warn">{t('dialog.quality.selections', { format: name })}</p> : null}
    </Dialog>
  );
}

export function PasteLargerDialog({ d }: { d: Extract<DialogState, { kind: 'pasteLarger' }> }) {
  const done = (r: 'enlarge' | 'keep' | null) => {
    closeDialog();
    d.resolve(r);
  };
  return (
    <Dialog
      title={t('dialog.pasteLarger.title')}
      onCancel={() => done(null)}
      footer={
        <>
          <button type="button" className="btn" onClick={() => done(null)}>
            {t('dialog.cancel')}
          </button>
          <button type="button" className="btn" onClick={() => done('keep')}>
            {t('dialog.pasteLarger.keep')}
          </button>
          <button type="button" className="btn primary" data-autofocus onClick={() => done('enlarge')}>
            {t('dialog.pasteLarger.enlarge')}
          </button>
        </>
      }
    >
      <p className="dialog-note" style={{ fontSize: 'var(--fs-sm)' }}>
        {t('dialog.pasteLarger.body')}
      </p>
    </Dialog>
  );
}

const GROUP_LABEL: Record<ActionGroup, I18nKey> = {
  file: 'shortcut.group.file',
  edit: 'shortcut.group.edit',
  view: 'shortcut.group.view',
  tools: 'shortcut.group.tools',
  image: 'shortcut.group.image',
  colors: 'shortcut.group.colors',
  animation: 'shortcut.group.animation',
};

export function ShortcutsDialog() {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const out = new Map<ActionGroup, { label: string; keys: string[] }[]>();
    for (const a of actions().values()) {
      const keys = [...shortcutsOf(a.id)];
      if (!keys.length || a.hidden) continue;
      const label = t(a.labelKey);
      if (filter && !label.toLowerCase().includes(filter.toLowerCase())) continue;
      const list = out.get(a.group) ?? [];
      list.push({ label, keys });
      out.set(a.group, list);
    }
    return out;
  }, [filter]);
  const extra = [
    { label: `${t('action.nudge')} (Shift = 10 px)`, keys: ['←', '↑', '→', '↓'] },
    { label: t('action.commit'), keys: ['Enter'] },
    { label: t('action.cancel'), keys: ['Esc'] },
  ];
  return (
    <Dialog
      title={t('dialog.shortcuts.title')}
      onCancel={closeDialog}
      footer={
        <button type="button" className="btn primary" onClick={closeDialog}>
          {t('dialog.close')}
        </button>
      }
    >
      <input className="text-input" placeholder={t('dialog.shortcuts.filter')} aria-label={t('dialog.shortcuts.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="shortcuts">
        {[...groups.entries()].map(([g, list]) => (
          <div className="shortcut-group" key={g}>
            <h3>{t(GROUP_LABEL[g])}</h3>
            {list.map((r) => (
              <div className="shortcut-row" key={r.label}>
                <span>{r.label}</span>
                <span>
                  {r.keys.map((k) => (
                    <kbd key={k} style={{ marginLeft: 4 }}>
                      {displayCombo(k)}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
        {filter ? null : (
          <div className="shortcut-group">
            <h3>{t('shortcut.group.edit')}</h3>
            {extra.map((r) => (
              <div className="shortcut-row" key={r.label}>
                <span>{r.label}</span>
                <span>
                  {r.keys.map((k) => (
                    <kbd key={k} style={{ marginLeft: 4 }}>
                      {k}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}


function RecoverItem({ entry, onDone }: { entry: AutosaveEntry; onDone: (restored: boolean) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.thumbnail) return;
    const u = URL.createObjectURL(new Blob([entry.thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [entry.thumbnail]);
  const time = new Date(entry.savedAt).toLocaleString();
  return (
    <li className="recover-item">
      <span className="recover-thumb">{url ? <img src={url} alt="" /> : null}</span>
      <span className="recover-text">
        <strong>{entry.name}</strong>
        <span className="dialog-note">{t('dialog.recover.savedAt', { time })}</span>
      </span>
      <button type="button" className="btn small" onClick={() => void discardAutosave(entry).then(() => onDone(false))}>
        {t('dialog.recover.discard')}
      </button>
      <button type="button" className="btn small primary" onClick={() => void restoreAutosave(entry).then((ok) => ok && onDone(true))}>
        {t('dialog.recover.restore')}
      </button>
    </li>
  );
}

/** Offered at startup when a previous session left autosaved work behind. */
export function RecoverDialog({ items }: { items: AutosaveEntry[] }) {
  const [left, setLeft] = useState(items);
  const done = (id: string, restored: boolean) => {
    const rest = left.filter((e) => e.id !== id);
    setLeft(rest);
    // Restoring loads into this window, so one restore ends the dialog.
    if (restored || rest.length === 0) closeDialog();
  };
  return (
    <Dialog
      title={t('dialog.recover.title')}
      onCancel={closeDialog}
      footer={
        <button type="button" className="btn" onClick={closeDialog}>
          {t('dialog.recover.later')}
        </button>
      }
    >
      <p className="dialog-note" style={{ fontSize: 'var(--fs-sm)' }}>
        {t('dialog.recover.body')}
      </p>
      <ul className="recover-list">
        {left.map((e) => (
          <RecoverItem key={e.id} entry={e} onDone={(r) => done(e.id, r)} />
        ))}
      </ul>
    </Dialog>
  );
}
