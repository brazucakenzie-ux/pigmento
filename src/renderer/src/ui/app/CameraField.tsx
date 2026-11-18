import { MAX_STRENGTH, MIN_STRENGTH } from '@engine/anim/space';
import { t } from '../../i18n';
import { NumberField } from '../components/Controls';
import { engine } from '../state/engine';
import { useUi } from '../state/store';

/** How strong the camera's perspective is (1–100 %), for the Perspective plane tool and the Animate tab. */
export function CameraField() {
  const strength = useUi((s) => s.animation.camera.strength);
  const label = t('camera.strength');
  return (
    <span className="opt tf-field" data-tip={t('camera.strengthTip')}>
      <span>{label}</span>
      <NumberField
        className="num tf-num"
        value={Math.round(strength)}
        decimals={0}
        min={MIN_STRENGTH}
        max={MAX_STRENGTH}
        label={label}
        onChange={(v) => engine.anim.setCamera({ strength: v })}
        onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
      />
      <span className="unit">%</span>
    </span>
  );
}

/** Where the picture's light comes from (round the picture, and how high), for shaded pieces in 3D. */
export function LightFields() {
  const light = useUi((s) => s.animation.light);
  const one = (key: 'angle' | 'height', labelKey: 'light.angle' | 'light.height', tipKey: 'light.angleTip' | 'light.heightTip', min: number, max: number) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field" data-tip={t(tipKey)}>
        <span>{label}</span>
        <NumberField
          className="num tf-num"
          value={Math.round(light[key])}
          decimals={0}
          min={min}
          max={max}
          label={label}
          onChange={(v) => engine.anim.setLight({ [key]: v })}
          onEnter={() => (document.activeElement as HTMLElement | null)?.blur()}
        />
        <span className="unit">°</span>
      </span>
    );
  };
  return (
    <>
      {one('angle', 'light.angle', 'light.angleTip', -360, 360)}
      {one('height', 'light.height', 'light.heightTip', 0, 90)}
    </>
  );
}
