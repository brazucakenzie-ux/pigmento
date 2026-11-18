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
