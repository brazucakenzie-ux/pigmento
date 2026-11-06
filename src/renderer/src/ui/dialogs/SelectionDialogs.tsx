import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toCss } from '@engine/core/color';
import type { Selection, SelectionMode, SelectionModify } from '@engine/doc/Selection';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, NumberField, Segmented, Slider } from '../components/Controls';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { closeDialog, useUi } from '../state/store';

const MODES: SelectionMode[] = ['replace', 'add', 'subtract', 'intersect'];

function ModeField({ value, onChange, labelKey }: { value: SelectionMode; onChange: (m: SelectionMode) => void; labelKey: I18nKey }) {
  return (
    <div className="field">
      <span className="label">{t(labelKey)}</span>
      <div className="row">
        <Segmented
          value={value}
          onChange={(v) => onChange(v as SelectionMode)}
          label={t(labelKey)}
          choices={MODES.map((m) => ({ value: m, label: t(`mode.${m}` as I18nKey) }))}
        />
      </div>
    </div>
  );
}

const MODIFY_MAX: Record<SelectionModify, number> = { feather: 250, grow: 500, shrink: 500, border: 200 };
const MODIFY_DEFAULT: Record<SelectionModify, number> = { feather: 8, grow: 4, shrink: 4, border: 8 };

/** Select → Modify → Feather / Grow / Shrink / Border. */
export function ModifySelectionDialog({ op }: { op: SelectionModify }) {
  const [amount, setAmount] = useState(MODIFY_DEFAULT[op]);
  const [edges, setEdges] = useState(false);
  const label = t(`dialog.modify.amount.${op}` as I18nKey);
  const apply = () => {
    // When nothing would stay selected the engine says so and the dialog stays open.
    if (engine.modifySelection(op, amount, edges)) closeDialog();
  };
  return (
    <Dialog title={t(`dialog.modify.title.${op}` as I18nKey)} onCancel={closeDialog} onSubmit={apply}>
      <div className="field">
        <label htmlFor="modify-amount">{label}</label>
        <div className="row">
          <NumberField id="modify-amount" value={amount} min={1} max={MODIFY_MAX[op]} label={label} onChange={setAmount} />
          <span className="unit">px</span>
        </div>
      </div>
      <p className="dialog-note">{t(`dialog.modify.hint.${op}` as I18nKey)}</p>
      {op !== 'grow' ? (
        <div className="field">
          <span />
          <Checkbox checked={edges} onChange={setEdges} label={t('dialog.modify.edges')} />
        </div>
      ) : null}
    </Dialog>
  );
}

/** Select → Colour range: every pixel close to a colour, previewed live. */
export function ColorRangeDialog() {
  const colors = useUi((s) => s.colors);
  const [source, setSource] = useState<'primary' | 'secondary'>('primary');
  const [tolerance, setTolerance] = useState(20);
  const [sampleAll, setSampleAll] = useState(true);
  const [mode, setMode] = useState<SelectionMode>('replace');
  // The selection when the dialog opened: the preview builds on it, Cancel puts it back.
  const original = useRef<Selection | null>(engine.doc.selection);
  const tol = useDeferredValue(tolerance);
  const compute = useMemo(() => engine.colorRange(sampleAll), [sampleAll]);
  const picked = useMemo(() => compute(colors[source], tol), [compute, colors, source, tol]);
  const combined = useMemo(() => {
    const o = original.current;
    if (o) return o.combine(picked, mode);
    return mode === 'replace' || mode === 'add' ? picked : null;
  }, [picked, mode]);

  useEffect(() => engine.setSelection(combined), [combined]);

  const cancel = () => {
    engine.setSelection(original.current);
    closeDialog();
  };
  const ok = () => {
    engine.setSelection(original.current);
    engine.applySelection(picked, mode, 'history.colorRange');
    closeDialog();
  };
  const count = picked ? picked.area() : 0;
  return (
    <Dialog title={t('dialog.colorRange.title')} onCancel={cancel} onSubmit={ok}>
      <div className="field">
        <span className="label">{t('dialog.colorRange.color')}</span>
        <div className="row">
          <span className="range-swatch" style={{ background: toCss(colors[source]) }} aria-hidden="true" />
          <Segmented
            value={source}
            onChange={(v) => setSource(v as 'primary' | 'secondary')}
            label={t('dialog.colorRange.color')}
            choices={[
              { value: 'primary', label: t('dialog.colorRange.primary') },
              { value: 'secondary', label: t('dialog.colorRange.secondary') },
            ]}
          />
        </div>
      </div>
      <div className="field">
        <label>{t('dialog.colorRange.tolerance')}</label>
        <Slider value={tolerance} onChange={setTolerance} min={0} max={100} label={t('dialog.colorRange.tolerance')} unit="%" width={180} />
      </div>
      <div className="field">
        <span />
        <Checkbox checked={sampleAll} onChange={setSampleAll} label={t('dialog.colorRange.sampleAll')} />
      </div>
      <ModeField value={mode} onChange={setMode} labelKey="dialog.colorRange.mode" />
      <p className="dialog-note" role="status" data-testid="color-range-count">
        {count > 0 ? t('dialog.colorRange.count', { n: count.toLocaleString() }) : t('dialog.colorRange.none')}
      </p>
    </Dialog>
  );
}

