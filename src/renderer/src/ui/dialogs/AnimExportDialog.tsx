import { useRef, useState } from 'react';
import { LOOP_MODES, type LoopMode } from '@engine/anim/timeline';
import { exportSize, frameSequence } from '@engine/anim/exportFrames';
import type { AnimFormat, VideoQuality } from '@engine/io/animExport';
import { avcCodecFor } from '@engine/io/mp4';
import { sizeAllowed } from '@engine/Engine';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { Checkbox, NumberField, Segmented } from '../components/Controls';
import { engine } from '../state/engine';
import { closeDialog, updateSettings, useUi } from '../state/store';
import { exportAnimation } from '../services/animExport';

const SCALES = [0.5, 1, 2] as const;
const QUALITIES: VideoQuality[] = ['low', 'medium', 'high'];
/** Formats offered. MP4 uses the PC's H.264 encoder through WebCodecs. */
export const ANIM_FORMATS: AnimFormat[] = ['gif', 'mp4'];

/** Animate → Export animation: the frames as an animated GIF (or a video), with progress and Stop. */
export function AnimExportDialog() {
  const anim = useUi((s) => s.animation);
  const saved = useUi((s) => s.settings.anim);
  const doc = useUi((s) => s.doc);
  const [format, setFormat] = useState<AnimFormat>(ANIM_FORMATS.includes(saved.exportFormat) ? saved.exportFormat : 'gif');
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(anim.length);
  const [scale, setScale] = useState<number>(SCALES.includes(saved.exportScale as 0.5 | 1 | 2) ? saved.exportScale : 1);
  const [playback, setPlayback] = useState<LoopMode>(anim.loop);
  const [transparent, setTransparent] = useState(engine.doc.paper === null || engine.doc.paper.a < 255);
  const [quality, setQuality] = useState<VideoQuality>(saved.exportQuality);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const out = exportSize(doc.width, doc.height, scale);
  const fits = sizeAllowed(out.w, out.h) && (format !== 'mp4' || avcCodecFor(out.w + (out.w & 1), out.h + (out.h & 1)) !== null);
  const a = Math.max(1, Math.min(from, anim.length));
  const b = Math.max(1, Math.min(to, anim.length));
  const count = frameSequence(a - 1, b - 1, playback).length;
  const seconds = count / anim.fps;
  const busy = progress !== null;

  const run = async () => {
    if (busy || !fits) return;
    updateSettings({ anim: { ...useUi.getState().settings.anim, exportFormat: format, exportScale: scale, exportQuality: quality } });
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress({ done: 0, total: count });
    const ok = await exportAnimation(
      { format, from: a - 1, to: b - 1, scale, playback, transparent, quality },
      (done, total) => !ctl.signal.aborted && setProgress({ done, total }),
      ctl.signal,
    );
    abort.current = null;
    setProgress(null);
    if (ok) closeDialog();
  };

  const cancel = () => {
    if (abort.current) {
      abort.current.abort();
      return;
    }
    closeDialog();
  };

  return (
    <Dialog
      title={t('animExport.title')}
      onCancel={cancel}
      onSubmit={() => void run()}
      className="export-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={cancel}>
            {busy ? t('animExport.stop') : t('dialog.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !fits}>
            {t('animExport.submit')}
          </button>
        </>
      }
    >
      {ANIM_FORMATS.length > 1 ? (
        <div className="field">
          <span className="label">{t('animExport.format')}</span>
          <Segmented
            value={format}
            onChange={(v) => setFormat(v as AnimFormat)}
            label={t('animExport.format')}
            choices={ANIM_FORMATS.map((f) => ({ value: f, label: t(`animExport.format.${f}` as I18nKey) }))}
          />
        </div>
      ) : null}
      <div className="field">
        <span className="label">{t('animExport.frames')}</span>
        <div className="row">
          <NumberField className="num" value={a} min={1} max={anim.length} label={t('animExport.from')} onChange={setFrom} />
          <span className="unit">{t('animExport.to')}</span>
          <NumberField className="num" value={b} min={1} max={anim.length} label={t('animExport.toField')} onChange={setTo} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="anim-export-playback">{t('timeline.loop')}</label>
        <select id="anim-export-playback" className="select" value={playback} onChange={(e) => setPlayback(e.target.value as LoopMode)}>
          {LOOP_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`loop.${m}` as I18nKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="label">{t('dialog.export.scale')}</span>
        <div className="row">
          <Segmented
            value={String(scale)}
            onChange={(v) => setScale(Number(v))}
            label={t('dialog.export.scale')}
            choices={SCALES.map((n) => ({ value: String(n), label: t('animExport.scaleN', { n: n * 100 }) }))}
          />
          <span className="unit" data-testid="anim-export-size">
            {t('dialog.export.output', { w: out.w, h: out.h })}
          </span>
        </div>
      </div>
      {format === 'gif' ? (
        <div className="field">
          <span className="label">{t('dialog.export.background')}</span>
          <Checkbox checked={transparent} onChange={setTransparent} label={t('dialog.export.transparent')} />
        </div>
      ) : (
        <div className="field">
          <span className="label">{t('animExport.quality')}</span>
          <Segmented
            value={quality}
            onChange={(v) => setQuality(v as VideoQuality)}
            label={t('animExport.quality')}
            choices={QUALITIES.map((q) => ({ value: q, label: t(`animExport.quality.${q}` as I18nKey) }))}
          />
        </div>
      )}
      <p className="dialog-note">{t('animExport.summary', { frames: count, seconds: seconds.toFixed(1), fps: anim.fps })}</p>
      {!fits ? <p className="dialog-note warn">{t(format === 'mp4' ? 'animExport.tooLargeVideo' : 'animExport.tooLarge')}</p> : null}
      <div className="filter-progress" role="status" aria-live="polite">
        {progress ? (
          <>
            <span className="filter-progress-bar" role="progressbar" aria-label={t('animExport.progress')} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </span>
            <span>{t('animExport.working', { done: progress.done, total: progress.total })}</span>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
