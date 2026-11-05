import { useState } from 'react';
import { WHITE, toCss, type RGBA } from '@engine/core/color';
import type { Anchor } from '@engine/Engine';
import type { Resample } from '@engine/raster/transform';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, NumberField, Segmented } from '../components/Controls';
import { ColorFields, ColorPicker } from '../components/ColorPicker';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { closeDialog, updateSettings, useUi } from '../state/store';
import { newImage } from '../services/files';
import { reportEngineError } from '@engine/input/InputController';

function run(fn: () => void): void {
  try {
    fn();
    closeDialog();
  } catch (err) {
    reportEngineError(engine, err);
  }
}

type Unit = 'px' | 'in' | 'cm';
const toUnit = (px: number, unit: Unit, dpi: number) => (unit === 'px' ? px : unit === 'in' ? px / dpi : (px / dpi) * 2.54);
const fromUnit = (v: number, unit: Unit, dpi: number) => Math.max(1, Math.round(unit === 'px' ? v : unit === 'in' ? v * dpi : (v / 2.54) * dpi));

function SizeFields({
  w,
  h,
  setW,
  setH,
  unit,
  setUnit,
  dpi,
  keep,
  setKeep,
}: {
  w: number;
  h: number;
  setW: (v: number) => void;
  setH: (v: number) => void;
  unit: Unit;
  setUnit: (u: Unit) => void;
  dpi: number;
  keep?: boolean;
  setKeep?: (v: boolean) => void;
}) {
  const decimals = unit === 'px' ? 0 : 2;
  return (
    <>
      <div className="field">
        <span className="label">{t('dialog.units')}</span>
        <Segmented
          value={unit}
          onChange={(v) => setUnit(v as Unit)}
          label={t('dialog.units')}
          choices={[
            { value: 'px', label: t('dialog.unit.px') },
            { value: 'in', label: t('dialog.unit.in') },
            { value: 'cm', label: t('dialog.unit.cm') },
          ]}
        />
      </div>
      <div className="field">
        <label>{t('dialog.width')}</label>
        <div className="row">
          <NumberField value={toUnit(w, unit, dpi)} decimals={decimals} step={unit === 'px' ? 1 : 0.1} min={0.01} max={30000} label={t('dialog.width')} onChange={(v) => setW(fromUnit(v, unit, dpi))} />
          <span className="unit">{unit}</span>
        </div>
      </div>
      <div className="field">
        <label>{t('dialog.height')}</label>
        <div className="row">
          <NumberField value={toUnit(h, unit, dpi)} decimals={decimals} step={unit === 'px' ? 1 : 0.1} min={0.01} max={30000} label={t('dialog.height')} onChange={(v) => setH(fromUnit(v, unit, dpi))} />
          <span className="unit">{unit}</span>
        </div>
      </div>
      {setKeep ? (
        <div className="field">
          <span />
          <Checkbox checked={keep === true} onChange={setKeep} label={t('dialog.keepAspect')} />
        </div>
      ) : null}
    </>
  );
}

export function NewImageDialog() {
  const s = useUi((st) => st.settings.newImage);
  const secondary = useUi((st) => st.colors.secondary);
  const [w, setW] = useState(s.width);
  const [h, setH] = useState(s.height);
  const [dpi, setDpi] = useState(s.dpi);
  const [unit, setUnit] = useState<Unit>('px');
  const [paper, setPaper] = useState(s.paper);
  const presets: { key: I18nKey; w: number; h: number; dpi?: number; params?: Record<string, number> }[] = [
    { key: 'dialog.new.preset.screen', w: window.screen.width, h: window.screen.height, params: { w: window.screen.width, h: window.screen.height } },
    { key: 'dialog.new.preset.hd', w: 1920, h: 1080 },
    { key: 'dialog.new.preset.square', w: 1080, h: 1080 },
    { key: 'dialog.new.preset.a4', w: 2480, h: 3508, dpi: 300 },
    { key: 'dialog.new.preset.icon', w: 256, h: 256 },
  ];
  const submit = async () => {
    const paperColor: RGBA | null = paper === 'white' ? WHITE : paper === 'secondary' ? secondary : null;
    updateSettings({ newImage: { width: w, height: h, dpi, paper } });
    closeDialog();
    await newImage(w, h, paperColor, dpi);
  };
  return (
    <Dialog title={t('dialog.new.title')} onCancel={closeDialog} onSubmit={() => void submit()} submitLabel={t('dialog.create')}>
      <div className="field">
        <label htmlFor="new-preset">{t('dialog.new.presets')}</label>
        <select
          id="new-preset"
          className="select"
          defaultValue=""
          onChange={(e) => {
            const p = presets[Number(e.target.value)];
            if (!p) return;
            setW(p.w);
            setH(p.h);
            if (p.dpi) setDpi(p.dpi);
          }}
        >
          <option value="" disabled>
            —
          </option>
          {presets.map((p, i) => (
            <option key={p.key} value={i}>
              {t(p.key, p.params)}
            </option>
          ))}
        </select>
      </div>
      <SizeFields w={w} h={h} setW={setW} setH={setH} unit={unit} setUnit={setUnit} dpi={dpi} />
      <div className="field">
        <label>{t('dialog.resolution')}</label>
        <NumberField value={dpi} onChange={setDpi} min={1} max={10000} label={t('dialog.resolution')} />
      </div>
      <div className="field">
        <span className="label">{t('dialog.new.paper')}</span>
        <Segmented
          value={paper}
          onChange={(v) => setPaper(v as typeof paper)}
          label={t('dialog.new.paper')}
          choices={[
            { value: 'white', label: t('dialog.new.paper.white') },
            { value: 'transparent', label: t('dialog.new.paper.transparent') },
            { value: 'secondary', label: t('dialog.new.paper.secondary') },
          ]}
        />
      </div>
    </Dialog>
  );
}

