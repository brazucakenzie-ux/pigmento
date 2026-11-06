import { useState } from 'react';
import { FORMATS, type ImageFormat } from '@shared/formats';
import { sizeAllowed } from '@engine/Engine';
import { MAX_PIXELS } from '@engine/io/protocol';
import type { Resample } from '@engine/raster/transform';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, Segmented, Slider } from '../components/Controls';
import { engine } from '../state/engine';
import { closeDialog, useUi } from '../state/store';
import { copyImage, exportImage, isLayered, rememberExport, type ExportChoice } from '../services/files';

const SCALES = [1, 2, 3] as const;

/** File → Export: a copy of the image in any format and size; the open document doesn't change. */
export function ExportDialog() {
  const saved = useUi((s) => s.settings.export);
  const doc = useUi((s) => s.doc);
  const activeId = useUi((s) => s.layers.activeId);
  const [format, setFormat] = useState<ImageFormat>(saved.format);
  const [quality, setQuality] = useState(saved.format === 'webp' ? saved.webpQuality : saved.jpegQuality);
  const [scale, setScale] = useState(saved.scale);
  const [method, setMethod] = useState<Resample>(saved.resample);
  const [transparent, setTransparent] = useState(engine.doc.paper === null || engine.doc.paper.a < 255);
  const [source, setSource] = useState<'image' | 'layer'>('image');
  const [busy, setBusy] = useState(false);

  const info = FORMATS[format];
  const formatName = t(info.labelKey as I18nKey);
  const layered = isLayered();
  const layerName = engine.doc.layerById(activeId)?.name ?? '';
  const out = { w: Math.max(1, Math.round(doc.width * scale)), h: Math.max(1, Math.round(doc.height * scale)) };
  const fits = sizeAllowed(out.w, out.h);

  const choice = (): ExportChoice => ({
    format,
    quality: info.lossy ? quality : 100,
    scale,
    method,
    transparent: transparent && info.alpha,
    layerId: source === 'layer' ? activeId : null,
  });

  const changeFormat = (f: ImageFormat) => {
    setFormat(f);
    if (f === 'jpeg') setQuality(saved.jpegQuality);
    if (f === 'webp') setQuality(saved.webpQuality);
  };

  const run = async (fn: (c: ExportChoice) => Promise<boolean | void>) => {
    if (busy || !fits) return;
    const c = choice();
    setBusy(true);
    try {
      const ok = await fn(c);
      if (ok === false) return;
      rememberExport(c);
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('dialog.export.title')}
      onCancel={closeDialog}
      onSubmit={() => void run(exportImage)}
      className="export-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>
            {t('dialog.cancel')}
          </button>
          <button type="button" className="btn" disabled={busy || !fits} onClick={() => void run(copyImage)}>
            {t('dialog.export.copy')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !fits}>
            {t('dialog.export.submit')}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="export-format">{t('dialog.export.format')}</label>
        <select id="export-format" className="select" value={format} onChange={(e) => changeFormat(e.target.value as ImageFormat)}>
          {(Object.keys(FORMATS) as ImageFormat[]).map((f) => (
            <option key={f} value={f}>
              {t(FORMATS[f].labelKey as I18nKey)}
            </option>
          ))}
        </select>
      </div>
      {info.lossy ? (
        <div className="field">
          <label>{t('dialog.quality.label')}</label>
          <Slider value={quality} onChange={setQuality} min={1} max={100} label={t('dialog.quality.label')} unit="%" width={180} />
        </div>
      ) : null}
      <div className="field">
        <span className="label">{t('dialog.export.scale')}</span>
        <div className="row">
          <Segmented
            value={String(scale)}
            onChange={(v) => setScale(Number(v))}
            label={t('dialog.export.scale')}
            choices={SCALES.map((n) => ({ value: String(n), label: t('dialog.export.scaleN', { n }) }))}
          />
          <span className="unit" data-testid="export-size">
            {t('dialog.export.output', { w: out.w, h: out.h })}
          </span>
        </div>
      </div>
      {scale > 1 ? (
        <div className="field">
          <label htmlFor="export-resample">{t('dialog.export.resample')}</label>
          <select id="export-resample" className="select" value={method} onChange={(e) => setMethod(e.target.value as Resample)}>
            <option value="bicubic">{t('dialog.resize.quality.bicubic')}</option>
            <option value="bilinear">{t('dialog.resize.quality.bilinear')}</option>
            <option value="nearest">{t('dialog.resize.quality.nearest')}</option>
          </select>
        </div>
      ) : null}
      {!fits ? <p className="dialog-note warn">{t('dialog.export.tooLarge', { max: Math.round(MAX_PIXELS / 1e6) })}</p> : null}
      <div className="field">
        <span className="label">{t('dialog.export.background')}</span>
        <Checkbox
          checked={transparent && info.alpha}
          disabled={!info.alpha}
          onChange={setTransparent}
          label={t('dialog.export.transparent')}
        />
      </div>
      {!info.alpha ? <p className="dialog-note">{t('dialog.quality.flatten', { format: formatName })}</p> : null}
      {layered ? (
        <>
          <div className="field">
            <span className="label">{t('dialog.export.source')}</span>
            <div className="row">
              <Segmented
                value={source}
                onChange={(v) => setSource(v as 'image' | 'layer')}
                label={t('dialog.export.source')}
                choices={[
                  { value: 'image', label: t('dialog.export.sourceImage') },
                  { value: 'layer', label: t('dialog.export.sourceLayer') },
                ]}
              />
            </div>
          </div>
          {source === 'layer' ? <p className="dialog-note">{t('dialog.export.layerNote', { name: layerName })}</p> : null}
        </>
      ) : null}
    </Dialog>
  );
}
