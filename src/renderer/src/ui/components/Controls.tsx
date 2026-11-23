import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons/Icon';

/** Numeric input that commits on Enter/blur and clamps to [min, max]. */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  shiftStep = step * 10,
  label,
  id,
  className = 'num',
  decimals = 0,
  onEnter,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** What the arrow keys step by with Shift held (10 steps by default). */
  shiftStep?: number;
  label: string;
  id?: string;
  className?: string;
  decimals?: number;
  /** After Enter commits the value (e.g. hand focus back to the canvas). */
  onEnter?: () => void;
}) {
  const [text, setText] = useState(value.toFixed(decimals));
  useEffect(() => setText(value.toFixed(decimals)), [value, decimals]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    const next = Math.min(max, Math.max(min, v));
    // Leaving the field without changing it reports nothing (no spurious edits on blur).
    if (Number.isFinite(v) && next !== value) onChange(next);
    else setText(value.toFixed(decimals));
  };
  return (
    <input
      id={id}
      className={className}
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          onEnter?.();
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? shiftStep : step);
          onChange(Math.min(max, Math.max(min, value + d)));
        }
      }}
    />
  );
}

const toLog = (v: number, min: number, max: number) =>
  (Math.log(Math.max(v, min)) - Math.log(min)) / (Math.log(max) - Math.log(min));
const fromLog = (t: number, min: number, max: number) => Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));

/** Range slider + number box. `log` maps the slider logarithmically for wide ranges. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  unit,
  showUnit = true,
  log = false,
  width,
  showNumber = true,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit?: string;
  showUnit?: boolean;
  log?: boolean;
  width?: number;
  showNumber?: boolean;
}) {
  const id = useId();
  const useLog = log && min > 0;
  const pos = useLog ? toLog(value, min, max) * 1000 : value;
  const fill = useLog ? pos / 10 : ((value - min) / (max - min)) * 100;
  return (
    <span className="slider">
      <input
        id={id}
        type="range"
        aria-label={label}
        aria-valuetext={`${Math.round(value)}${unit ?? ''}`}
        min={useLog ? 0 : min}
        max={useLog ? 1000 : max}
        step={useLog ? 1 : step}
        value={pos}
        style={{ ['--fill' as string]: `${fill}%`, width }}
        onChange={(e) => {
          const raw = Number(e.target.value);
          const v = useLog ? fromLog(raw / 1000, min, max) : raw;
          onChange(Math.round(v / step) * step);
        }}
      />
      {showNumber ? (
        <>
          <NumberField value={value} onChange={onChange} min={min} max={max} step={step} label={label} />
          {unit && showUnit ? <span className="unit">{unit}</span> : null}
        </>
      ) : null}
    </span>
  );
}

export interface SegmentChoice {
  value: string;
  label: string;
  icon?: string;
}

/** Radio group drawn as a segmented control (arrow keys move between options). */
export function Segmented({
  value,
  onChange,
  choices,
  label,
  iconsOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  choices: SegmentChoice[];
  label: string;
  iconsOnly?: boolean;
}) {
  return (
    <span className="segmented" role="radiogroup" aria-label={label}>
      {choices.map((c, i) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value === value}
          aria-label={c.label}
          tabIndex={c.value === value ? 0 : -1}
          data-tip={iconsOnly ? c.label : undefined}
          onClick={() => onChange(c.value)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            const next = choices[(i + d + choices.length) % choices.length];
            onChange(next.value);
            const parent = e.currentTarget.parentElement;
            requestAnimationFrame(() => parent?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
          }}
        >
          {c.icon ? <Icon name={c.icon} size={16} /> : null}
          {iconsOnly ? null : c.label}
        </button>
      ))}
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`check ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