export function ResizeDialog() {
  const doc = useUi((s) => s.doc);
  const sel = useUi((s) => s.selection.bounds);
  const resample = useUi((s) => s.settings.resample);
  const baseW = sel ? Math.max(1, Math.round(sel.w)) : doc.width;
  const baseH = sel ? Math.max(1, Math.round(sel.h)) : doc.height;
  const [by, setBy] = useState<'percent' | 'px'>('percent');
  const [w, setW] = useState(baseW);
  const [h, setH] = useState(baseH);
  const [keep, setKeep] = useState(true);
  const [method, setMethod] = useState<Resample>(resample);
  const [skewH, setSkewH] = useState(0);
  const [skewV, setSkewV] = useState(0);

  const setWidth = (v: number) => {
    setW(v);
    if (keep) setH(Math.max(1, Math.round((v * baseH) / baseW)));
  };
  const setHeight = (v: number) => {
    setH(v);
    if (keep) setW(Math.max(1, Math.round((v * baseW) / baseH)));
  };
  const submit = () =>
    run(() => {
      updateSettings({ resample: method });
      if (w !== baseW || h !== baseH) engine.resize(w, h, method);
      if (skewH !== 0 || skewV !== 0) engine.skew(skewH, skewV);
    });

  const pct = (v: number, base: number) => Math.round((v / base) * 1000) / 10;
  return (
    <Dialog title={t('dialog.resize.title')} onCancel={closeDialog} onSubmit={submit}>
      <p className="dialog-note">{t(sel ? 'dialog.resize.target.selection' : 'dialog.resize.target.image')}</p>
      <fieldset className="fieldset">
        <legend>{t('action.resize')}</legend>
        <div className="field">
          <span className="label">{t('dialog.resize.by')}</span>
          <Segmented
            value={by}
            onChange={(v) => setBy(v as 'percent' | 'px')}
            label={t('dialog.resize.by')}
            choices={[
              { value: 'percent', label: t('dialog.unit.percent') },
              { value: 'px', label: t('dialog.unit.px') },
            ]}
          />
        </div>
        <div className="field">
          <label>{t('dialog.width')}</label>
          <div className="row">
            {by === 'percent' ? (
              <NumberField value={pct(w, baseW)} decimals={1} min={0.1} max={10000} label={t('dialog.width')} onChange={(v) => setWidth(Math.max(1, Math.round((v / 100) * baseW)))} />
            ) : (
              <NumberField value={w} min={1} max={30000} label={t('dialog.width')} onChange={setWidth} />
            )}
            <span className="unit">{by === 'percent' ? '%' : 'px'}</span>
          </div>
        </div>
        <div className="field">
          <label>{t('dialog.height')}</label>
          <div className="row">
            {by === 'percent' ? (
              <NumberField value={pct(h, baseH)} decimals={1} min={0.1} max={10000} label={t('dialog.height')} onChange={(v) => setHeight(Math.max(1, Math.round((v / 100) * baseH)))} />
            ) : (
              <NumberField value={h} min={1} max={30000} label={t('dialog.height')} onChange={setHeight} />
            )}
            <span className="unit">{by === 'percent' ? '%' : 'px'}</span>
          </div>
        </div>
        <div className="field">
          <span />
          <Checkbox checked={keep} onChange={setKeep} label={t('dialog.keepAspect')} />
        </div>
        <div className="field">
          <label htmlFor="resample">{t('dialog.resize.quality')}</label>
          <select id="resample" className="select" value={method} onChange={(e) => setMethod(e.target.value as Resample)}>
            <option value="bicubic">{t('dialog.resize.quality.bicubic')}</option>
            <option value="bilinear">{t('dialog.resize.quality.bilinear')}</option>
            <option value="nearest">{t('dialog.resize.quality.nearest')}</option>
          </select>
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>{t('dialog.skew')}</legend>
        <div className="field">
          <label>{t('dialog.skew.h')}</label>
          <div className="row">
            <NumberField value={skewH} min={-89} max={89} label={t('dialog.skew.h')} onChange={setSkewH} />
            <span className="unit">°</span>
          </div>
        </div>
        <div className="field">
          <label>{t('dialog.skew.v')}</label>
          <div className="row">
            <NumberField value={skewV} min={-89} max={89} label={t('dialog.skew.v')} onChange={setSkewV} />
            <span className="unit">°</span>
          </div>
        </div>
      </fieldset>
    </Dialog>
  );
}

