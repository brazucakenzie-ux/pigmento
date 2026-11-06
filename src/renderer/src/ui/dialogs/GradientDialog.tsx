import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { toHex8, type RGBA } from '@engine/core/color';
import { colorAt, GRADIENT_PRESETS, MAX_STOPS, presetStops, type GradientStop } from '@engine/raster/gradient';
import { stopsFromOptions } from '@engine/tools/builtin/gradient';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, NumberField } from '../components/Controls';
import { ColorFields, ColorPicker } from '../components/ColorPicker';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { closeDialog, useUi } from '../state/store';
import { gradientCss, stopCss } from '../app/PaintOptions';

/**
 * A gradient's colours (the Gradient tool's, or a shape's fill or outline): presets, then stops
 * that can be added, moved, recoloured and removed.
 */
export function GradientDialog({ toolId, optKey }: { toolId: string; optKey: string }) {
  const colors = useUi((s) => s.colors);
  const current = useUi((s) => s.toolOptions[toolId]?.[optKey] ?? engine.options(toolId)[optKey]);
  const [useColors, setUseColors] = useState(current === null || current === undefined);
  const [custom, setCustom] = useState<GradientStop[]>(() => stopsFromOptions(current, colors.primary, colors.secondary));
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  const fromColors = stopsFromOptions(null, colors.primary, colors.secondary);
  const shown = useColors ? fromColors : custom;
  const selected = shown[Math.min(sel, shown.length - 1)];

  /**
   * Any edit makes the gradient custom (no longer following the picked colours). Edits are
   * functions of the latest stops, so two quick events (a blur and a click) can't undo each other.
   */
  const edit = (change: (stops: GradientStop[]) => GradientStop[], select?: number) => {
    const base = useColors ? fromColors : null;
    setUseColors(false);
    setCustom((prev) => change(base ?? prev));
    if (select !== undefined) setSel(select);
  };
  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };

  const addStop = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (shown.length >= MAX_STOPS || e.target !== bar.current) return;
    const pos = posAt(e.clientX);
    edit((s) => [...s, { pos, color: colorAt(s, pos) }], shown.length);
  };
  const startDrag = (i: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = i;
    setSel(i);
  };
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const i = drag.current;
    if (i === null) return;
    const pos = posAt(e.clientX);
    edit((s) => s.map((x, k) => (k === i ? { ...x, pos } : x)));
  };
  const setColor = (c: RGBA) => edit((s) => s.map((x, k) => (k === sel ? { ...x, color: c } : x)));
  const setPos = (v: number) => edit((s) => s.map((x, k) => (k === sel ? { ...x, pos: v / 100 } : x)));
  const remove = () => {
    if (shown.length <= 2) return;
    edit((s) => s.filter((_, k) => k !== sel), Math.max(0, sel - 1));
  };

  const ok = () => {
    engine.setToolOption(toolId, optKey, useColors ? null : custom.map((s) => ({ pos: s.pos, color: toHex8(s.color) })));
    closeDialog();
  };

  return (
    <Dialog title={t('dialog.gradient.title')} onCancel={closeDialog} onSubmit={ok} className="gradient-dialog">
      <div className="field-block">
        <span className="label">{t('dialog.gradient.presets')}</span>
        <div className="gradient-presets" role="group" aria-label={t('dialog.gradient.presets')}>
          {GRADIENT_PRESETS.map((p) => {
            const ps = presetStops(p, colors.primary, colors.secondary);
            const name = t(p.labelKey as I18nKey);
            return (
              <button
                key={p.id}
                type="button"
                className="gradient-preset checker-bg"
                aria-label={name}
                data-tip={name}
                onClick={() => {
                  setSel(0);
                  if (p.id === 'colors') setUseColors(true);
                  else edit(() => ps);
                }}
              >
                <span style={{ background: gradientCss(ps) }} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="gradient-editor">
        <div ref={bar} className="gradient-bar checker-bg" role="img" aria-label={t('dialog.gradient.bar')} data-tip={t('dialog.gradient.bar')} onPointerDown={addStop}>
          <span style={{ background: gradientCss(shown) }} />
        </div>
        <div className="gradient-stops">
          {shown.map((s, i) => (
            <button
              key={i}
              type="button"
              className={`gradient-stop ${i === sel ? 'current' : ''}`}
              style={{ left: `${s.pos * 100}%` }}
              aria-label={t('dialog.gradient.stop', { pos: Math.round(s.pos * 100) })}
              aria-pressed={i === sel}
              onPointerDown={(e) => startDrag(i, e)}
              onPointerMove={moveDrag}
              onPointerUp={() => (drag.current = null)}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' ? 0.01 : e.key === 'ArrowLeft' ? -0.01 : 0;
                if (!d) return;
                e.preventDefault();
                const step = d * (e.shiftKey ? 10 : 1);
                edit((list) => list.map((x, k) => (k === i ? { ...x, pos: Math.max(0, Math.min(1, x.pos + step)) } : x)));
              }}
            >
              <span style={{ background: stopCss(s.color) }} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="gradient-pos">{t('dialog.gradient.position')}</label>
        <div className="row">
          <NumberField id="gradient-pos" value={Math.round(selected.pos * 1000) / 10} decimals={1} min={0} max={100} label={t('dialog.gradient.position')} onChange={setPos} />
          <span className="unit">%</span>
          <button type="button" className="btn small" disabled={shown.length <= 2} onClick={remove}>
            <Icon name="delete" size={15} />
            {t('dialog.gradient.deleteStop')}
          </button>
        </div>
      </div>
      <div className="cp">
        <ColorPicker value={selected.color} onChange={setColor} />
        <div className="cp-side">
          <ColorFields value={selected.color} onChange={setColor} />
        </div>
      </div>
      <div className="field">
        <span />
        <Checkbox
          checked={useColors}
          onChange={(v) => {
            if (!v) setCustom(fromColors);
            setUseColors(v);
          }}
          label={t('dialog.gradient.useColors')}
        />
      </div>
      {useColors ? <p className="dialog-note">{t('dialog.gradient.useColorsHint')}</p> : null}
    </Dialog>
  );
}
