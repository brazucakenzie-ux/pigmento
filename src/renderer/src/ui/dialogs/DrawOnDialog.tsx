import { useState } from 'react';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import { t, type I18nKey } from '../../i18n';
import { Dialog } from '../components/Dialog';
import { NumberField } from '../components/Controls';
import { engine } from '../state/engine';
import { closeDialog, useUi } from '../state/store';

/**
 * Draw on or Erase behind: key the selected shapes' trims so their outlines are drawn on (or taken
 * away from their start) between two frames, from the frame shown to the timeline's last frame
 * unless changed (one undo step).
 */
export function DrawOnDialog({ mode }: { mode: 'drawOn' | 'eraseBehind' }) {
  const anim = useUi((s) => s.animation);
  const [from, setFrom] = useState(anim.frame + 1);
  const [to, setTo] = useState(anim.length);
  const [easing, setEasing] = useState<Easing>('easeInOut');
  const frameField = (labelKey: I18nKey, value: number, set: (v: number) => void) => (
    <div className="field">
      <label>{t(labelKey)}</label>
      <div className="row">
        <NumberField value={value} min={1} max={anim.length} label={t(labelKey)} onChange={(v) => set(Math.round(v))} />
        <span className="unit">{t('timeline.ofFrames', { n: anim.length })}</span>
      </div>
    </div>
  );
  const ok = () => {
    closeDialog();
    engine.drawOn(mode, from - 1, to - 1, easing);
  };
  return (
    <Dialog title={t(mode === 'drawOn' ? 'dialog.drawOn.title' : 'dialog.eraseBehind.title')} onCancel={closeDialog} onSubmit={ok} submitLabel={t('dialog.drawOn.ok')}>
      <p className="dialog-note">{t(mode === 'drawOn' ? 'dialog.drawOn.note' : 'dialog.eraseBehind.note')}</p>
      {frameField('dialog.drawOn.from', from, setFrom)}
      {frameField('dialog.drawOn.to', to, setTo)}
      <div className="field">
        <label htmlFor="draw-on-easing">{t('trim.easing')}</label>
        <select id="draw-on-easing" className="select" value={easing} onChange={(e) => setEasing(e.target.value as Easing)}>
          {EASINGS.map((e) => (
            <option key={e} value={e}>
              {t(`easing.${e}` as I18nKey)}
            </option>
          ))}
        </select>
      </div>
    </Dialog>
  );
}
