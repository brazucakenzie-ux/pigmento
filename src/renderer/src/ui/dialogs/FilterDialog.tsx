import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toHex6, type RGBA } from '@engine/core/color';
import { filterRegistry } from '@engine/filters/FilterRegistry';
import { FilterCancelled } from '@engine/filters/FilterPool';
import type { FilterSession } from '@engine/filters/FilterSession';
import { defaultParams, type FilterParam, type FilterParams } from '@engine/filters/types';
import { luma } from '@engine/filters/common';
import { smoothCurveAt } from '@engine/filters/adjustments';
import { t } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, Segmented, Slider } from '../components/Controls';
import { ColorPicker } from '../components/ColorPicker';
import { CurveEditor } from '../components/CurveEditor';
import { engine } from '../state/engine';
import { closeDialog, showToast } from '../state/store';
import { takeFilterSession } from '../services/filters';

/** Settings stay as they were last used while the app runs. */
const lastUsed = new Map<string, FilterParams>();

/** Brightness spread of the area being filtered (for Levels and Curves). */
function Histogram({ session }: { session: FilterSession }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const counts = useMemo(() => {
    const c = new Uint32Array(256);
    const d = session.layer.surface.readRect(session.region);
    // Every pixel of small areas, a sample of big ones.
    const step = Math.max(1, Math.floor(d.length / 4 / 400_000)) * 4;
    for (let i = 0; i < d.length; i += step) if (d[i + 3] > 0) c[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
    return c;
  }, [session]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const max = Math.max(1, ...counts);
    ctx.clearRect(0, 0, 256, 60);
    ctx.fillStyle = getComputedStyle(ref.current!).color;
    for (let v = 0; v < 256; v++) {
      const h = Math.round((Math.sqrt(counts[v]) / Math.sqrt(max)) * 60);
      ctx.fillRect(v, 60 - h, 1, h);
    }
  }, [counts]);
  return <canvas ref={ref} className="filter-histogram" width={256} height={60} role="img" aria-label={t('filterDialog.histogram')} />;
}

function ColorParam({ value, onChange, label }: { value: RGBA; onChange: (c: RGBA) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="row">
        <button type="button" className="filter-swatch" aria-label={`${label}: ${toHex6(value)}`} aria-expanded={open} data-tip={t('filterDialog.pickColor')} onClick={() => setOpen((o) => !o)}>
          <span style={{ background: toHex6(value) }} />
        </button>
        <button type="button" className="btn small" onClick={() => onChange({ ...engine.primary, a: 255 })}>
          {t('filterDialog.usePrimary')}
        </button>
      </div>
      {open ? <ColorPicker value={value} onChange={(c) => onChange({ ...c, a: 255 })} /> : null}
    </>
  );
}

/**
 * An adjustment's or filter's settings, with a live preview on the canvas (quick while
 * settings change, then full size) and Apply as one undo step.
 */
