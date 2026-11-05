import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { hsvToRgb, parseHex, rgbToHsv, toCss, toHex6, type HSV, type RGBA } from '@engine/core/color';
import { t } from '../../i18n';
import { NumberField } from './Controls';

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** HSV picker with hue and opacity strips plus RGB/HSV/hex/alpha fields. */
export function ColorPicker({ value, onChange }: { value: RGBA; onChange: (c: RGBA) => void }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(value));
  const last = useRef(value);

  // Keep hue/saturation when the incoming colour is grey (rgb→hsv loses them).
  useEffect(() => {
    const cur = last.current;
    if (cur.r === value.r && cur.g === value.g && cur.b === value.b && cur.a === value.a) return;
    last.current = value;
    const next = rgbToHsv(value);
    setHsv((h) => ({ h: next.s === 0 ? h.h : next.h, s: next.v === 0 ? h.s : next.s, v: next.v }));
  }, [value]);

  const emitHsv = (n: HSV, a = value.a) => {
    setHsv(n);
    const c = hsvToRgb(n, a);
    last.current = c;
    onChange(c);
  };
  const area = useRef<HTMLDivElement>(null);
  const dragArea = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = area.current!.getBoundingClientRect();
    emitHsv({ h: hsv.h, s: clamp01((e.clientX - r.left) / r.width), v: clamp01(1 - (e.clientY - r.top) / r.height) });
  };
  const strip = (e: ReactPointerEvent<HTMLDivElement>, kind: 'hue' | 'alpha') => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = clamp01((e.clientX - r.left) / r.width);
    if (kind === 'hue') emitHsv({ ...hsv, h: f * 360 });
    else emitHsv(hsv, Math.round(f * 255));
  };
  const areaKeys = (e: KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
    const k = m[e.key];
    if (!k) return;
    e.preventDefault();
    emitHsv({ h: hsv.h, s: clamp01(hsv.s + k[0]), v: clamp01(hsv.v + k[1]) });
  };
  const stripKeys = (e: KeyboardEvent, kind: 'hue' | 'alpha') => {
    const d = (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0) * (e.shiftKey ? 10 : 1);
    if (!d) return;
    e.preventDefault();
    if (kind === 'hue') emitHsv({ ...hsv, h: (hsv.h + d * 3 + 360) % 360 });
    else emitHsv(hsv, Math.min(255, Math.max(0, value.a + d * 3)));
  };

  const pure = toCss(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));
  const opaque = { ...value, a: 255 };
  return (
    <div className="cp-main">
      <div
        ref={area}
        className="cp-area"
        role="slider"
        tabIndex={0}
        aria-label={t('colors.svArea')}
        aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragArea(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && dragArea(e)}
        onKeyDown={areaKeys}
      >
        <div className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toCss(opaque) }} />
      </div>
      <div
        className="cp-strip cp-hue"
        role="slider"
        tabIndex={0}
        aria-label={t('colors.hue')}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          strip(e, 'hue');
        }}
        onPointerMove={(e) => e.buttons & 1 && strip(e, 'hue')}
        onKeyDown={(e) => stripKeys(e, 'hue')}
      >
        <div className="knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>
      <div
        className="cp-strip cp-alpha"
        role="slider"
        tabIndex={0}
        aria-label={t('colors.alpha')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((value.a / 255) * 100)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          strip(e, 'alpha');
        }}
        onPointerMove={(e) => e.buttons & 1 && strip(e, 'alpha')}
        onKeyDown={(e) => stripKeys(e, 'alpha')}
      >
        <div className="fill" style={{ background: `linear-gradient(to right, transparent, ${toCss(opaque)})` }} />
        <div className="knob" style={{ left: `${(value.a / 255) * 100}%`, background: toCss(value) }} />
      </div>
    </div>
  );
}

/** The numeric half of the picker (shown beside the visual part). */
export function ColorFields({ value, onChange }: { value: RGBA; onChange: (c: RGBA) => void }) {
  const hsv = rgbToHsv(value);
  const [hex, setHex] = useState(toHex6(value).slice(1));
  useEffect(() => setHex(toHex6(value).slice(1)), [value]);
  const setCh = (k: 'r' | 'g' | 'b') => (v: number) => onChange({ ...value, [k]: Math.round(v) });
  const setHsv = (k: 'h' | 's' | 'v') => (v: number) => onChange(hsvToRgb({ ...hsv, [k]: k === 'h' ? v : v / 100 }, value.a));
  return (
    <div className="cp-inputs">
      <label>{t('colors.hex')}</label>
      <input
        className="num"
        aria-label={t('colors.hex')}
        value={hex}
        maxLength={8}
        onChange={(e) => {
          setHex(e.target.value);
          const c = parseHex(e.target.value);
          if (c && (e.target.value.replace('#', '').length === 6 || e.target.value.replace('#', '').length === 8)) onChange(c);
        }}
      />
      <label>{t('colors.red')}</label>
      <NumberField value={value.r} onChange={setCh('r')} min={0} max={255} label={t('colors.red')} />
      <label>{t('colors.green')}</label>
      <NumberField value={value.g} onChange={setCh('g')} min={0} max={255} label={t('colors.green')} />
      <label>{t('colors.blue')}</label>
      <NumberField value={value.b} onChange={setCh('b')} min={0} max={255} label={t('colors.blue')} />
      <label>{t('colors.hue')}</label>
      <NumberField value={Math.round(hsv.h)} onChange={setHsv('h')} min={0} max={360} label={t('colors.hue')} />
      <label>{t('colors.saturation')}</label>
      <NumberField value={Math.round(hsv.s * 100)} onChange={setHsv('s')} min={0} max={100} label={t('colors.saturation')} />
      <label>{t('colors.value')}</label>
      <NumberField value={Math.round(hsv.v * 100)} onChange={setHsv('v')} min={0} max={100} label={t('colors.value')} />
      <label>{t('colors.alpha')}</label>
      <NumberField
        value={Math.round((value.a / 255) * 100)}
        onChange={(v) => onChange({ ...value, a: Math.round((v / 100) * 255) })}
        min={0}
        max={100}
        label={t('colors.alpha')}
      />
    </div>
  );
}
