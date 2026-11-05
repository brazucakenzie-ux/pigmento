import type { OptionSpec } from '@engine/tools/Tool';
import { toolRegistry } from '@engine/tools/ToolRegistry';
import { t } from '../../i18n';
import { Icon } from '../icons/Icon';
import { Segmented, Slider } from '../components/Controls';
import { engine } from '../state/engine';
import { useUi } from '../state/store';
import { runAction } from '../actions/actions';

const FALLBACK_FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Georgia', 'Impact', 'Segoe Print', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

function FontPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const fonts = useUi((s) => s.fonts);
  const list = fonts.length > 0 ? fonts : FALLBACK_FONTS;
  const options = list.includes(value) ? list : [value, ...list];
  return (
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 180 }}>
      {options.map((f) => (
        <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
          {f}
        </option>
      ))}
    </select>
  );
}

function OptionControl({ toolId, spec, values }: { toolId: string; spec: OptionSpec; values: Record<string, unknown> }) {
  const set = (v: unknown) => engine.setToolOption(toolId, spec.key, v);
  const label = t(spec.labelKey);
  switch (spec.type) {
    case 'slider': {
      const v = Number(values[spec.key] ?? spec.default);
      return (
        <span className="opt">
          <span>{label}</span>
          {spec.presets ? (
            <span className="chips" role="group" aria-label={label}>
              {spec.presets.map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={v === p} onClick={() => set(p)}>
                  {p}
                </button>
              ))}
            </span>
          ) : null}
          <Slider value={v} onChange={set} min={spec.min} max={spec.max} step={spec.step} unit={spec.unit} log={spec.log} label={label} />
        </span>
      );
    }
    case 'toggle': {
      const v = values[spec.key] === true;
      if (spec.icon) {
        return (
          <button type="button" className="icon-btn" aria-pressed={v} aria-label={label} data-tip={label} onClick={() => set(!v)}>
            <Icon name={spec.icon} size={17} />
          </button>
        );
      }
      return (
        <label className="check opt">
          <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />
          {label}
        </label>
      );
    }
    case 'segmented':
      return (
        <span className="opt">
          {spec.iconsOnly ? null : <span>{label}</span>}
          <Segmented
            value={String(values[spec.key] ?? spec.default)}
            onChange={set}
            label={label}
            iconsOnly={spec.iconsOnly}
            choices={spec.choices.map((c) => ({ value: c.value, label: t(c.labelKey), icon: c.icon }))}
          />
        </span>
      );
    case 'font':
      return (
        <span className="opt">
          <FontPicker value={String(values[spec.key] ?? spec.default)} onChange={set} label={label} />
        </span>
      );
    case 'hint':
      return <span className="opt-hint">{label}</span>;
  }
}

export function OptionsBar() {
  const toolId = useUi((s) => s.tool);
  const values = useUi((s) => s.toolOptions[toolId]) ?? engine.options(toolId);
  const live = useUi((s) => s.live);
  const transparent = useUi((s) => s.transparentSelection);
  const tool = toolRegistry.get(toolId);
  if (!tool) return <div className="optionsbar" />;
  const visible = tool.options.filter((o) => !o.visibleIf || o.visibleIf(values));
  return (
    <div className="optionsbar" role="toolbar" aria-label={t('a11y.toolOptions')}>
      <span className="tool-name">
        <Icon name={tool.icon} size={18} />
        {t(tool.labelKey)}
      </span>
      {tool.group === 'selection' ? (
        <label className="check opt">
          <input type="checkbox" checked={transparent} onChange={() => runAction('transparentSelection')} />
          {t('action.transparentSelection')}
        </label>
      ) : null}
      {visible.map((spec) => (
        <OptionControl key={spec.key} toolId={toolId} spec={spec} values={values} />
      ))}
      <span className="grow" />
      {live ? (
        <>
          <button type="button" className="btn small" onClick={() => engine.cancelLive()}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn small primary" onClick={() => engine.commitLive()}>
            <Icon name="check" size={15} />
            {t('action.commit')}
          </button>
        </>
      ) : null}
    </div>
  );
}