/** Select → Save selection: keep the selection with the document under a name. */
export function SaveSelectionDialog() {
  const n = useUi((s) => s.savedSelections.length) + 1;
  const [name, setName] = useState(() => t('dialog.saveSelection.default', { n }));
  const submit = () => {
    const v = name.trim();
    if (!v) return;
    engine.saveSelection(v);
    closeDialog();
  };
  return (
    <Dialog title={t('dialog.saveSelection.title')} onCancel={closeDialog} onSubmit={submit} submitLabel={t('dialog.save')} submitDisabled={!name.trim()}>
      <div className="field">
        <label htmlFor="save-selection-name">{t('dialog.saveSelection.name')}</label>
        <input id="save-selection-name" className="text-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="dialog-note">{t('dialog.saveSelection.hint')}</p>
    </Dialog>
  );
}

/** Select → Load selection: pick a saved selection and how to combine it. */
export function LoadSelectionDialog() {
  const list = useUi((s) => s.savedSelections);
  const [id, setId] = useState<string | null>(list.length ? list[list.length - 1].id : null);
  const [mode, setMode] = useState<SelectionMode>('replace');
  useEffect(() => {
    if (id && !list.some((s) => s.id === id)) setId(list.length ? list[list.length - 1].id : null);
  }, [list, id]);
  const submit = () => {
    if (!id) return;
    engine.loadSelection(id, mode);
    closeDialog();
  };
  return (
    <Dialog title={t('dialog.loadSelection.title')} onCancel={closeDialog} onSubmit={submit} submitLabel={t('dialog.load')} submitDisabled={!id}>
      {list.length === 0 ? (
        <p className="dialog-note">{t('dialog.loadSelection.empty')}</p>
      ) : (
        <>
          <div className="saved-selections" role="radiogroup" aria-label={t('dialog.loadSelection.list')}>
            {list.map((s) => (
              <div key={s.id} className={`saved-selection ${s.id === id ? 'current' : ''}`}>
                <label>
                  <input type="radio" name="saved-selection" checked={s.id === id} onChange={() => setId(s.id)} />
                  <span className="name">{s.name}</span>
                  <span className="unit">{t('dialog.loadSelection.size', { w: s.w, h: s.h })}</span>
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('dialog.loadSelection.delete', { name: s.name })}
                  data-tip={t('dialog.loadSelection.delete', { name: s.name })}
                  onClick={() => engine.deleteSavedSelection(s.id)}
                >
                  <Icon name="delete" size={16} />
                </button>
              </div>
            ))}
          </div>
          <ModeField value={mode} onChange={setMode} labelKey="dialog.loadSelection.mode" />
        </>
      )}
    </Dialog>
  );
}
