import { useRef, useState } from 'react';
import type { SpinFields } from '@engine/anim/AnimationController';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import { MAX_SPIN, type SpinAxes } from '@engine/anim/spin';
import { t, type I18nKey } from '../../i18n';
import { NumberField } from '../components/Controls';
import { Popover } from '../components/Popover';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { useUi } from '../state/store';

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The Spin button in the Animate and Perspective plane tools' options, and its popover: speeds the
 * piece turns at forever, keyed on their own. Its fields keep focus on Enter (unlike the options
 * bar's), so Esc closes the popover and nothing else.
 */
export function SpinButton({ spin, plane }: { spin: SpinFields | null; plane: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t('spin.title');
  // The fastest of its speeds, as a hint on the button.
  const fastest = spin ? [spin.spin, spin.tilt, spin.turn].reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : 0;
  return (
    <span className="opt">
      <button ref={ref} type="button" className="opt-pop-btn" aria-haspopup="dialog" aria-expanded={open} data-tip={t('spin.tip')} onClick={() => setOpen((o) => !o)}>
        <Icon name="rotate-cw" size={15} />
        <span>{label}</span>
        {spin ? <span className="opt-pop-summary">{`${round2(fastest)} ${t('spin.unit')}`}</span> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={label} className="opt-popover spin-popover">
        <SpinPanel spin={spin} plane={plane} />
      </Popover>
    </span>
  );
}

function SpinPanel({ spin, plane }: { spin: SpinFields | null; plane: boolean }) {
  const pieceId = useUi((s) => s.animation.selectedId);
  const frame = useUi((s) => s.animation.frame);
  if (!pieceId) return null;
  const speed = (axis: keyof SpinAxes, labelKey: I18nKey, tip: I18nKey) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field" data-tip={t(tip)}>
        <span>{label}</span>
        <NumberField className="num tf-num" value={round2(spin?.[axis] ?? 0)} decimals={2} step={0.05} shiftStep={0.5} min={-MAX_SPIN} max={MAX_SPIN} label={label} onChange={(v) => engine.anim.setSpin(pieceId, frame, { [axis]: v })} />
        <span className="unit">{t('spin.unit')}</span>
      </span>
    );
  };
  // Tilt and turn are 3D: the Perspective plane tool's, or shown wherever they're already set.
  const in3d = plane || !!spin?.tilt || !!spin?.turn;
  return (
    <div className="trail-settings spin-panel">
      <div className="trail-line">
        {speed('spin', 'spin.spin', 'spin.spinTip')}
        {in3d ? speed('tilt', 'spin.tilt', 'spin.tiltTip') : null}
        {in3d ? speed('turn', 'spin.turn', 'spin.turnTip') : null}
      </div>
      <div className="trail-line" role="group" aria-label={t('spin.title')}>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={!!spin?.keyed}
          aria-label={t(spin?.keyed ? 'spin.keyed' : 'spin.addKey')}
          data-tip={t(spin?.keyed ? 'spin.keyed' : 'spin.addKey')}
          disabled={!spin}
          onClick={() => spin && !spin.keyed && engine.anim.setSpin(pieceId, frame, {})}
        >
          <Icon name={spin?.keyed ? 'keyframe' : 'keyframe-add'} size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('spin.deleteKey')} data-tip={t('spin.deleteKey')} disabled={!spin?.keyed} onClick={() => spin && engine.anim.removeSpinKey(pieceId, spin.at)}>
          <Icon name="keyframe-delete" size={16} />
        </button>
        {spin?.keyed ? (
          <label className="opt">
            <span>{t('spin.easing')}</span>
            <select className="select" aria-label={t('spin.easing')} value={spin.easing} onChange={(e) => engine.anim.setSpin(pieceId, frame, { easing: e.target.value as Easing })}>
              {EASINGS.map((e) => (
                <option key={e} value={e}>
                  {t(`easing.${e}` as I18nKey)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="opt-hint">{spin ? t('spin.keyedAt', { frames: spin.keys.map((k) => k + 1).join(', ') }) : t('spin.notSpinning')}</span>
      </div>
      {spin && spin.at !== frame ? <p className="opt-hint">{t('spin.onRepeat', { n: spin.at + 1 })}</p> : null}
      <div className="trail-line">
        <button type="button" className="btn small" data-tip={t('spin.fitTip')} disabled={!spin} onClick={() => engine.anim.fitSpin(pieceId)}>
          {t('spin.fit')}
        </button>
        <button type="button" className="btn small" data-tip={t('spin.stopTip')} disabled={!spin} onClick={() => engine.anim.stopSpin(pieceId)}>
          {t('spin.stop')}
        </button>
      </div>
    </div>
  );
}