export function FilterDialog({ id }: { id: string }) {
  const def = filterRegistry.get(id)!;
  const [session] = useState(() => takeFilterSession() ?? engine.startFilter(id));
  const [params, setParams] = useState<FilterParams>(() => ({ ...defaultParams(def), ...lastUsed.get(id) }));
  const [preview, setPreview] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const job = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!session) closeDialog();
    return () => {
      job.current?.abort();
      session?.end();
    };
  }, [session]);

  // Quick preview at once, the full-size one when settings have been still for a moment.
  useEffect(() => {
    if (!session || applying) return;
    if (!preview) {
      session.clearPreview();
      return;
    }
    const ctl = new AbortController();
    const ignore = (err: unknown) => {
      if (!(err instanceof FilterCancelled)) showToast({ kind: 'error', key: 'error.filter', params: { name: t(def.labelKey) } });
    };
    session.preview(params, true, ctl.signal).catch(ignore);
    const timer = window.setTimeout(() => {
      setProgress(0);
      session
        .preview(params, false, ctl.signal, setProgress)
        .catch(ignore)
        .finally(() => !ctl.signal.aborted && setProgress(null));
    }, 350);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
      setProgress(null);
    };
  }, [session, params, preview, applying, def]);

  if (!session) return null;
  const set = (key: string, v: FilterParams[string]) => setParams((p) => ({ ...p, [key]: v }));

  const apply = async () => {
    if (applying) return;
    lastUsed.set(id, params);
    const ctl = new AbortController();
    job.current = ctl;
    setApplying(true);
    setProgress(0);
    try {
      const ok = await session.apply(params, ctl.signal, setProgress);
      if (ok) closeDialog();
    } catch (err) {
      if (!(err instanceof FilterCancelled)) {
        showToast({ kind: 'error', key: 'error.filter', params: { name: t(def.labelKey) } });
        closeDialog();
      }
    } finally {
      job.current = null;
      setApplying(false);
      setProgress(null);
    }
  };
  const stop = () => {
    job.current?.abort();
    // A long run's workers are stopped outright rather than left to finish.
    session.stopWorkers();
  };
  const cancel = () => {
    if (applying) return stop();
    closeDialog();
  };

  const field = (p: FilterParam) => {
    if (p.showIf && !p.showIf(params)) return null;
    const label = t(p.labelKey);
    const head = p.section ? (
      <h3 key={`${p.key}-section`} className="filter-section">
        {t(p.section)}
      </h3>
    ) : null;
    let control: ReactNode;
    if (p.type === 'slider') {
      control = (
        <div className="field">
          <span className="label">{label}</span>
          <div className="row">
            <Slider label={label} value={Number(params[p.key] ?? p.default)} min={p.min} max={p.max} step={p.step ?? 1} unit={p.unit} onChange={(v) => set(p.key, v)} />
          </div>
        </div>
      );
    } else if (p.type === 'toggle') {
      control = <Checkbox checked={params[p.key] === true} onChange={(v) => set(p.key, v)} label={label} />;
    } else if (p.type === 'choice') {
      control = (
        <div className="field">
          <span className="label">{label}</span>
          <div className="row">
            <Segmented label={label} value={String(params[p.key] ?? p.default)} choices={p.choices.map((c) => ({ value: c.value, label: t(c.labelKey) }))} onChange={(v) => set(p.key, v)} />
          </div>
        </div>
      );
    } else if (p.type === 'color') {
      control = (
        <div className="field">
          <span className="label">{label}</span>
          <ColorParam value={(params[p.key] as RGBA) ?? p.default} onChange={(c) => set(p.key, c)} label={label} />
        </div>
      );
    } else {
      control = <CurveEditor curve={(params[p.key] as typeof p.default) ?? p.default} label={label} shape={smoothCurveAt} onChange={(c) => set(p.key, c)} />;
    }
    return (
      <div key={p.key} className="filter-param">
        {head}
        {control}
      </div>
    );
  };

  return (
    <Dialog
      title={t(def.labelKey)}
      onCancel={cancel}
      onSubmit={() => void apply()}
      className="filter-dialog"
      footer={
        <>
          <Checkbox checked={preview} onChange={setPreview} label={t('filterDialog.preview')} />
          <button type="button" className="btn" disabled={applying} onClick={() => setParams(defaultParams(def))}>
            {t('filterDialog.reset')}
          </button>
          <span className="spacer" />
          {applying ? (
            <button type="button" className="btn" onClick={stop}>
              {t('filterDialog.stop')}
            </button>
          ) : (
            <button type="button" className="btn" onClick={closeDialog}>
              {t('dialog.cancel')}
            </button>
          )}
          <button type="submit" className="btn primary" disabled={applying}>
            {t('filterDialog.apply')}
          </button>
        </>
      }
    >
      {def.id === 'levels' || def.id === 'curves' ? <Histogram session={session} /> : null}
      {def.params.map(field)}
      {engine.doc.selection ? <p className="dialog-note">{t('filterDialog.selection')}</p> : null}
      <div className="filter-progress" role="status" aria-live="polite">
        {progress !== null ? (
          <>
            <span className="filter-progress-bar">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
            <span>{t('filterDialog.working', { percent: Math.round(progress * 100) })}</span>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