const ANCHORS: Anchor[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

export function CanvasSizeDialog() {
  const doc = useUi((s) => s.doc);
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [unit, setUnit] = useState<Unit>('px');
  const [anchor, setAnchor] = useState<Anchor>('c');
  return (
    <Dialog title={t('dialog.canvas.title')} onCancel={closeDialog} onSubmit={() => run(() => engine.canvasSize(w, h, anchor))}>
      <p className="dialog-note">{t('dialog.canvas.current', { w: doc.width, h: doc.height })}</p>
      <SizeFields w={w} h={h} setW={setW} setH={setH} unit={unit} setUnit={setUnit} dpi={doc.dpi} />
      <div className="field">
        <span className="label">{t('dialog.canvas.anchor')}</span>
        <div className="anchor-grid" role="radiogroup" aria-label={t('dialog.canvas.anchor')}>
          {ANCHORS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={anchor === a}
              aria-label={t('dialog.canvas.anchorCell', { pos: a.toUpperCase() })}
              onClick={() => setAnchor(a)}
            >
              {anchor === a ? <Icon name="plus" size={14} /> : <span style={{ width: 4, height: 4, borderRadius: 2, background: 'currentColor' }} />}
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function RotateDialog() {
  const [deg, setDeg] = useState(15);
  return (
    <Dialog title={t('dialog.rotate.title')} onCancel={closeDialog} onSubmit={() => run(() => engine.rotateFree(deg))}>
      <div className="field">
        <label>{t('dialog.rotate.angle')}</label>
        <div className="row">
          <NumberField value={deg} min={-360} max={360} decimals={1} step={1} label={t('dialog.rotate.angle')} onChange={setDeg} />
          <span className="unit">°</span>
        </div>
      </div>
    </Dialog>
  );
}

export function PropertiesDialog() {
  const doc = useUi((s) => s.doc);
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [unit, setUnit] = useState<Unit>('px');
  const [dpi, setDpi] = useState(doc.dpi);
  const [transparent, setTransparent] = useState(doc.paper === null);
  const [paper, setPaper] = useState<RGBA>(doc.paper ?? WHITE);
  const [picking, setPicking] = useState(false);
  const submit = () =>
    run(() => {
      engine.setProperties({ dpi, paper: transparent ? null : paper });
      if (w !== doc.width || h !== doc.height) engine.canvasSize(w, h, 'nw');
    });
  return (
    <Dialog title={t('dialog.props.title')} onCancel={closeDialog} onSubmit={submit}>
      <SizeFields w={w} h={h} setW={setW} setH={setH} unit={unit} setUnit={setUnit} dpi={dpi} />
      <div className="field">
        <label>{t('dialog.resolution')}</label>
        <NumberField value={dpi} onChange={setDpi} min={1} max={10000} label={t('dialog.resolution')} />
      </div>
      <fieldset className="fieldset">
        <legend>{t('dialog.props.paperColor')}</legend>
        <p className="dialog-note">{t('dialog.props.paperHint')}</p>
        <Checkbox checked={transparent} onChange={setTransparent} label={t('dialog.props.paperTransparent')} />
        {transparent ? null : (
          <div className="row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="color-chip" style={{ position: 'relative', display: 'inline-block' }} aria-hidden="true">
              <span style={{ background: toCss(paper) }} />
            </span>
            <button type="button" className="btn small" onClick={() => setPicking((p) => !p)}>
              {t('dialog.props.choose')}
            </button>
          </div>
        )}
        {picking && !transparent ? (
          <div className="cp">
            <ColorPicker value={paper} onChange={setPaper} />
            <ColorFields value={paper} onChange={setPaper} />
          </div>
        ) : null}
      </fieldset>
    </Dialog>
  );
}
