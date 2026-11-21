import { useRef, useState } from 'react';
import type { TrailFields } from '@engine/anim/AnimationController';
import { EASINGS, type Easing } from '@engine/anim/interpolate';
import { MAX_TRAILS, TRAIL_PRESETS, type Trail, type TrailPreset, type TrailStop } from '@engine/anim/trail';
import { brushRegistry } from '@engine/brush/BrushRegistry';
import type { RGBA } from '@engine/core/color';
import { t, type I18nKey } from '../../i18n';
import { ColorPicker } from '../components/ColorPicker';
import { NumberField } from '../components/Controls';
import { Popover } from '../components/Popover';
import { Icon } from '../icons/Icon';
import { engine } from '../state/engine';
import { useUi } from '../state/store';

const DEG = 180 / Math.PI;

/**
 * The Trail button in the Animate and Perspective plane tools' options, and its popover. Its fields
 * keep focus on Enter (unlike the options bar's), so Esc closes the popover and nothing else.
 */
export function TrailButton({ trails }: { trails: TrailFields[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = t('trail.title');
  return (
    <span className="opt">
      <button ref={ref} type="button" className="opt-pop-btn" aria-haspopup="dialog" aria-expanded={open} data-tip={t('trail.tip')} onClick={() => setOpen((o) => !o)}>
        <Icon name="motion" size={15} />
        <span>{label}</span>
        {trails.length ? <span className="opt-pop-summary">{trails.length}</span> : null}
        <Icon name="chevron-down" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} label={label} className="opt-popover trail-popover">
        <TrailPanel trails={trails} />
      </Popover>
    </span>
  );
}

/** Its trails (add, pick, reorder, remove), and the picked one's settings. */
function TrailPanel({ trails }: { trails: TrailFields[] }) {
  const pieceId = useUi((s) => s.animation.selectedId);
  const [picked, setPicked] = useState<string | null>(null);
  if (!pieceId) return null;
  const current = trails.find((x) => x.id === picked) ?? trails[0] ?? null;
  const add = () => {
    const id = engine.anim.addTrail(pieceId);
    if (id) setPicked(id);
  };
  return (
    <div className="trail-panel">
      <div className="trail-list">
        <div className="trail-list" role="list" aria-label={t('trail.list')}>
          {trails.map((tr, i) => (
            <div key={tr.id} role="listitem" className={`trail-row ${tr === current ? 'selected' : ''}`}>
              <button type="button" className="btn small trail-pick" aria-pressed={tr === current} onClick={() => setPicked(tr.id)}>
                {t('trail.item', { n: i + 1, kind: t(`trail.kind.${tr.kind}` as I18nKey) })}
              </button>
              <button type="button" className="icon-btn" aria-label={t('trail.up', { n: i + 1 })} data-tip={t('trail.up', { n: i + 1 })} disabled={i === 0} onClick={() => engine.anim.moveTrail(pieceId, tr.id, -1)}>
                <Icon name="chevron-up" size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={t('trail.down', { n: i + 1 })} data-tip={t('trail.down', { n: i + 1 })} disabled={i === trails.length - 1} onClick={() => engine.anim.moveTrail(pieceId, tr.id, 1)}>
                <Icon name="chevron-down" size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={t('trail.remove', { n: i + 1 })} data-tip={t('trail.remove', { n: i + 1 })} onClick={() => engine.anim.removeTrail(pieceId, tr.id)}>
                <Icon name="delete" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn small" disabled={trails.length >= MAX_TRAILS} onClick={add}>
          {t('trail.add')}
        </button>
      </div>
      {current ? <TrailSettings pieceId={pieceId} trail={current} /> : <p className="dialog-note">{t('trail.none')}</p>}
    </div>
  );
}

/** One trail's settings. */
function TrailSettings({ pieceId, trail }: { pieceId: string; trail: TrailFields }) {
  const frame = useUi((s) => s.animation.frame);
  const [stop, setStop] = useState(0);
  const set = (change: Partial<Omit<Trail, 'id' | 'keys'>>) => engine.anim.setTrail(pieceId, trail.id, change);
  const num = (labelKey: I18nKey, value: number, unit: string, min: number, max: number, decimals: number, onChange: (v: number) => void, tip?: I18nKey) => {
    const label = t(labelKey);
    return (
      <span className="opt tf-field" data-tip={tip ? t(tip) : undefined}>
        <span>{label}</span>
        <NumberField className="num tf-num" value={Math.round(value * 10 ** decimals) / 10 ** decimals} decimals={decimals} min={min} max={max} label={label} onChange={onChange} />
        <span className="unit">{unit}</span>
      </span>
    );
  };
  const puffs = trail.kind === 'puffs';
  const stops = trail.colors;
  const at = Math.min(stop, stops.length - 1);
  // Colours sit evenly through a puff's life.
  const even = (list: RGBA[]): TrailStop[] => list.map((color, i) => ({ pos: list.length > 1 ? i / (list.length - 1) : 0, color }));
  const brushes = brushRegistry.all().filter((b) => !b.eraser);
  return (
    <div className="trail-settings">
      <div className="trail-line">
        <label className="opt">
          <span>{t('trail.preset')}</span>
          <select className="select" aria-label={t('trail.preset')} value="" onChange={(e) => e.target.value && engine.anim.presetTrail(pieceId, trail.id, e.target.value as TrailPreset)}>
            <option value="">{t('trail.presetPick')}</option>
            {TRAIL_PRESETS.map((p) => (
              <option key={p} value={p}>
                {t(`trail.preset.${p}` as I18nKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="opt">
          <span>{t('trail.kind')}</span>
          <select className="select" aria-label={t('trail.kind')} value={trail.kind} onChange={(e) => set({ kind: e.target.value === 'echo' ? 'echo' : 'puffs' })}>
            <option value="puffs">{t('trail.kind.puffs')}</option>
            <option value="echo">{t('trail.kind.echo')}</option>
          </select>
        </label>
      </div>
      {puffs ? (
        <>
          <div className="trail-line">
            <label className="opt">
              <span>{t('trail.brush')}</span>
              <select className="select" aria-label={t('trail.brush')} value={trail.brush} onChange={(e) => set({ brush: e.target.value })}>
                {brushes.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name ?? t(b.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            {num('trail.rate', trail.rate, t('trail.perSecond'), 0, 1000, 0, (v) => set({ rate: v }), 'trail.rateTip')}
            {num('trail.spacing', trail.spacing, 'px', 0, 10000, 0, (v) => set({ spacing: v }), 'trail.spacingTip')}
          </div>
          <div className="trail-line">
            {num('trail.lifetime', trail.lifetime, 's', 0.05, 30, 2, (v) => set({ lifetime: v }))}
            {num('trail.size', trail.size, 'px', 1, 2000, 0, (v) => set({ size: v }))}
            {num('trail.growth', trail.growth * 100, '%', 0, 2000, 0, (v) => set({ growth: v / 100 }), 'trail.growthTip')}
          </div>
          <div className="trail-line">
            {num('trail.drift', trail.drift, t('trail.pxPerSecond'), 0, 10000, 0, (v) => set({ drift: v }), 'trail.driftTip')}
            {num('trail.direction', trail.driftAngle * DEG, '°', -180, 180, 0, (v) => set({ driftAngle: v / DEG }), 'trail.directionTip')}
            {num('trail.spread', trail.spread, t('trail.pxPerSecond'), 0, 10000, 0, (v) => set({ spread: v }), 'trail.spreadTip')}
          </div>
          <div className="trail-line" role="group" aria-label={t('trail.colors')}>
            <span>{t('trail.colors')}</span>
            {stops.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`swatch trail-swatch ${i === at ? 'selected' : ''}`}
                aria-pressed={i === at}
                aria-label={t('trail.color', { n: i + 1 })}
                data-tip={t('trail.color', { n: i + 1 })}
                style={{ background: `rgba(${s.color.r}, ${s.color.g}, ${s.color.b}, ${s.color.a / 255})` }}
                onClick={() => setStop(i)}
              />
            ))}
            <button type="button" className="icon-btn" aria-label={t('trail.addColor')} data-tip={t('trail.addColor')} disabled={stops.length >= 4} onClick={() => set({ colors: even([...stops.map((s) => s.color), { ...stops[stops.length - 1].color }]) })}>
              <Icon name="plus" size={14} />
            </button>
            <button type="button" className="icon-btn" aria-label={t('trail.removeColor')} data-tip={t('trail.removeColor')} disabled={stops.length <= 2} onClick={() => set({ colors: even(stops.filter((_, i) => i !== at).map((s) => s.color)) })}>
              <Icon name="minus" size={14} />
            </button>
          </div>
          <ColorPicker value={stops[at].color} onChange={(c) => set({ colors: stops.map((s, i) => (i === at ? { pos: s.pos, color: c } : s)) })} />
          <label className="check opt">
            <input type="checkbox" checked={trail.stretch} onChange={() => set({ stretch: !trail.stretch })} />
            {t('trail.stretch')}
          </label>
        </>
      ) : (
        <div className="trail-line">
          {num('trail.copies', trail.copies, '', 1, 32, 0, (v) => set({ copies: v }))}
          {num('trail.gap', trail.gap, t('trail.frames'), 1, 60, 0, (v) => set({ gap: v }), 'trail.gapTip')}
        </div>
      )}
      <div className="trail-line">
        {num('trail.opacity', trail.opacity * 100, '%', 0, 100, 0, (v) => set({ opacity: v / 100 }))}
        {num('trail.fade', trail.fade * 100, '%', 0, 100, 0, (v) => set({ fade: v / 100 }), 'trail.fadeTip')}
        <label className="check opt">
          <input type="checkbox" checked={trail.front} onChange={() => set({ front: !trail.front })} />
          {t('trail.front')}
        </label>
        <button type="button" className="btn small" data-tip={t('trail.shuffleTip')} onClick={() => set({ seed: Math.floor(Math.random() * 2 ** 31) })}>
          {t('trail.shuffle')}
        </button>
      </div>
      <div className="trail-line" role="group" aria-label={t('trail.emission')}>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={trail.keyed}
          aria-label={t(trail.keyed ? 'trail.keyed' : 'trail.addKey')}
          data-tip={t(trail.keyed ? 'trail.keyed' : 'trail.addKey')}
          onClick={() => !trail.keyed && engine.anim.keyEmission(pieceId, trail.id, frame, trail.emission)}
        >
          <Icon name={trail.keyed ? 'keyframe' : 'keyframe-add'} size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('trail.deleteKey')} data-tip={t('trail.deleteKey')} disabled={!trail.keyed} onClick={() => engine.anim.removeEmissionKey(pieceId, trail.id, frame)}>
          <Icon name="keyframe-delete" size={16} />
        </button>
        {num('trail.emission', trail.emission * 100, '%', 0, 100, 0, (v) => engine.anim.keyEmission(pieceId, trail.id, frame, v / 100), 'trail.emissionTip')}
        {trail.keyed ? (
          <label className="opt">
            <span>{t('trail.easing')}</span>
            <select
              className="select"
              aria-label={t('trail.easing')}
              value={trail.keys.find((k) => k.frame === frame)?.easing ?? 'linear'}
              onChange={(e) => engine.anim.keyEmission(pieceId, trail.id, frame, trail.emission, e.target.value as Easing)}
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>
                  {t(`easing.${e}` as I18nKey)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="opt-hint">{trail.keys.length ? t('trail.keyedAt', { frames: trail.keys.map((k) => k.frame + 1).join(', ') }) : t('trail.notKeyed')}</span>
      </div>
      <div className="trail-line" role="group" aria-label={t('trail.emitter')}>
        {num('trail.emitterX', trail.emitter.x, 'px', -1e6, 1e6, 0, (v) => set({ emitter: { x: v, y: trail.emitter.y } }), 'trail.emitterTip')}
        {num('trail.emitterY', trail.emitter.y, 'px', -1e6, 1e6, 0, (v) => set({ emitter: { x: trail.emitter.x, y: v } }), 'trail.emitterTip')}
      </div>
      <p className="opt-hint">{t('trail.emitterHint')}</p>
    </div>
  );
}
